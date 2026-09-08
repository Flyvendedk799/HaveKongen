# The order pipeline

How a Havekongen order is priced, placed, paid, packed, and — when it comes to
it — cancelled or refunded. Plus the runbook for the things that go wrong.

---

## The one rule

**The browser never decides an amount.**

Version 1 let the client `INSERT` into `orders` with whatever `total_dkk` it
liked. Anyone with the devtools console open could have bought a robot mower for
one krone. In v2 that grant is gone:

```sql
revoke insert, update, delete on public.orders from authenticated, anon;
revoke insert, update, delete on public.order_items from authenticated, anon;
```

Everything now goes through `place_order()`, a `SECURITY DEFINER` function that
takes identity and quantity and derives the rest itself.

---

## Pricing

`price_cart(items, shipping_method, discount_code, user)` is the engine. It is
not callable from a session; two thin wrappers expose it:

| Function | Callable by | Writes? |
| --- | --- | --- |
| `quote_cart(items, method, code)` | anon, authenticated | no |
| `place_order(…)` | authenticated | yes |

Because both go through the same engine, the total in the basket is produced by
the code that will bill you. There is no second implementation to drift.

### What it does, in order

1. **Resolve each line** against the catalogue. Unknown, inactive or
   out-of-stock products become *problems* rather than silently vanishing, so
   the checkout can say "we only have 2 left" and offer to fix it.
2. **Price it.** `unit_price_oere = coalesce(variant.price_dkk, product.base_price_dkk) * 100`.
3. **Shipping**, from the `shipping_methods` table.
4. **Discount**, validated against its time window, spend floor, per-user limit
   and global quota. `discount_codes` has no public `select` policy, so codes
   cannot be scraped — they are only ever validated server-side.
5. **Free-shipping threshold**, evaluated on what the customer actually pays
   (after discount), not on the gross subtotal.
6. **Allocate and tax.** The discount is spread across lines in proportion to
   their value; the last line absorbs the rounding remainder so the parts always
   sum back to the whole. VAT is then taken out of each discounted line.

### Money units

| Unit | Where | Why |
| --- | --- | --- |
| kroner | `base_price_dkk`, `price_dkk` | what the admin types, what v1 stored |
| øre | `total_oere`, `vat_oere`, `line_total_oere`, … | one rounding, at the line |

Danish VAT is quoted **inclusive**, so the tax inside a gross amount is
`gross × rate / (1 + rate)` — for the standard 25% rate, exactly a fifth of the
gross. `vat_of_gross()` in SQL and `vatOfGross()` in `src/lib/money.ts` are the
same expression.

Worked example — 2 × 349 kr + 1 × 125 kr with a 10% code:

```
subtotal        82 300 øre
discount        −8 230        (10% of 82 300)
shipping             0        (free over 499 kr, evaluated on 74 070)
total           74 070 øre
  line 1 discount  6 980      floor(69 800 × 8 230 / 82 300)
  line 2 discount  1 250      the remainder, so the parts sum to 8 230
  VAT             14 814      = 74 070 / 5
```

That case is asserted in `supabase/tests/pricing_test.sql`.

---

## Inventory

`track_inventory` decides whether `stock_qty` means anything; when it is off the
`in_stock` boolean decides. `products` and `product_variants` both follow this,
and so do the pricing engine, the product page and the shop grid.

Overselling is prevented by the `WHERE` clause, not by a check-then-write:

```sql
update public.products
   set stock_qty = stock_qty - qty
 where id = … and track_inventory and stock_qty >= qty;
-- 0 rows on a tracked product ⇒ raise ⇒ the whole order rolls back
```

Two simultaneous checkouts for the last item cannot both succeed: the second
`UPDATE` matches nothing and its transaction aborts. Every movement is recorded
in `inventory_movements`.

Stock goes back on the shelf on cancellation and when a return is marked
*received*.

---

## Placing an order

```
place_order(items, shipping_address, method, billing, email, phone,
            code, note, provider, idempotency_key)
```

In one transaction it: locks the catalogue rows, prices the cart, writes the
order with a human order number (`HK-YYMMDD-01042`), writes the lines, draws
down stock, records the discount redemption, opens a `payments` row, appends an
`order_events` entry and notifies the customer.

