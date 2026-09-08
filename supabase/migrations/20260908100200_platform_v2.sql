-- Havekongen v2 — platform layer.
--
-- Covers the things every edge function and every page needed but none of them
-- had: a shared rate limiter, per-user AI budgets, cookie consent, newsletter
-- and contact intake, GDPR self-service, and a single place to keep the shop's
-- company details instead of hard-coding them in the footer.

-- ------------------------------------------------------------ rate limits --

-- One row per (identity, action) bucket, fixed window. Written only by edge
-- functions holding the service role; never readable from the browser.
create table if not exists public.rate_limit_buckets (
  bucket_key text primary key,
  window_start timestamptz not null default now(),
  hits int not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.rate_limit_buckets enable row level security;
-- No policies on purpose: only the service role (which bypasses RLS) touches it.

create or replace function public.consume_rate_limit(
  p_key text,
  p_limit int,
  p_window_seconds int
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $fn$
declare
  row_now public.rate_limit_buckets%rowtype;
  win interval := make_interval(secs => greatest(1, p_window_seconds));
begin
  insert into public.rate_limit_buckets as b (bucket_key, window_start, hits, updated_at)
  values (p_key, now(), 1, now())
  on conflict (bucket_key) do update
    set hits = case when b.window_start < now() - win then 1 else b.hits + 1 end,
        window_start = case when b.window_start < now() - win then now() else b.window_start end,
        updated_at = now()
  returning * into row_now;

  return jsonb_build_object(
    'allowed', row_now.hits <= p_limit,
    'hits', row_now.hits,
    'limit', p_limit,
    'remaining', greatest(0, p_limit - row_now.hits),
    'reset_at', row_now.window_start + win
  );
end;
$fn$;

-- Housekeeping: buckets are disposable, so anything untouched for a day goes.
create or replace function public.prune_rate_limits()
returns int
language sql
volatile
security definer
set search_path = public
as $fn$
  with gone as (
    delete from public.rate_limit_buckets where updated_at < now() - interval '1 day' returning 1
  ) select count(*)::int from gone
$fn$;

-- ------------------------------------------------------------- AI budgets --

-- The AI edge functions call OpenAI on Havekongen's key. Without a per-account
-- daily budget one signed-up user can spend the whole month's tokens.
create table if not exists public.ai_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  anon_key text,
  day date not null default (now() at time zone 'Europe/Copenhagen')::date,
  fn text not null,
  calls int not null default 0,
  tokens_in int not null default 0,
  tokens_out int not null default 0,
  updated_at timestamptz not null default now()
);
create unique index if not exists ai_usage_user_day_fn on public.ai_usage (user_id, day, fn) where user_id is not null;
create unique index if not exists ai_usage_anon_day_fn on public.ai_usage (anon_key, day, fn) where user_id is null;
alter table public.ai_usage enable row level security;
drop policy if exists "own ai usage" on public.ai_usage;
create policy "own ai usage" on public.ai_usage
  for select to authenticated using (auth.uid() = user_id or public.has_role(auth.uid(),'admin'));

create or replace function public.consume_ai_quota(
  p_user uuid,
  p_anon text,
  p_fn text,
  p_daily_limit int
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $fn$
declare
  used int;
  today date := (now() at time zone 'Europe/Copenhagen')::date;
begin
  if p_user is not null then
    insert into public.ai_usage (user_id, day, fn, calls, updated_at)
    values (p_user, today, p_fn, 1, now())
    on conflict (user_id, day, fn) where user_id is not null
      do update set calls = ai_usage.calls + 1, updated_at = now()
    returning calls into used;
  else
    insert into public.ai_usage (anon_key, day, fn, calls, updated_at)
    values (coalesce(p_anon, 'unknown'), today, p_fn, 1, now())
    on conflict (anon_key, day, fn) where user_id is null
      do update set calls = ai_usage.calls + 1, updated_at = now()
    returning calls into used;
  end if;

  return jsonb_build_object(
    'allowed', used <= p_daily_limit,
    'used', used,
    'limit', p_daily_limit,
    'remaining', greatest(0, p_daily_limit - used)
  );
end;
$fn$;

create or replace function public.record_ai_tokens(
  p_user uuid, p_anon text, p_fn text, p_in int, p_out int
)
returns void
language sql
volatile
security definer
set search_path = public
as $fn$
  update public.ai_usage
     set tokens_in = tokens_in + coalesce(p_in, 0),
         tokens_out = tokens_out + coalesce(p_out, 0),
         updated_at = now()
   where fn = p_fn
     and day = (now() at time zone 'Europe/Copenhagen')::date
     and ((p_user is not null and user_id = p_user)
       or (p_user is null and user_id is null and anon_key = coalesce(p_anon, 'unknown')))
$fn$;

-- --------------------------------------------------------------- consents --

-- GDPR/ePrivacy: what the visitor actually agreed to, when, and against which
-- version of the policy. Anonymous visitors are keyed by a random local id.
create table if not exists public.consents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  anon_id text,
  necessary boolean not null default true,
  analytics boolean not null default false,
  marketing boolean not null default false,
  functional boolean not null default false,
  policy_version text not null default '2026-09',
  user_agent text,
  created_at timestamptz not null default now()
);
create index if not exists consents_user_idx on public.consents (user_id, created_at desc);
create index if not exists consents_anon_idx on public.consents (anon_id, created_at desc);
alter table public.consents enable row level security;
drop policy if exists "consent insert" on public.consents;
create policy "consent insert" on public.consents
  for insert to anon, authenticated
  with check (user_id is null or user_id = auth.uid());
drop policy if exists "own consent select" on public.consents;
create policy "own consent select" on public.consents
  for select to authenticated using (auth.uid() = user_id or public.has_role(auth.uid(),'admin'));

-- ------------------------------------------------------------- newsletter --

create table if not exists public.newsletter_subscribers (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  status text not null default 'pending' check (status in ('pending','confirmed','unsubscribed','bounced')),
  token uuid not null default gen_random_uuid(),
  source text,
  user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  unsubscribed_at timestamptz
);
create unique index if not exists newsletter_email_key on public.newsletter_subscribers (lower(email));
alter table public.newsletter_subscribers enable row level security;
drop policy if exists "newsletter admin read" on public.newsletter_subscribers;
create policy "newsletter admin read" on public.newsletter_subscribers
  for select to authenticated using (public.has_role(auth.uid(),'admin'));

-- Signing up goes through a function so the table cannot be probed to find out
-- whether an address is already on the list.
create or replace function public.subscribe_newsletter(p_email text, p_source text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $fn$
declare clean text := lower(trim(coalesce(p_email, '')));
begin
  if clean !~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$' then
    return jsonb_build_object('ok', false, 'error', 'invalid_email',
                              'message', 'Indtast en gyldig e-mailadresse.');
  end if;

  insert into public.newsletter_subscribers (email, source, user_id, status)
  values (clean, p_source, auth.uid(), 'confirmed')
  on conflict (lower(email)) do update
    set status = case when newsletter_subscribers.status = 'unsubscribed'
                      then 'confirmed' else newsletter_subscribers.status end,
        unsubscribed_at = null,
        confirmed_at = coalesce(newsletter_subscribers.confirmed_at, now());

  update public.newsletter_subscribers set confirmed_at = coalesce(confirmed_at, now())
   where lower(email) = clean;

  return jsonb_build_object('ok', true, 'message', 'Tak — du er tilmeldt.');
end;
$fn$;

create or replace function public.unsubscribe_newsletter(p_token uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $fn$
declare hit int;
begin
  update public.newsletter_subscribers
     set status = 'unsubscribed', unsubscribed_at = now()
   where token = p_token;
  get diagnostics hit = row_count;
  return jsonb_build_object('ok', hit > 0);
end;
$fn$;

-- ---------------------------------------------------------------- contact --

create table if not exists public.contact_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  name text not null,
  email text not null,
  subject text not null,
  body text not null,
  order_no text,
  status text not null default 'new' check (status in ('new','open','answered','closed','spam')),
  admin_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists contact_messages_status_idx on public.contact_messages (status, created_at desc);
alter table public.contact_messages enable row level security;
drop policy if exists "contact admin all" on public.contact_messages;
create policy "contact admin all" on public.contact_messages
  for all to authenticated
  using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));
drop policy if exists "own contact select" on public.contact_messages;
create policy "own contact select" on public.contact_messages
  for select to authenticated using (auth.uid() = user_id);

create or replace function public.submit_contact_message(
  p_name text, p_email text, p_subject text, p_body text, p_order_no text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $fn$
declare
  clean_email text := lower(trim(coalesce(p_email, '')));
  recent int;
begin
  if coalesce(trim(p_name),'') = '' or coalesce(trim(p_subject),'') = '' or length(coalesce(trim(p_body),'')) < 10 then
    return jsonb_build_object('ok', false, 'error', 'incomplete',
      'message', 'Udfyld navn, emne og en besked på mindst 10 tegn.');
  end if;
  if clean_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$' then
    return jsonb_build_object('ok', false, 'error', 'invalid_email',
      'message', 'Indtast en gyldig e-mailadresse.');
  end if;

  -- Cheap flood guard: five messages per address per hour.
  select count(*) into recent from public.contact_messages
   where lower(email) = clean_email and created_at > now() - interval '1 hour';
  if recent >= 5 then
    return jsonb_build_object('ok', false, 'error', 'rate_limited',
      'message', 'Du har sendt mange beskeder på kort tid. Prøv igen om lidt.');
  end if;

  insert into public.contact_messages (user_id, name, email, subject, body, order_no)
  values (auth.uid(), trim(p_name), clean_email, trim(p_subject), trim(p_body), nullif(trim(p_order_no), ''));

  return jsonb_build_object('ok', true, 'message', 'Tak for din besked — vi vender tilbage inden for 1-2 hverdage.');
end;
$fn$;

-- ------------------------------------------------------------------- GDPR --

alter table public.profiles
  add column if not exists phone text,
  add column if not exists marketing_opt_in boolean not null default false,
  add column if not exists locale text not null default 'da-DK',
  add column if not exists deletion_requested_at timestamptz;

-- Everything Havekongen holds about the caller, in one JSON document. Article 20
-- portability, served from the app instead of a support ticket.
create or replace function public.export_my_data()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  uid uuid := auth.uid();
  doc jsonb;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '42501'; end if;

  select jsonb_build_object(
    'exported_at', now(),
    'account', (select to_jsonb(p) from public.profiles p where p.id = uid),
    'gardens', (select coalesce(jsonb_agg(to_jsonb(g)), '[]'::jsonb) from public.gardens g where g.user_id = uid),
    'zones', (select coalesce(jsonb_agg(to_jsonb(z)), '[]'::jsonb) from public.garden_zones z where z.user_id = uid),
    'plants', (select coalesce(jsonb_agg(to_jsonb(up)), '[]'::jsonb) from public.user_plants up where up.user_id = uid),
    'orders', (select coalesce(jsonb_agg(to_jsonb(o)), '[]'::jsonb) from public.orders o where o.user_id = uid),
    'order_items', (select coalesce(jsonb_agg(to_jsonb(oi)), '[]'::jsonb) from public.order_items oi where oi.user_id = uid),
    'returns', (select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) from public.order_returns r where r.user_id = uid),
    'addresses', (select coalesce(jsonb_agg(to_jsonb(a)), '[]'::jsonb) from public.addresses a where a.user_id = uid),
    'reviews', (select coalesce(jsonb_agg(to_jsonb(rv)), '[]'::jsonb) from public.product_reviews rv where rv.user_id = uid),
    'wishlist', (select coalesce(jsonb_agg(to_jsonb(w)), '[]'::jsonb) from public.wishlists w where w.user_id = uid),
    'journal', (select coalesce(jsonb_agg(to_jsonb(j)), '[]'::jsonb) from public.garden_journal j where j.user_id = uid),
    'observations', (select coalesce(jsonb_agg(to_jsonb(ob)), '[]'::jsonb) from public.garden_observations ob where ob.user_id = uid),
    'devices', (select coalesce(jsonb_agg(to_jsonb(d)), '[]'::jsonb) from public.devices d where d.user_id = uid),
    'notifications', (select coalesce(jsonb_agg(to_jsonb(n)), '[]'::jsonb) from public.notifications n where n.user_id = uid),
    'consents', (select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) from public.consents c where c.user_id = uid),
    'chat', (select coalesce(jsonb_agg(to_jsonb(cc)), '[]'::jsonb) from public.chat_conversations cc where cc.user_id = uid)
  ) into doc;

  return doc;
