-- Havekongen v2 — commerce backbone.
--
-- The v1 shop let the browser insert an order row with whatever total it liked,
-- tracked stock as a single boolean and had no VAT, no payment record and no
-- lifecycle. This migration adds the tables and columns a real Danish webshop
-- needs; the pricing and ordering functions live in the companion migration.
--
-- Money convention: catalogue prices stay in whole kroner (base_price_dkk,
-- price_dkk) because that is what the admin UI and the seeded rows use. Every
-- *computed* amount is stored in øre (1/100 kr) so 25% moms and percentage
-- discounts round exactly once, at the line, instead of drifting across a cart.

-- ---------------------------------------------------------------- catalogue --

-- product_variants already carried the (stock_qty, track_inventory) pair from
-- the v1 admin work; products get the same two columns so one rule covers both:
-- track_inventory decides whether stock_qty means anything, and when it is off
-- the in_stock boolean is still honoured.
alter table public.products
  add column if not exists sku text,
  add column if not exists stock_qty int not null default 0,
  add column if not exists track_inventory boolean not null default false,
  add column if not exists low_stock_threshold int not null default 5,
  add column if not exists vat_rate numeric(4,3) not null default 0.250,
  add column if not exists active boolean not null default true,
  add column if not exists rating_avg numeric(3,2) not null default 0,
  add column if not exists rating_count int not null default 0,
  add column if not exists weight_grams int,
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists products_sku_key on public.products (sku) where sku is not null;
create index if not exists products_category_idx on public.products (category) where active;

alter table public.product_variants
  add column if not exists stock_qty int not null default 0,
  add column if not exists track_inventory boolean not null default false,
  add column if not exists low_stock_threshold int not null default 5,
  add column if not exists weight_grams int,
  add column if not exists position int not null default 0;

create unique index if not exists product_variants_sku_key on public.product_variants (sku) where sku is not null;

-- Free-text search over the catalogue. Danish stemming so "planter" matches
-- "plante"; the coalesce chain keeps the vector non-null for sparse rows.
create index if not exists products_search_idx on public.products
  using gin (to_tsvector('danish',
    coalesce(name,'') || ' ' || coalesce(short_description,'') || ' ' ||
    coalesce(description,'') || ' ' || coalesce(category,'')));

-- ------------------------------------------------------------- fulfilment ----

create table if not exists public.shipping_methods (
  code text primary key,
  name text not null,
  description text,
  carrier text,
  price_oere int not null,
  free_over_oere int,                                            -- null = never free
  eta_min_days int not null default 2,
  eta_max_days int not null default 4,
  active boolean not null default true,
  sort int not null default 0
);
alter table public.shipping_methods enable row level security;
drop policy if exists "shipping methods public read" on public.shipping_methods;
create policy "shipping methods public read" on public.shipping_methods
  for select to anon, authenticated using (active);
drop policy if exists "shipping methods admin write" on public.shipping_methods;
create policy "shipping methods admin write" on public.shipping_methods
  for all to authenticated
  using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));

insert into public.shipping_methods (code, name, description, carrier, price_oere, free_over_oere, eta_min_days, eta_max_days, sort)
values
  ('standard', 'Standard', 'Leveres til din adresse', 'GLS', 4900, 49900, 2, 4, 10),
  ('express',  'Ekspres',  'Bestil før kl. 14 på hverdage', 'GLS', 9900, null, 1, 2, 20),
  ('pickup',   'Pakkeshop','Afhentes i nærmeste pakkeshop', 'GLS', 2900, 39900, 2, 5, 5)
on conflict (code) do nothing;

-- ---------------------------------------------------------------- discounts --

create table if not exists public.discount_codes (
  code text primary key,
  kind text not null check (kind in ('percent','fixed','free_shipping')),
  value numeric not null default 0,                              -- percent: 0-100, fixed: øre
  description text,
  min_subtotal_oere int not null default 0,
  category text,                                                 -- null = whole cart
  starts_at timestamptz,
  ends_at timestamptz,
  max_redemptions int,
  per_user_limit int not null default 1,
  redemptions int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.discount_codes enable row level security;
-- Deliberately no public select policy: codes are validated server-side by
-- quote_cart/place_order so the list cannot be scraped.
drop policy if exists "discount codes admin" on public.discount_codes;
create policy "discount codes admin" on public.discount_codes
  for all to authenticated
  using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));

