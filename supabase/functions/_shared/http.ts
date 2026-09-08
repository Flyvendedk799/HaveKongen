// Shared request plumbing for every Havekongen edge function.
//
// Before v2 each function repeated the same four lines of `Access-Control-
// Allow-Origin: *` and then did whatever it liked about authentication — which
// in practice meant the AI functions would happily burn OpenAI credit for any
// caller on the internet. This module gives them one way to do CORS, one way to
// read the caller's identity, one shared rate limiter and one error envelope.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

// ---------------------------------------------------------------------- CORS

// Origins allowed to call the functions from a browser. ALLOWED_ORIGINS is a
// comma-separated list; localhost is always permitted so `supabase start` and
// `vite dev` keep working without extra configuration.
const CONFIGURED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") ?? "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

let warnedUnconfigured = false;

/**
 * Origin allowlisting is opt-in via ALLOWED_ORIGINS.
 *
 * When it is not set we allow the request and log once. Falling back to a
 * hard-coded guess at the production domain would silently 403 every preview
 * deploy, every staging host and every renamed domain — turning a missing
 * environment variable into "the map is broken and nothing says why". The
 * variable is the control; its absence means "not configured yet", not "block
 * the world". Same fail-open-and-say-so rule as the rate limiter and the AI
 * budgets.
 */
export function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return true; // server-to-server calls carry no Origin header
  if (LOCAL_ORIGIN.test(origin)) return true;

  if (CONFIGURED_ORIGINS.length === 0) {
    if (!warnedUnconfigured) {
      warnedUnconfigured = true;
      console.warn(
        "[cors] ALLOWED_ORIGINS is not set — accepting every origin. " +
          "Set it to the site's domains to enable the allowlist.",
      );
    }
    return true;
  }

  if (CONFIGURED_ORIGINS.includes("*")) return true;
  return CONFIGURED_ORIGINS.includes(origin);
}

export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin");
  const allowed = isAllowedOrigin(origin);
  return {
    // Echo the caller's origin rather than "*" so credentialed requests work and
    // unknown origins get a header they cannot use.
    "Access-Control-Allow-Origin": allowed && origin ? origin : (origin ? "null" : "*"),
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-havekongen-anon, idempotency-key, " +
      "x-garden-scan-worker-secret, x-worker-secret",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

// --------------------------------------------------------------- responses --

export function json(req: Request, body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json; charset=utf-8", ...extra },
  });
}

/** A predictable error shape: { error: <machine code>, message: <Danish text> }. */
export function fail(req: Request, code: string, message: string, status = 400, extra: Record<string, unknown> = {}) {
  return json(req, { error: code, message, ...extra }, status);
}

export function preflight(req: Request): Response | null {
  if (req.method !== "OPTIONS") return null;
  return new Response(null, { status: 204, headers: corsHeaders(req) });
}

// ------------------------------------------------------------------ clients --

export function serviceClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured");
  return createClient(url, key, { auth: { persistSession: false } });
}