end;
$fn$;

create table if not exists public.account_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  reason text,
  status text not null default 'requested' check (status in ('requested','completed','cancelled')),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
alter table public.account_deletion_requests enable row level security;
drop policy if exists "own deletion request" on public.account_deletion_requests;
create policy "own deletion request" on public.account_deletion_requests
  for select to authenticated using (auth.uid() = user_id or public.has_role(auth.uid(),'admin'));

-- Requesting erasure is instant to record; the actual auth-user removal is done
-- by the account-delete edge function, which holds the service role.
create or replace function public.request_account_deletion(p_reason text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $fn$
declare
  uid uuid := auth.uid();
  open_orders int;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '42501'; end if;

  -- Bookkeeping law: an order in flight has to be settled before the account
  -- behind it can be erased.
  select count(*) into open_orders from public.orders
   where user_id = uid and status in ('pending','confirmed','paid','packed','shipped');
  if open_orders > 0 then
    return jsonb_build_object('ok', false, 'error', 'open_orders',
      'message', 'Du har ' || open_orders || ' aktive ordrer. Kontakt os, så hjælper vi med sletningen.');
  end if;

  insert into public.account_deletion_requests (user_id, reason) values (uid, nullif(p_reason,''));
  update public.profiles set deletion_requested_at = now() where id = uid;

  return jsonb_build_object('ok', true,
    'message', 'Din anmodning er registreret. Kontoen slettes inden for 30 dage.');
end;
$fn$;

create or replace function public.cancel_account_deletion()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $fn$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  update public.account_deletion_requests set status = 'cancelled'
   where user_id = uid and status = 'requested';
  update public.profiles set deletion_requested_at = null where id = uid;
  return jsonb_build_object('ok', true);
end;
$fn$;

-- --------------------------------------------------------- shop settings ---

-- Company and payment details the footer, the invoices and the payment
-- instructions all read from, instead of three hard-coded copies.
create table if not exists public.shop_settings (
  key text primary key,
  value jsonb not null,
  public_read boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.shop_settings enable row level security;
drop policy if exists "settings public read" on public.shop_settings;
create policy "settings public read" on public.shop_settings
  for select to anon, authenticated using (public_read);
drop policy if exists "settings admin write" on public.shop_settings;
create policy "settings admin write" on public.shop_settings
  for all to authenticated
  using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));