create table if not exists public.discount_redemptions (
  id uuid primary key default gen_random_uuid(),
  code text not null references public.discount_codes(code) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  order_id uuid,
  amount_oere int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists discount_redemptions_user_idx on public.discount_redemptions (user_id, code);
alter table public.discount_redemptions enable row level security;
drop policy if exists "own redemptions select" on public.discount_redemptions;
create policy "own redemptions select" on public.discount_redemptions
  for select to authenticated using (auth.uid() = user_id or public.has_role(auth.uid(),'admin'));

-- ------------------------------------------------------------------ orders --

alter table public.orders
  add column if not exists order_no text,
  add column if not exists email text,
  add column if not exists phone text,
  add column if not exists billing_address jsonb,
  add column if not exists shipping_method text,
  add column if not exists subtotal_oere int not null default 0,
  add column if not exists shipping_oere int not null default 0,
  add column if not exists discount_oere int not null default 0,
  add column if not exists vat_oere int not null default 0,
  add column if not exists total_oere int not null default 0,
  add column if not exists currency text not null default 'DKK',
  add column if not exists discount_code text,
  add column if not exists payment_status text not null default 'unpaid',
  add column if not exists payment_provider text,
  add column if not exists idempotency_key text,
  add column if not exists placed_at timestamptz,
  add column if not exists paid_at timestamptz,
  add column if not exists shipped_at timestamptz,
  add column if not exists delivered_at timestamptz,
  add column if not exists cancelled_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists orders_order_no_key on public.orders (order_no) where order_no is not null;
create unique index if not exists orders_idempotency_key on public.orders (user_id, idempotency_key) where idempotency_key is not null;
create index if not exists orders_status_idx on public.orders (status, created_at desc);

do $$ begin
  alter table public.orders add constraint orders_payment_status_chk
    check (payment_status in ('unpaid','authorized','paid','refunded','partially_refunded','failed'));
exception when duplicate_object then null; end $$;

-- Human-facing order number: HK-YYMMDD-01000. A dedicated sequence keeps it
-- monotonic and gap-tolerant without locking the orders table.
create sequence if not exists public.order_no_seq start 1000;

create or replace function public.next_order_no()
returns text
language sql
volatile
set search_path = public
as $fn$
  select 'HK-' || to_char(now() at time zone 'Europe/Copenhagen', 'YYMMDD') || '-' ||
         lpad((nextval('public.order_no_seq') % 100000)::text, 5, '0')
$fn$;

alter table public.order_items
  add column if not exists sku text,
  add column if not exists product_slug text,
  add column if not exists variant_name text,
  add column if not exists unit_price_oere int not null default 0,
  add column if not exists line_total_oere int not null default 0,
  add column if not exists line_discount_oere int not null default 0,
  add column if not exists vat_rate numeric(4,3) not null default 0.250,
  add column if not exists vat_oere int not null default 0,
  add column if not exists image_url text,
  add column if not exists gradient text,
  add column if not exists svg_art text;

create index if not exists order_items_order_idx on public.order_items (order_id);

-- Append-only lifecycle trail. Every status change, payment and refund lands
-- here so support can answer "what happened to order X" without guessing.
create table if not exists public.order_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  actor_kind text not null default 'system' check (actor_kind in ('system','customer','admin','webhook')),
  kind text not null,
  from_status text,
  to_status text,
  message text,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists order_events_order_idx on public.order_events (order_id, created_at);
alter table public.order_events enable row level security;
drop policy if exists "own order events select" on public.order_events;
create policy "own order events select" on public.order_events
  for select to authenticated using (
    public.has_role(auth.uid(),'admin')
    or exists (select 1 from public.orders o where o.id = order_id and o.user_id = auth.uid())
  );

-- ---------------------------------------------------------------- payments --

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null,                                        -- 'invoice' | 'stripe' | ...
  status text not null default 'pending'
    check (status in ('pending','requires_action','authorized','paid','failed','cancelled','refunded')),
  amount_oere int not null,
  refunded_oere int not null default 0,
  currency text not null default 'DKK',
  reference text,                                                -- provider-side id
  instructions jsonb,                                            -- e.g. bank details for invoice
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  paid_at timestamptz
);
create index if not exists payments_order_idx on public.payments (order_id);
create unique index if not exists payments_provider_ref_key on public.payments (provider, reference) where reference is not null;
alter table public.payments enable row level security;
drop policy if exists "own payments select" on public.payments;
create policy "own payments select" on public.payments
  for select to authenticated using (auth.uid() = user_id or public.has_role(auth.uid(),'admin'));

-- ----------------------------------------------------------------- returns --

create table if not exists public.order_returns (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'requested'
    check (status in ('requested','approved','rejected','received','refunded','cancelled')),
  reason text not null,
  comment text,
  refund_oere int not null default 0,
  admin_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index if not exists order_returns_order_idx on public.order_returns (order_id);
alter table public.order_returns enable row level security;
drop policy if exists "own returns select" on public.order_returns;
create policy "own returns select" on public.order_returns
  for select to authenticated using (auth.uid() = user_id or public.has_role(auth.uid(),'admin'));
drop policy if exists "admins manage returns" on public.order_returns;
create policy "admins manage returns" on public.order_returns
  for update to authenticated
  using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));

