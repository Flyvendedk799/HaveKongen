// Turns a placed order into a payable one and sends the receipt.
//
// place_order() (the database RPC) is what creates the order and reserves the
// stock; this function is the second half of checkout — it asks the configured
// payment provider for whatever the customer needs in order to pay, records it
// on the payments row, and emails the confirmation.
//
// Two providers ship today:
//   invoice — bank transfer against the order number. Fully working with no
//             third-party account; an admin marks it paid when the money lands.
//   stripe  — enabled only when STRIPE_SECRET_KEY is set. Creates a Checkout
//             Session; payment-webhook confirms it.
// Anything else is rejected rather than silently pretending to have charged.

import { guard, isBlocked, json, fail, preflight, readJson, serviceClient, str } from "../_shared/http.ts";
import { sendEmail, orderConfirmationEmail } from "../_shared/email.ts";

const SITE_URL = Deno.env.get("SITE_URL") ?? "https://havekongen.dk";

type Body = { order_id?: string; provider?: string };

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return fail(req, "method_not_allowed", "Brug POST.", 405);

  const g = await guard(req, { fn: "checkout-payment", requireAuth: true, limit: 20, windowSeconds: 60 });
  if (isBlocked(g)) return g.response;
  const { caller } = g;

  const body = await readJson<Body>(req, 64 * 1024);
  const orderId = str(body?.order_id, 64);
  if (!orderId) return fail(req, "order_id_required", "order_id mangler.");

  const sb = serviceClient();

  const { data: order, error } = await sb
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .maybeSingle();

  if (error) {
    console.error("[checkout-payment] order lookup failed", error.message);
    return fail(req, "lookup_failed", "Kunne ikke hente ordren.", 500);
  }
  // Not-found and not-yours give the same answer so order ids cannot be probed.
  if (!order || order.user_id !== caller.userId) {
    return fail(req, "order_not_found", "Ordren blev ikke fundet.", 404);
  }
  if (order.payment_status === "paid") {
    return json(req, { ok: true, already_paid: true, order_id: orderId });
  }
  if (order.status === "cancelled") {
    return fail(req, "order_cancelled", "Ordren er annulleret og kan ikke betales.", 409);
  }

  const provider = str(body?.provider, 32) ?? order.payment_provider ?? "invoice";

  const { data: items } = await sb
    .from("order_items")
    .select("name, variant_name, qty, line_total_oere")
    .eq("order_id", orderId);

  let instructions: Record<string, unknown> | null = null;
  let redirectUrl: string | null = null;
  let reference: string | null = null;
  let paymentStatus = "requires_action";

  if (provider === "invoice") {
    const { data: setting } = await sb
      .from("shop_settings")
      .select("value")
      .eq("key", "payment_invoice")
      .maybeSingle();

    const bank = (setting?.value ?? {}) as Record<string, unknown>;
    if (!bank.account_no) {
      return fail(req, "provider_unconfigured", "Bankoverførsel er ikke konfigureret.", 503);
    }
    instructions = {
      ...bank,
      reference: order.order_no,
      amount_oere: order.total_oere,
      due_at: new Date(Date.now() + Number(bank.due_days ?? 8) * 86_400_000).toISOString(),
    };
  } else if (provider === "stripe") {
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) {
      return fail(
        req,
        "provider_unavailable",
        "Kortbetaling er ikke aktiveret. Vælg bankoverførsel.",
        503,
      );
    }
    const form = new URLSearchParams();
    form.set("mode", "payment");
    form.set("success_url", `${SITE_URL}/order/${orderId}?betaling=ok`);
    form.set("cancel_url", `${SITE_URL}/order/${orderId}?betaling=afbrudt`);
    form.set("client_reference_id", orderId);
    form.set("metadata[order_id]", orderId);
    form.set("metadata[order_no]", order.order_no ?? "");
    if (order.email) form.set("customer_email", order.email);
    // One aggregated line: the database already decided the amount, and sending
    // it as a single figure removes any chance of the two disagreeing.
    form.set("line_items[0][quantity]", "1");
    form.set("line_items[0][price_data][currency]", "dkk");
    form.set("line_items[0][price_data][unit_amount]", String(order.total_oere));
    form.set("line_items[0][price_data][product_data][name]", `Havekongen ordre ${order.order_no ?? ""}`.trim());

    const r = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${stripeKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
        // Retrying this call must not create a second Stripe session.
        "Idempotency-Key": `hk-order-${orderId}`,
      },
      body: form,
    });
    if (!r.ok) {
      console.error("[checkout-payment] stripe session failed", r.status, (await r.text()).slice(0, 400));
      return fail(req, "provider_error", "Betalingsudbyderen svarede ikke. Prøv igen.", 502);
    }
    const session = await r.json();
    reference = session.id;
    redirectUrl = session.url;
    instructions = { checkout_url: session.url };
  } else {
    return fail(req, "unknown_provider", `Ukendt betalingsmetode: ${provider}.`, 400);
  }

  const { error: payErr } = await sb
    .from("payments")
    .update({
      provider,
      status: paymentStatus,
      reference,
      instructions,
      updated_at: new Date().toISOString(),
    })
    .eq("order_id", orderId);

  if (payErr) {
    console.error("[checkout-payment] payment update failed", payErr.message);
    return fail(req, "payment_update_failed", "Kunne ikke forberede betalingen.", 500);
  }

  await sb.from("orders").update({ payment_provider: provider, updated_at: new Date().toISOString() }).eq("id", orderId);
  await sb.from("order_events").insert({
    order_id: orderId,
    actor_id: caller.userId,
    actor_kind: "customer",
    kind: "payment_initiated",
    message: `Betaling forberedt via ${provider}`,
    meta: { provider, reference },
  });

  // Receipt is best-effort: a mail outage must not block a placed order.
  const recipient = order.email ?? caller.email;
  if (recipient) {
    const mail = orderConfirmationEmail({
      order_no: order.order_no ?? orderId.slice(0, 8),
      order_id: orderId,
      lines: items ?? [],
      subtotal_oere: order.subtotal_oere,
      discount_oere: order.discount_oere,
      shipping_oere: order.shipping_oere,
      vat_oere: order.vat_oere,
      total_oere: order.total_oere,
      shipping_address: order.shipping_address,
      payment: { provider, instructions },
    });
    const sent = await sendEmail(recipient, mail.subject, mail.html);
    if (!sent.ok) console.warn("[checkout-payment] receipt not delivered", sent.error);
  }

  return json(req, {
    ok: true,
    order_id: orderId,
    order_no: order.order_no,
    provider,
    redirect_url: redirectUrl,
    instructions,
  });
});