insert into public.shop_settings (key, value, public_read) values
  ('company', jsonb_build_object(
      'name', 'Havekongen ApS',
      'cvr', '44881230',
      'address', 'Havnegade 12, 1058 København K',
      'email', 'hej@havekongen.dk',
      'phone', '+45 71 99 12 30',
      'support_hours', 'Man-fre 9-16'), true),
  ('payment_invoice', jsonb_build_object(
      'bank', 'Danske Bank',
      'reg_no', '3409',
      'account_no', '12345678',
      'iban', 'DK5030094512345678',
      'swift', 'DABADKKK',
      'due_days', 8), true),
  ('policies', jsonb_build_object(
      'return_days', 30,
      'right_of_withdrawal_days', 14,
      'privacy_version', '2026-09'), true)
on conflict (key) do nothing;

-- ------------------------------------------------------------------ grants --

grant execute on function public.subscribe_newsletter(text, text) to anon, authenticated;
grant execute on function public.unsubscribe_newsletter(uuid) to anon, authenticated;
grant execute on function public.submit_contact_message(text, text, text, text, text) to anon, authenticated;
grant execute on function public.export_my_data() to authenticated;
grant execute on function public.request_account_deletion(text) to authenticated;
grant execute on function public.cancel_account_deletion() to authenticated;
grant select on public.shop_settings to anon, authenticated;
grant insert on public.consents to anon, authenticated;

revoke execute on function public.consume_rate_limit(text, int, int) from public, anon, authenticated;
revoke execute on function public.consume_ai_quota(uuid, text, text, int) from public, anon, authenticated;
revoke execute on function public.record_ai_tokens(uuid, text, text, int, int) from public, anon, authenticated;
revoke execute on function public.prune_rate_limits() from public, anon, authenticated;