**Idempotency.** The client generates a key per checkout attempt and reuses it
across retries. A repeat returns the original order instead of creating a second
one — so a double click, or a retry after a dropped connection, cannot buy
twice. The key is only regenerated after a *successful* order.

---

## Payment

`place_order()` creates the order as `pending` / `unpaid` and stops. The
`checkout-payment` edge function is the second half.

### Bank transfer (`invoice`) — works today

Returns the account details and the order number to quote as the payment
reference, from `shop_settings.payment_invoice`. An admin marks it paid from the
order page when the money lands, via `admin_mark_order_paid()`.

### Card (`stripe`) — enabled by configuration

Active only when `STRIPE_SECRET_KEY` is set; otherwise the checkout says so
plainly rather than pretending to charge. It creates a Checkout Session for one
aggregated line — the database has already decided the amount, and sending it as
a single figure removes any chance of the two disagreeing.

`payment-webhook` confirms it. It is public (`verify_jwt = false`) because
Stripe has no Havekongen session, so **the signature check is the only thing
between the internet and "this order is paid"**. With no `STRIPE_WEBHOOK_SECRET`
configured the function refuses every request rather than trusting the body. It
also enforces a five-minute freshness window against replay, and
`mark_order_paid()` rejects an amount that does not match the order.

---

## Lifecycle

```
pending ──► paid ──► packed ──► shipped ──► delivered
   │          │         │           │           │
   └──────────┴─────────┴──► cancelled          └──► returned ──► refunded
```

`order_status_can_transition(from, to)` is the single definition, shared by the
customer path, the admin path and the webhook. Every change appends to
`order_events` with who did it and why.

| Action | Who | Function |
| --- | --- | --- |
| Cancel | customer, while not yet shipped | `cancel_order()` |
| Request return | customer, within 30 days of delivery | `request_return()` |
| Change status / add tracking | admin | `admin_update_order()` |
| Mark a transfer paid | admin | `admin_mark_order_paid()` |
| Resolve a return | admin | `admin_resolve_return()` |
| Confirm a card payment | webhook | `mark_order_paid()` |

Cancelling also releases the discount code, so a cancelled order does not burn
the customer's one allowed use of it.

---

## Runbook

**"A customer says they paid but the order still says awaiting payment."**
Open `/admin/orders/<id>`. For a bank transfer, confirm the amount against the
order number and press *Markér som betalt*. For a card payment, check
`order_events` for `payment_rejected` — an amount mismatch is logged there with
the Stripe id.

**"The order page shows 'betaling fejlet'."**
The order exists and stock is reserved; only the payment setup failed. The
customer can press *Forbered betaling* again, or you can from the admin page.
Nothing was charged.

**"Stock is wrong."**
`inventory_movements` has every change with a reason and an order id. Sum the
deltas for a product to see how it got where it is. Adjust `stock_qty` directly
and record why in the `note`.

**"Someone is hammering the AI functions."**
`ai_usage` has calls per user per day per function; `rate_limit_buckets` has the
short-window counters. Budgets are set per function in the `guard()` call at the
top of each handler. Both fail *open* — a limiter outage should not take the
site down — and log when they do.

**"We need to raise the free-shipping threshold."**
`update shipping_methods set free_over_oere = … where code = 'standard';`. The
checkout, the shipping page and the pricing engine all read that row; no deploy
needed.

**"A review is wrong or abusive."**
`/admin/reviews`. Only `approved` rows are public and only they count towards
`products.rating_avg`, which a trigger keeps in step. Rejecting one removes it
from the score immediately.

---

## Testing

`supabase/tests/pricing_test.sql` runs in CI against a real Postgres after every
migration has been applied. It asserts the VAT arithmetic, the discount
allocation and its rounding, the stock ceiling, order placement, idempotent
replay, the cancellation restock, the review verification trigger, the rate
limiter, the newsletter and contact intake, the GDPR export — and that
`authenticated` still has no `INSERT` on `orders`.

That last assertion is the regression test for the v1 hole. If someone
re-grants it, CI fails.
