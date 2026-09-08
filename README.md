# Havekongen

Din have, dit kongerige. Havekongen measures a Danish garden from public map
data, builds a 3D twin of it, plans the watering and the seasonal jobs, listens
for the birds in it, and sells the seeds, soil and tools to keep it going.

Danish-language product, built on React + Vite + Supabase.

---

## What is in here

| Area | Route | What it does |
| --- | --- | --- |
| **Havemåler** | `/havemaaler` | Draw the garden on an orthophoto, measured against the cadastre. Areas come from Dataforsyningen, not from guesswork. |
| **3D-haven** | `/havemaaler/3d` | Terrain and object heights from Danmarks Højdemodel. Trees, hedges and sheds are detected and offered for approval. |
| **Havekompagnon** | `/havekompagnon` | Beds, plants, watering schedules and tasks, adjusted for soil, sun and the weather that actually happened. |
| **Dyreliv** | `/dyreliv` | Bird listener and a life list of what lives in the garden. |
| **Plantepleje AI** | `/ai` | Photo diagnosis, plant identification and a care assistant. |
| **Webshop** | `/webshop` | Seeds, plants, soil and tools. Server-priced, stock-tracked, VAT-correct. |
| **Admin** | `/admin` | Catalogue, orders, discounts, reviews, support inbox, users, content, analytics, audit log. |

---

## Getting started

```bash
npm ci
cp .env.example .env      # then fill in your Supabase project
npm run dev               # http://localhost:8080
```

### Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server on port 8080 |
| `npm run build` | Production bundle |
| `npm run typecheck` | `tsc --noEmit` over the app |
| `npm run lint` | ESLint (see *Lint baseline* below) |
| `npm run test` | Vitest, single run |
| `npm run test:watch` | Vitest in watch mode |
| `node scripts/generate-sitemap.mjs` | Rebuild `public/sitemap.xml` including product pages |

### Environment

Only three variables are needed to run the front end; everything secret lives in
Supabase.

| Variable | Where | Purpose |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | `.env` | Project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | `.env` | Anon key. Safe in the browser — RLS is what protects the data. |
| `VITE_SUPABASE_PROJECT_ID` | `.env` | Used by the Supabase CLI |

> `.env` is currently tracked in git. That is safe as far as it goes — all three
> values are compiled into the browser bundle regardless — but it is a trap: the
> next person to put a real secret in that file will commit it. Untracking it
> needs the deploy to supply the variables first, so it is deliberately left for
> a follow-up rather than done blind here. **Never put a service-role key, an
> API key or a webhook secret in `.env`.**

Edge function secrets (set with `supabase secrets set`):

| Variable | Required for | If missing |
| --- | --- | --- |
| `OPENAI_API_KEY` | every AI function | those functions return 500 |
| `DATAFORSYNINGEN_TOKEN` | maps, cadastre, elevation | Havemåler cannot load imagery |
| `ALLOWED_ORIGINS` | CORS allowlist | falls back to the havekongen.dk domains plus localhost |
| `RESEND_API_KEY` | order emails | emails are logged and skipped, orders still work |
| `EMAIL_FROM`, `EMAIL_REPLY_TO`, `SITE_URL` | email formatting | sensible defaults |
| `STRIPE_SECRET_KEY` | card payment | card option returns "not enabled"; bank transfer still works |
| `STRIPE_WEBHOOK_SECRET` | confirming card payments | the webhook **refuses every request** rather than trusting the body |
| `GARDEN_SCAN_WORKER_SECRET` | the scan worker | the worker is rate-limited like a browser |

---

## Architecture

```
Browser (React)
    │  anon key + user JWT
    ├─────────────► PostgREST ──► Postgres  (RLS on every table)
    │                                 │
    │                                 └── RPCs: quote_cart, place_order,
    │                                     cancel_order, request_return,
    │                                     admin_update_order, search_catalog,
    │                                     export_my_data …
    │
    └─────────────► Edge functions (Deno)
                        │  guard(): origin allowlist → identity →
                        │           admin check → rate limit → AI budget
                        ├── AI: plant-diagnose, identify-plant, garden-chat …
                        ├── Data: get-elevation, get-matrikel, ortofoto-tile …
                        └── Commerce: checkout-payment, payment-webhook,
                            account-delete
```

### The rule that shapes the commerce code

