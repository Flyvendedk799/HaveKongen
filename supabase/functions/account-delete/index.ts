// GDPR article 17 — erasure, executed rather than promised.
//
// The RPC request_account_deletion() records the wish and refuses while orders
// are in flight. This function performs it: it re-checks that condition with the
// service role, anonymises the rows Danish bookkeeping law requires us to keep
// (orders must survive five years, but they do not need to carry a name), and
// then deletes the auth user, which cascades the rest.

import { guard, isBlocked, json, fail, preflight, readJson, serviceClient, str } from "../_shared/http.ts";

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return fail(req, "method_not_allowed", "Brug POST.", 405);

  // Deliberately tight: deleting an account is not something to hammer.
  const g = await guard(req, { fn: "account-delete", requireAuth: true, limit: 5, windowSeconds: 3600 });
  if (isBlocked(g)) return g.response;
  const { caller } = g;
  const uid = caller.userId!;

  const body = await readJson<{ confirm?: string }>(req, 16 * 1024);
  // Typed confirmation, so a stray POST cannot wipe an account.
  if (str(body?.confirm, 40)?.toUpperCase() !== "SLET MIN KONTO") {
    return fail(req, "confirmation_required", 'Skriv "SLET MIN KONTO" for at bekræfte.', 400);
  }

  const sb = serviceClient();

  const { count: openOrders } = await sb
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("user_id", uid)
    .in("status", ["pending", "confirmed", "paid", "packed", "shipped"]);

  if ((openOrders ?? 0) > 0) {
    return fail(
      req,
      "open_orders",
      `Du har ${openOrders} aktive ordrer. Vi kan først slette kontoen, når de er afsluttet.`,
      409,
    );
  }

  const stamp = new Date().toISOString();

  // Bookkeeping records stay, stripped of anything that identifies a person.
  const { error: anonErr } = await sb
    .from("orders")
    .update({
      email: null,
      phone: null,
      shipping_address: { anonymised_at: stamp },
      billing_address: null,
      notes: null,
      updated_at: stamp,
    })
    .eq("user_id", uid);
  if (anonErr) {
    console.error("[account-delete] order anonymisation failed", anonErr.message);
    return fail(req, "anonymise_failed", "Kunne ikke anonymisere ordrehistorikken.", 500);
  }

  // Published reviews lose their author but keep their rating, so the product
  // score does not silently shift when someone leaves.
  await sb.from("product_reviews").update({ author_name: "Tidligere kunde", user_id: null }).eq("user_id", uid);

  await sb
    .from("account_deletion_requests")
    .update({ status: "completed", completed_at: stamp })
    .eq("user_id", uid)
    .eq("status", "requested");

  const { error: delErr } = await sb.auth.admin.deleteUser(uid);
  if (delErr) {
    console.error("[account-delete] auth delete failed", delErr.message);
    return fail(req, "delete_failed", "Kontoen kunne ikke slettes. Kontakt os, så ordner vi det.", 500);
  }

  console.log(`[account-delete] erased account ${uid}`);
  return json(req, { ok: true, message: "Din konto og dine persondata er slettet." });
});