export function userClient(req: Request): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !anon) throw new Error("SUPABASE_URL / SUPABASE_ANON_KEY not configured");
  return createClient(url, anon, {
    auth: { persistSession: false },
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
}

export type Caller = {
  userId: string | null;
  email: string | null;
  isAdmin: boolean;
  /** Stable-ish key for anonymous callers: client-supplied id, else forwarded IP. */
  anonKey: string;
  ip: string;
};

export async function identify(req: Request): Promise<Caller> {
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  const anonHeader = (req.headers.get("x-havekongen-anon") ?? "").slice(0, 64);
  const anonKey = anonHeader || ip;

  const auth = req.headers.get("Authorization");
  if (!auth || !auth.toLowerCase().startsWith("bearer ")) {
    return { userId: null, email: null, isAdmin: false, anonKey, ip };
  }

  try {
    const sb = userClient(req);
    const { data } = await sb.auth.getUser();
    const user = data?.user ?? null;
    if (!user) return { userId: null, email: null, isAdmin: false, anonKey, ip };

    // Roles live in user_roles, not in the JWT, so a stolen token cannot claim
    // admin by editing its own claims.
    const { data: roles } = await sb.from("user_roles").select("role").eq("user_id", user.id);
    const isAdmin = (roles ?? []).some((r: { role: string }) => r.role === "admin");
    return { userId: user.id, email: user.email ?? null, isAdmin, anonKey: user.id, ip };
  } catch {
    return { userId: null, email: null, isAdmin: false, anonKey, ip };
  }
}

// -------------------------------------------------------------- rate limits --

export type RateLimitVerdict = { allowed: boolean; remaining: number; resetAt: string | null };

/**
 * Fixed-window limiter backed by `consume_rate_limit`. Fails open — a limiter
 * outage should slow nobody down — but logs so the gap is visible.
 */
export async function rateLimit(
  scope: string,
  identity: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitVerdict> {
  try {
    const sb = serviceClient();
    const { data, error } = await sb.rpc("consume_rate_limit", {
      p_key: `${scope}:${identity}`,
      p_limit: limit,
      p_window_seconds: windowSeconds,
    });
    if (error) throw error;
    const v = data as { allowed: boolean; remaining: number; reset_at: string };
    return { allowed: v.allowed, remaining: v.remaining, resetAt: v.reset_at };
  } catch (e) {
    console.warn("[rate-limit] unavailable, allowing request", String(e));
    return { allowed: true, remaining: limit, resetAt: null };
  }
}

/** Per-day budget for the functions that spend money at OpenAI. */
export async function aiQuota(
  caller: Caller,
  fn: string,
  dailyLimit: number,
): Promise<{ allowed: boolean; used: number; limit: number }> {
  try {
    const sb = serviceClient();
    const { data, error } = await sb.rpc("consume_ai_quota", {
      p_user: caller.userId,
      p_anon: caller.userId ? null : caller.anonKey,
      p_fn: fn,
      p_daily_limit: dailyLimit,
    });
    if (error) throw error;
    const v = data as { allowed: boolean; used: number; limit: number };
    return v;
  } catch (e) {
    console.warn("[ai-quota] unavailable, allowing request", String(e));
    return { allowed: true, used: 0, limit: dailyLimit };
  }
}

export async function recordAiTokens(caller: Caller, fn: string, tokensIn: number, tokensOut: number) {
  try {
    const sb = serviceClient();
    await sb.rpc("record_ai_tokens", {
      p_user: caller.userId,
      p_anon: caller.userId ? null : caller.anonKey,
      p_fn: fn,
      p_in: Math.max(0, Math.round(tokensIn || 0)),
      p_out: Math.max(0, Math.round(tokensOut || 0)),
    });
  } catch {
    /* usage accounting must never break a working response */
  }
}

// ------------------------------------------------------------------ guards --

export type GuardOptions = {
  /** Function name, used for quota rows and log lines. */
  fn: string;
  /** Reject callers without a valid session. */
  requireAuth?: boolean;
  /** Reject callers who are not admins (implies requireAuth). */
  requireAdmin?: boolean;
  /** Requests per window, per caller. */
  limit?: number;
  windowSeconds?: number;
  /** Daily OpenAI-backed call budget per caller. */
  aiDailyLimit?: number;
  /**
   * Skip the getUser() round-trip and limit by IP alone. For high-volume
   * endpoints (map tiles) where one auth lookup per request would cost more
   * than the request itself.
   */
  skipIdentity?: boolean;
};

export type Guarded = { caller: Caller } | { response: Response };

export function isBlocked(g: Guarded): g is { response: Response } {
  return "response" in g;
}

/**
 * One call that does origin checking, identity, authorisation, rate limiting and
 * AI budgeting. Handlers start with:
 *
 *   const g = await guard(req, { fn: "plant-coach", requireAuth: true, aiDailyLimit: 40 });
 *   if (isBlocked(g)) return g.response;
 */
export async function guard(req: Request, opts: GuardOptions): Promise<Guarded> {
  const origin = req.headers.get("Origin");
  if (!isAllowedOrigin(origin)) {
    console.warn(`[${opts.fn}] blocked origin ${origin}`);
    return { response: fail(req, "origin_not_allowed", "Kaldet kommer fra et ukendt domæne.", 403) };
  }

  const caller = opts.skipIdentity
    ? {
        userId: null,
        email: null,
        isAdmin: false,
        anonKey: (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown",
        ip: (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown",
      }
    : await identify(req);

  if ((opts.requireAdmin || opts.requireAuth) && !caller.userId) {
    return { response: fail(req, "unauthorized", "Log ind for at bruge denne funktion.", 401) };
  }
  if (opts.requireAdmin && !caller.isAdmin) {
    return { response: fail(req, "forbidden", "Kræver administratorrettigheder.", 403) };
  }

  // The garden-scan worker is our own back end polling on a shared secret. It
  // legitimately calls far more often than a browser, so it is not throttled.
  const workerSecret = Deno.env.get("GARDEN_SCAN_WORKER_SECRET");
  const presentedSecret =
    req.headers.get("x-garden-scan-worker-secret") ?? req.headers.get("x-worker-secret");
  const isTrustedWorker = Boolean(workerSecret && presentedSecret && presentedSecret === workerSecret);

  if (opts.limit && opts.limit > 0 && !isTrustedWorker) {
    const verdict = await rateLimit(opts.fn, caller.userId ?? caller.anonKey, opts.limit, opts.windowSeconds ?? 60);
    if (!verdict.allowed) {
      return {
        response: fail(req, "rate_limited", "Du kalder lidt for hurtigt — prøv igen om et øjeblik.", 429, {
          reset_at: verdict.resetAt,
        }),
      };
    }
  }

  if (opts.aiDailyLimit && opts.aiDailyLimit > 0) {
    const quota = await aiQuota(caller, opts.fn, opts.aiDailyLimit);
    if (!quota.allowed) {
      return {
        response: fail(
          req,
          "quota_exceeded",
          `Du har brugt dagens ${quota.limit} AI-svar. Prøv igen i morgen.`,
          429,
          { used: quota.used, limit: quota.limit },
        ),
      };
    }
  }

  return { caller };
}

// ------------------------------------------------------------------- input --

/** Parse a JSON body with a hard size ceiling so a huge payload cannot wedge the isolate. */
export async function readJson<T = Record<string, unknown>>(
  req: Request,
  maxBytes = 8 * 1024 * 1024,
): Promise<T | null> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > maxBytes) return null;
  try {
    const text = await req.text();
    if (text.length > maxBytes) return null;
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export function str(value: unknown, max = 2000): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

export function num(value: unknown, min: number, max: number): number | null {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, n));
}