**The browser never decides an amount.** It sends
`{product_id, variant_id, qty}` triples; the database looks up the price,
checks the stock, validates the discount code, computes 25% moms and writes the
order in one transaction. `quote_cart()` is the read-only half of the same
engine, so the total shown in the basket is produced by the code that will bill
you. `INSERT`, `UPDATE` and `DELETE` on `orders` and `order_items` are revoked
from `authenticated` entirely.

### Money units

Two units, deliberately named apart:

- **kroner** — whole DKK. What the catalogue stores (`base_price_dkk`,
  `price_dkk`) and what an admin types into the product editor.
- **øre** — 1/100 kr. Every *computed* amount (`total_oere`, `vat_oere`,
  `line_total_oere` …), so percentage discounts and inclusive VAT round exactly
  once, at the line, instead of drifting across a basket.

`src/lib/money.ts` mirrors the SQL in
`supabase/migrations/20260908100100_commerce_v2_functions.sql`. The mirror
exists for instant UI feedback only; the charged figure always comes back from
the database.

### Inventory

`track_inventory` decides whether `stock_qty` means anything. When it is off,
the `in_stock` boolean decides. Both `products` and `product_variants` follow
the same rule, and so do the pricing engine, the product page and the shop grid.

### Order lifecycle

```
pending ──► paid ──► packed ──► shipped ──► delivered
   │          │         │           │           │
   └──────────┴─────────┴──► cancelled          └──► returned ──► refunded
```

`order_status_can_transition()` is the single definition, used by the customer
path, the admin path and the payment webhook alike. Every change appends to
`order_events`, so support can answer "what happened to order X" without
guessing. Cancelling restocks; so does marking a return as received.

---

## Testing

```bash
npm run test        # 130 unit tests
```

The interesting half runs in CI: `.github/workflows/ci.yml` applies every
migration to a real Postgres 15 and then executes
`supabase/tests/pricing_test.sql` against it. PL/pgSQL function bodies are only
compiled when `CREATE FUNCTION` actually runs, so this is the step that proves
the SQL works rather than merely parses. It checks the VAT arithmetic, the
discount allocation and its rounding, the stock ceiling, order placement,
idempotent replay, cancellation restock, review verification, the rate limiter,
and that the browser still cannot insert an order.

`supabase/tests/bootstrap.sql` supplies the `auth` and `storage` scaffolding a
plain Postgres lacks. It is test-only and is never applied to a project.

### Lint baseline

`npm run lint` is clean at **error** level and reports ~115 warnings. Most are
`no-explicit-any` in pre-v2 files (Supabase JSON payloads, the Three.js scene).
They are warnings rather than errors on purpose: failing the build on them would
either block every PR or force a mass rewrite of files unrelated to the change
at hand. The number is visible in every CI run; new code should not add to it.

---

## Database

Migrations are plain SQL in `supabase/migrations`, applied in filename order.

```bash
supabase db push                       # apply to the linked project
supabase gen types typescript --linked > src/integrations/supabase/types.ts
```

Every table has RLS enabled. The general shape:

- **Own rows** — `auth.uid() = user_id`, for gardens, plants, orders, addresses.
- **Public read** — products, variants, shipping methods, approved reviews.
- **Admin** — `public.has_role(auth.uid(), 'admin')`, backed by `user_roles`.
  Roles live in a table, never in a JWT claim, so a token cannot claim to be an
  admin.
- **Service-role only** — `rate_limit_buckets`, `mark_order_paid()`,
  `consume_rate_limit()`. No policy and no grant; only edge functions reach
  them.

---

## Privacy and law

The shop sells to Danish consumers, so a few things are not optional:

- Prices include 25% moms, broken out on the order and the receipt.
- 14 days' right of withdrawal, 30 days' return, 2 years' reklamationsret —
  published at `/handelsbetingelser` and `/levering-og-retur`.
- Analytics and marketing storage require opt-in *before* it happens. `track()`
  drops events until consent is given rather than buffering them. A handful of
  operational events (order placed, checkout failed) still record, carrying no
  identifiers, because we need to know when the till is broken.
- `export_my_data()` returns everything we hold as one JSON document, and
  `account-delete` performs erasure — anonymising the order rows that
  bookkeeping law requires us to keep for five years.

Company details, bank account and policy durations live in the `shop_settings`
table, not in six copies across the pages.

---

## Docs

- [`docs/havemaaler-3d-garden-twin.md`](docs/havemaaler-3d-garden-twin.md) — how
  the 3D garden twin is built from DHM.
- [`docs/commerce.md`](docs/commerce.md) — the order pipeline end to end, and
  the runbook for payments, refunds and stock.