create table if not exists public.order_return_items (
  id uuid primary key default gen_random_uuid(),
  return_id uuid not null references public.order_returns(id) on delete cascade,
  order_item_id uuid not null references public.order_items(id) on delete cascade,
  qty int not null check (qty > 0)
);
alter table public.order_return_items enable row level security;
drop policy if exists "own return items select" on public.order_return_items;
create policy "own return items select" on public.order_return_items
  for select to authenticated using (
    public.has_role(auth.uid(),'admin')
    or exists (select 1 from public.order_returns r where r.id = return_id and r.user_id = auth.uid())
  );

-- --------------------------------------------------------------- inventory --

create table if not exists public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references public.products(id) on delete set null,
  variant_id uuid references public.product_variants(id) on delete set null,
  order_id uuid references public.orders(id) on delete set null,
  delta int not null,
  reason text not null,                                          -- 'order' | 'cancel' | 'return' | 'manual'
  actor_id uuid references auth.users(id) on delete set null,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists inventory_movements_product_idx on public.inventory_movements (product_id, created_at desc);
alter table public.inventory_movements enable row level security;
drop policy if exists "inventory admin read" on public.inventory_movements;
create policy "inventory admin read" on public.inventory_movements
  for select to authenticated using (public.has_role(auth.uid(),'admin'));

-- ----------------------------------------------------------------- reviews --

create table if not exists public.product_reviews (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  -- Nullable on purpose: when an account is erased under GDPR the review keeps
  -- its rating (so the product score does not jump) but loses its author.
  user_id uuid references auth.users(id) on delete set null,
  order_id uuid references public.orders(id) on delete set null,
  rating int not null check (rating between 1 and 5),
  title text,
  body text,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  verified_purchase boolean not null default false,
  author_name text,
  admin_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, user_id)
);
create index if not exists product_reviews_product_idx on public.product_reviews (product_id, status);
alter table public.product_reviews enable row level security;
drop policy if exists "approved reviews public read" on public.product_reviews;
create policy "approved reviews public read" on public.product_reviews
  for select to anon, authenticated
  using (status = 'approved' or auth.uid() = user_id or public.has_role(auth.uid(),'admin'));
drop policy if exists "own review insert" on public.product_reviews;
create policy "own review insert" on public.product_reviews
  for insert to authenticated with check (auth.uid() = user_id and status = 'pending');
drop policy if exists "own review update" on public.product_reviews;
create policy "own review update" on public.product_reviews
  for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id and status = 'pending');
drop policy if exists "own review delete" on public.product_reviews;
create policy "own review delete" on public.product_reviews
  for delete to authenticated using (auth.uid() = user_id or public.has_role(auth.uid(),'admin'));
drop policy if exists "admin review moderate" on public.product_reviews;
create policy "admin review moderate" on public.product_reviews
  for update to authenticated
  using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));

-- Keep the denormalised rating on products in step with approved reviews so the
-- shop grid can sort by rating without a join per row.
create or replace function public.sync_product_rating()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  target uuid := coalesce(new.product_id, old.product_id);
begin
  update public.products p
     set rating_avg = coalesce(agg.avg_rating, 0),
         rating_count = coalesce(agg.n, 0)
    from (
      select avg(rating)::numeric(3,2) as avg_rating, count(*) as n
        from public.product_reviews
       where product_id = target and status = 'approved'
    ) agg
   where p.id = target;
  return null;
end;
$fn$;

drop trigger if exists product_reviews_rating_sync on public.product_reviews;
create trigger product_reviews_rating_sync
  after insert or update or delete on public.product_reviews
  for each row execute function public.sync_product_rating();

-- --------------------------------------------------------------- addresses --

create table if not exists public.addresses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  label text,
  name text not null,
  street text not null,
  street2 text,
  postal_code text not null,
  city text not null,
  country text not null default 'DK',
  phone text,
  is_default_shipping boolean not null default false,
  is_default_billing boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists addresses_user_idx on public.addresses (user_id);
alter table public.addresses enable row level security;
drop policy if exists "own addresses" on public.addresses;
create policy "own addresses" on public.addresses
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Only one default of each kind per user; enforced rather than hoped for.
create or replace function public.enforce_single_default_address()
returns trigger
language plpgsql
set search_path = public
as $fn$
begin
  if new.is_default_shipping then
    update public.addresses set is_default_shipping = false
     where user_id = new.user_id and id <> new.id and is_default_shipping;
  end if;
  if new.is_default_billing then
    update public.addresses set is_default_billing = false
     where user_id = new.user_id and id <> new.id and is_default_billing;
  end if;
  return new;
end;
$fn$;

drop trigger if exists addresses_single_default on public.addresses;
create trigger addresses_single_default
  after insert or update of is_default_shipping, is_default_billing on public.addresses
  for each row execute function public.enforce_single_default_address();
