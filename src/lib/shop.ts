// Client-side access to the shop's server-authoritative order pipeline.
//
// Every function here is a thin, typed wrapper around a database RPC. None of
// them decide a price, a stock level or an order status — they ask, and render
// whatever comes back. That is the whole point of v2: the browser is a view
// onto the shop, not a participant in its arithmetic.

import { supabase } from "@/integrations/supabase/client";
import type { Json, Tables } from "@/integrations/supabase/types";
import type { CartItem } from "@/lib/cart";

// ------------------------------------------------------------------- quote --

export type QuoteProblem = {
  code:
    | "empty_cart"
    | "too_many_lines"
    | "unknown_product"
    | "unknown_variant"
    | "inactive"
    | "out_of_stock"
    | "insufficient_stock"
    | "invalid_code"
    | "code_not_started"
    | "code_expired"
    | "code_exhausted"
    | "code_already_used"
    | "below_minimum"
    | (string & {});
  message: string;
  product_id?: string;
  variant_id?: string;
  max_qty?: number;
};

export type QuoteLine = {
  product_id: string;
  variant_id: string | null;
  slug: string;
  name: string;
  variant_name: string | null;
  sku: string | null;
  category: string;
  qty: number;
  unit_price_oere: number;
  line_total_oere: number;
  line_discount_oere: number;
  vat_rate: number;
  vat_oere: number;
  image_url: string | null;
  gradient: string | null;
  svg_art: string | null;
  max_qty: number | null;
};

export type ShippingMethodQuote = {
  code: string;
  name: string;
  description: string | null;
  carrier: string | null;
  price_oere: number;
  free_over_oere: number | null;
  eta_min_days: number;
  eta_max_days: number;
};

export type CartQuote = {
  ok: boolean;
  lines: QuoteLine[];
  problems: QuoteProblem[];
  subtotal_oere: number;
  discount_oere: number;
  shipping_oere: number;
  vat_oere: number;
  total_oere: number;
  currency: string;
  discount: { code: string; kind: string; value: number; description: string | null; amount_oere: number } | null;
  shipping_method: ShippingMethodQuote | null;
};

/** The shape place_order/quote_cart expect: identity and quantity only. */
export function cartToItems(items: CartItem[]): Json {
  return items.map((i) => ({
    product_id: i.productId,
    variant_id: i.variantId ?? null,
    qty: i.qty,
  })) as unknown as Json;
}

export async function quoteCart(
  items: CartItem[],
  shippingMethod = "standard",
  discountCode?: string | null,
): Promise<CartQuote> {
  const { data, error } = await supabase.rpc("quote_cart", {
    p_items: cartToItems(items),
    p_shipping_method: shippingMethod,
    p_discount_code: discountCode || null,
  });

  if (error) throw new Error(error.message);
  return data as unknown as CartQuote;
}

export async function listShippingMethods(): Promise<Tables<"shipping_methods">[]> {
  const { data, error } = await supabase
    .from("shipping_methods")
    .select("*")
    .eq("active", true)
    .order("sort");
  if (error) throw new Error(error.message);
  return data ?? [];
}

// ------------------------------------------------------------- place order --

export type PlaceOrderInput = {
  items: CartItem[];
  shippingAddress: {
    name: string;
    street: string;
    street2?: string;
    postal_code: string;
    city: string;
    country?: string;
  };
  billingAddress?: PlaceOrderInput["shippingAddress"] | null;
  shippingMethod: string;
  email?: string;
  phone?: string;
  discountCode?: string | null;
  note?: string;
  paymentProvider: "invoice" | "stripe";
  /** Stable per-attempt key so a double submit cannot create two orders. */
  idempotencyKey: string;
};

/**
 * Deliberately one shape rather than a discriminated union: this project builds
 * with `strict: false`, where narrowing on a boolean literal discriminant does
 * not hold, so a union here would only produce casts at every call site.
 * Callers branch on `ok` and read the fields that go with it.
 */
export type PlaceOrderResult = {
  ok: boolean;
  replayed?: boolean;
  order_id?: string;
  order_no?: string;
  total_oere?: number;
  problems?: QuoteProblem[];
  quote?: CartQuote;
};

export async function placeOrder(input: PlaceOrderInput): Promise<PlaceOrderResult> {
  const { data, error } = await supabase.rpc("place_order", {
    p_items: cartToItems(input.items),
    p_shipping_address: input.shippingAddress as unknown as Json,
    p_shipping_method: input.shippingMethod,
    p_billing_address: (input.billingAddress ?? null) as unknown as Json,
    p_email: input.email || null,
    p_phone: input.phone || null,
    p_discount_code: input.discountCode || null,
    p_note: input.note || null,
    p_payment_provider: input.paymentProvider,
    p_idempotency_key: input.idempotencyKey,
  });

  if (error) {
    // The RPC raises for the cases that must abort the transaction; translate
    // the ones a customer can act on into their own message.
    if (error.message.includes("insufficient_stock")) {
      return {
        ok: false,
        problems: [{ code: "insufficient_stock", message: "En vare blev udsolgt, mens du var i kassen. Opdatér kurven." }],
      };
    }
    if (error.message.includes("invalid_address")) {
      return { ok: false, problems: [{ code: "invalid_address", message: "Leveringsadressen er ufuldstændig." }] };
    }
    if (error.message.includes("not_authenticated")) {
      return { ok: false, problems: [{ code: "not_authenticated", message: "Log ind for at gennemføre købet." }] };
    }
    throw new Error(error.message);
  }

  return data as unknown as PlaceOrderResult;
}

