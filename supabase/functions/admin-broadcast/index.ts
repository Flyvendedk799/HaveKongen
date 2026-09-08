import { guard, isBlocked } from "../_shared/http.ts";
// Admin broadcast notifications: insert a notification row for each user in audience.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-havekongen-anon",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const guarded = await guard(req, { fn: "admin-broadcast", requireAdmin: true, limit: 10, windowSeconds: 60 });
  if (isBlocked(guarded)) return guarded.response;
  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;

    const userClient = createClient(SUPABASE_URL, ANON, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: roleRow } = await admin
      .from("user_roles").select("role").eq("user_id", user.id).eq("role", "admin").maybeSingle();
    if (!roleRow) return json({ error: "Forbidden" }, 403);

    const { title, body, link, audience = "all", kind = "broadcast" } = await req.json();
    if (!title || typeof title !== "string") return json({ error: "title required" }, 400);

    let userIds: string[] = [];
    if (audience === "all") {
      // page through auth users
      let page = 1;
      while (true) {
        const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
        if (error) return json({ error: error.message }, 500);
        userIds.push(...data.users.map((u) => u.id));
        if (data.users.length < 200) break;
        page++;
        if (page > 50) break;
      }
    } else if (audience === "admins") {
      const { data } = await admin.from("user_roles").select("user_id").eq("role", "admin");
      userIds = (data ?? []).map((r: any) => r.user_id);
    } else if (Array.isArray(audience)) {
      userIds = audience;
    }

    if (!userIds.length) return json({ ok: true, sent: 0 });

    const rows = userIds.map((uid) => ({ user_id: uid, title, body, link, kind }));
    // chunk inserts
    let sent = 0;
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      const { error } = await admin.from("notifications").insert(chunk);
      if (error) return json({ error: error.message, sent }, 500);
      sent += chunk.length;
    }
    return json({ ok: true, sent });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
