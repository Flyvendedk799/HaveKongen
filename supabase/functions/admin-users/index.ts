// Admin user management edge function: list users, set/remove roles.
// Validates caller is admin via has_role(); uses service role for auth.admin APIs.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;

    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, ANON, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: roleRow } = await admin
      .from("user_roles").select("role").eq("user_id", user.id).eq("role", "admin").maybeSingle();
    if (!roleRow) return json({ error: "Forbidden" }, 403);

    const body = await req.json().catch(() => ({}));
    const action = body.action ?? "list";

    if (action === "list") {
      const page = Math.max(1, Number(body.page ?? 1));
      const perPage = Math.min(200, Number(body.perPage ?? 50));
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
      if (error) return json({ error: error.message }, 500);
      const ids = data.users.map((u) => u.id);
      const [{ data: profiles }, { data: roles }] = await Promise.all([
        admin.from("profiles").select("id, name, address").in("id", ids),
        admin.from("user_roles").select("user_id, role").in("user_id", ids),
      ]);
      const byId = new Map<string, any>();
      profiles?.forEach((p) => byId.set(p.id, p));
      const rolesById = new Map<string, string[]>();
      roles?.forEach((r: any) => {
        const arr = rolesById.get(r.user_id) ?? [];
        arr.push(r.role); rolesById.set(r.user_id, arr);
      });
      const users = data.users.map((u) => ({
        id: u.id, email: u.email, created_at: u.created_at,
        last_sign_in_at: u.last_sign_in_at,
        name: byId.get(u.id)?.name ?? null,
        address: byId.get(u.id)?.address ?? null,
        roles: rolesById.get(u.id) ?? [],
      }));
      return json({ users, total: data.total ?? users.length });
    }

    if (action === "setRole") {
      const { userId, role, grant } = body;
      if (!userId || !["admin", "moderator", "user"].includes(role)) {
        return json({ error: "Invalid input" }, 400);
      }
      if (grant) {
        await admin.from("user_roles").upsert({ user_id: userId, role }, { onConflict: "user_id,role" });
      } else {
        await admin.from("user_roles").delete().eq("user_id", userId).eq("role", role);
      }
      return json({ ok: true });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
