// Payment provider callback. Public by design (verify_jwt = false) — the
// provider has no Havekongen session — so the signature check below is the only
// thing standing between the internet and "this order is paid". It is therefore
// mandatory: with no STRIPE_WEBHOOK_SECRET configured the function refuses every
// request rather than trusting the body.

import { serviceClient } from "../_shared/http.ts";
import { sendEmail, paymentReceivedEmail } from "../_shared/email.ts";

const encoder = new TextEncoder();

/** Constant-time comparison so a wrong signature leaks no timing information. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Verify a Stripe-style `t=…,v1=…` signature header. Also enforces a five
 * minute freshness window so a captured webhook cannot be replayed later.
 */
async function verifyStripeSignature(payload: string, header: string, secret: string): Promise<boolean> {
  const parts = Object.fromEntries(
    header
      .split(",")
      .map((p) => p.split("=", 2))
      .filter((p) => p.length === 2) as [string, string][],
  );
  const timestamp = parts.t;
  const signature = parts.v1;
  if (!timestamp || !signature) return false;

  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > 300) return false;

  const expected = await hmacHex(secret, `${timestamp}.${payload}`);
  return timingSafeEqual(expected, signature);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

  const secret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  if (!secret) {
    console.error("[payment-webhook] STRIPE_WEBHOOK_SECRET not set — refusing to trust the payload");
    return new Response("webhook not configured", { status: 503 });
  }

  const raw = await req.text();
  const sigHeader = req.headers.get("stripe-signature") ?? "";
  if (!(await verifyStripeSignature(raw, sigHeader, secret))) {
    console.warn("[payment-webhook] rejected: bad or stale signature");
    return new Response("invalid signature", { status: 400 });
  }

  let event: { id?: string; type?: string; data?: { object?: Record<string, unknown> } };
  try {
    event = JSON.parse(raw);
  } catch {
    return new Response("bad json", { status: 400 });
  }

  const obj = event.data?.object ?? {};
  const orderId = (obj.metadata as Record<string, string> | undefined)?.order_id ?? (obj.client_reference_id as string);

  if (!orderId) {
    // Not ours, or an event type without an order — acknowledge so Stripe stops
    // retrying rather than leaving it queued forever.
    console.log(`[payment-webhook] ignoring ${event.type} with no order reference`);
    return new Response("ignored", { status: 200 });
  }

  const sb = serviceClient();

  if (event.type === "checkout.session.completed" || event.type === "payment_intent.succeeded") {
    const amount = Number(obj.amount_total ?? obj.amount_received ?? 0) || null;
    const { data, error } = await sb.rpc("mark_order_paid", {
      p_order_id: orderId,
      p_provider: "stripe",
      p_reference: (obj.id as string) ?? null,
      p_amount_oere: amount,
    });

    if (error) {
      console.error("[payment-webhook] mark_order_paid failed", error.message);
      // 500 makes Stripe retry, which is what we want for a transient failure.
      return new Response("could not record payment", { status: 500 });
    }
    const result = data as { ok: boolean; error?: string };
    if (!result?.ok) {
      // An amount mismatch is a real problem but retrying will not fix it; log
      // loudly and acknowledge.
      console.error("[payment-webhook] payment rejected", JSON.stringify(result));
      await sb.from("order_events").insert({
        order_id: orderId,
        actor_kind: "webhook",
        kind: "payment_rejected",
        message: result?.error ?? "unknown",
        meta: { event: event.type, stripe_id: obj.id },
      });
      return new Response("acknowledged with mismatch", { status: 200 });
    }

    const { data: order } = await sb
      .from("orders")
      .select("order_no, email, total_oere, user_id")
      .eq("id", orderId)
      .maybeSingle();
    if (order?.email) {
      const mail = paymentReceivedEmail({
        order_no: order.order_no ?? orderId.slice(0, 8),
        order_id: orderId,
        total_oere: order.total_oere,
      });
      await sendEmail(order.email, mail.subject, mail.html);
    }
    return new Response("ok", { status: 200 });
  }

  if (event.type === "checkout.session.expired" || event.type === "payment_intent.payment_failed") {
    await sb
      .from("payments")
      .update({ status: "failed", updated_at: new Date().toISOString() })
      .eq("order_id", orderId);
    await sb.from("order_events").insert({
      order_id: orderId,
      actor_kind: "webhook",
      kind: "payment_failed",
      message: `Betaling mislykkedes (${event.type})`,
      meta: { stripe_id: obj.id },
    });
    return new Response("ok", { status: 200 });
  }

  return new Response("ignored", { status: 200 });
});