// ---------------------------------------------------------------- payment --

export type PaymentPrepResult = {
  ok: boolean;
  order_id: string;
  order_no: string | null;
  provider: string;
  redirect_url: string | null;
  instructions: Record<string, unknown> | null;
  already_paid?: boolean;
  error?: string;
  message?: string;
};

/**
 * Call an edge function and surface *its* error message.
 *
 * supabase-js reports a non-2xx response as a FunctionsHttpError whose
 * `message` is only "Edge Function returned a non-2xx status code" — the useful
 * part is the JSON body, reachable through `error.context`, which is the raw
 * Response. Without this every guard rejection (rate limited, quota exceeded,
 * card payments not enabled) reached the user as that same generic string.
 */
export async function invokeFunction<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (!error) return data as T;

  const context = (error as { context?: unknown }).context;
  if (context instanceof Response) {
    // clone() so the caller could still read the body; a non-JSON body just
    // falls through to the transport message.
    const payload = await context
      .clone()
      .json()
      .catch(() => null);
    const message = payload?.message ?? payload?.error;
    if (message) throw new Error(String(message));
  }
  throw new Error(error.message);
}

export async function preparePayment(orderId: string, provider: "invoice" | "stripe"): Promise<PaymentPrepResult> {
  return invokeFunction<PaymentPrepResult>("checkout-payment", { order_id: orderId, provider });
}

// ------------------------------------------------------------------ orders --

export type OrderWithItems = Tables<"orders"> & {
  order_items: Tables<"order_items">[];
};

export async function fetchOrder(orderId: string): Promise<OrderWithItems | null> {
  const { data, error } = await supabase
    .from("orders")
    .select("*, order_items(*)")
    .eq("id", orderId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as OrderWithItems | null) ?? null;
}

export async function fetchOrderEvents(orderId: string): Promise<Tables<"order_events">[]> {
  const { data, error } = await supabase
    .from("order_events")
    .select("*")
    .eq("order_id", orderId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function fetchPayment(orderId: string): Promise<Tables<"payments"> | null> {
  const { data, error } = await supabase
    .from("payments")
    .select("*")
    .eq("order_id", orderId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ?? null;
}

export async function cancelOrder(orderId: string, reason?: string) {
  const { data, error } = await supabase.rpc("cancel_order", { p_order_id: orderId, p_reason: reason || null });
  if (error) throw new Error(error.message);
  return data as unknown as { ok: boolean; error?: string; message?: string };
}

export async function requestReturn(orderId: string, reason: string, comment?: string) {
  const { data, error } = await supabase.rpc("request_return", {
    p_order_id: orderId,
    p_reason: reason,
    p_comment: comment || null,
    p_items: null,
  });
  if (error) throw new Error(error.message);
  return data as unknown as { ok: boolean; error?: string; message?: string; return_id?: string };
}

// ----------------------------------------------------------------- reviews --

export type ProductReview = Tables<"product_reviews">;

export async function fetchReviews(productId: string): Promise<ProductReview[]> {
  const { data, error } = await supabase
    .from("product_reviews")
    .select("*")
    .eq("product_id", productId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function submitReview(input: {
  productId: string;
  rating: number;
  title?: string;
  body?: string;
  authorName?: string;
}): Promise<{ ok: boolean; message: string }> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, message: "Log ind for at skrive en anmeldelse." };

  // upsert so a customer can revise their own review instead of hitting the
  // one-review-per-product unique index.
  const { error } = await supabase.from("product_reviews").upsert(
    {
      product_id: input.productId,
      user_id: auth.user.id,
      rating: Math.min(5, Math.max(1, Math.round(input.rating))),
      title: input.title?.trim() || null,
      body: input.body?.trim() || null,
      author_name: input.authorName?.trim() || null,
      status: "pending",
    },
    { onConflict: "product_id,user_id" },
  );

  if (error) return { ok: false, message: error.message };
  return { ok: true, message: "Tak! Din anmeldelse vises, når den er godkendt." };
}

// ---------------------------------------------------------------- settings --

export type ShopCompany = {
  name: string;
  cvr: string;
  address: string;
  email: string;
  phone: string;
  support_hours: string;
};

export type ShopPolicies = {
  return_days: number;
  right_of_withdrawal_days: number;
  privacy_version: string;
};

/** Cached for the page's lifetime — these change about once a year. */
let settingsCache: Record<string, unknown> | null = null;

export async function fetchShopSettings(): Promise<Record<string, unknown>> {
  if (settingsCache) return settingsCache;
  const { data } = await supabase.from("shop_settings").select("key, value");
  settingsCache = Object.fromEntries((data ?? []).map((r) => [r.key, r.value]));
  return settingsCache;
}

export async function fetchCompany(): Promise<ShopCompany | null> {
  const s = await fetchShopSettings();
  return (s.company as ShopCompany) ?? null;
}

// ------------------------------------------------------------------ search --

export type SearchHit = {
  kind: "product" | "plant";
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  category: string;
  price_dkk: number | null;
  image_url: string | null;
  gradient: string | null;
  rank: number;
};

export async function searchCatalog(q: string, limit = 12): Promise<SearchHit[]> {
  const query = q.trim();
  if (query.length < 2) return [];
  const { data, error } = await supabase.rpc("search_catalog", { p_q: query, p_limit: limit });
  if (error) {
    console.warn("[search] failed", error.message);
    return [];
  }
  return (data ?? []) as SearchHit[];
}
