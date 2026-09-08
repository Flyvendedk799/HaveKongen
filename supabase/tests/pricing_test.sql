-- Executable checks for the v2 order pipeline.
--
-- Runs against a throwaway database in CI after every migration has been
-- applied. Any mismatch raises, and psql -v ON_ERROR_STOP=1 turns that into a
-- failed build. This is the test that would have caught a wrong VAT rounding or
-- a discount that lets a basket be oversold.

\set ON_ERROR_STOP on

create or replace function hk_assert(actual text, expected text, label text)
returns void
language plpgsql
as $fn$
begin
  if actual is distinct from expected then
    raise exception 'FAIL: % — expected %, got %', label, coalesce(expected, '<null>'), coalesce(actual, '<null>');
  end if;
  raise notice '  ok  %  (%)', label, expected;
end;
$fn$;

create or replace function hk_assert_true(cond boolean, label text)
returns void
language plpgsql
as $fn$
begin
  if cond is not true then
    raise exception 'FAIL: % — expected true', label;
  end if;
  raise notice '  ok  %', label;
end;
$fn$;

-- ------------------------------------------------------------------ set-up --

do $$
declare
  uid uuid := '11111111-1111-1111-1111-111111111111';
begin
  insert into auth.users (id, email, raw_user_meta_data)
  values (uid, 'test@havekongen.dk', '{"name":"Test Testesen"}'::jsonb)
  on conflict (id) do nothing;

  -- A counted product and an uncounted one, so both availability paths are
  -- exercised by the same basket.
  insert into public.products (id, slug, name, category, base_price_dkk, stock_qty, track_inventory, in_stock, active)
  values
    ('aaaaaaaa-0000-0000-0000-000000000001', 'test-aebletrae', 'Æbletræ Discovery', 'froe', 349, 10, true, true, true),
    ('aaaaaaaa-0000-0000-0000-000000000002', 'test-jord', 'Økologisk plantejord 40 l', 'jord', 125, 0, false, true, true),
    ('aaaaaaaa-0000-0000-0000-000000000003', 'test-udsolgt', 'Udsolgt vare', 'froe', 99, 0, true, true, true)
  on conflict (id) do nothing;

  insert into public.discount_codes (code, kind, value, description, min_subtotal_oere, per_user_limit)
  values ('TEST10', 'percent', 10, 'Ti procent', 0, 1)
  on conflict (code) do nothing;

  insert into public.discount_codes (code, kind, value, min_subtotal_oere)
  values ('STORKURV', 'fixed', 5000, 100000)
  on conflict (code) do nothing;

  -- Act as this user for the rest of the session.
  perform set_config('request.jwt.claim.sub', uid::text, false);
end $$;

-- The signup trigger should have produced a profile.
do $$
begin
  perform hk_assert(
    (select name from public.profiles where id = '11111111-1111-1111-1111-111111111111'),
    'Test Testesen', 'handle_new_user creates a profile');
end $$;

-- ------------------------------------------------------------ quote_cart ----

\echo '── quote_cart'

do $$
declare q jsonb;
begin
  q := public.quote_cart(
    '[{"product_id":"aaaaaaaa-0000-0000-0000-000000000001","qty":2},
      {"product_id":"aaaaaaaa-0000-0000-0000-000000000002","qty":1}]'::jsonb,
    'standard', null);

  perform hk_assert(q->>'ok', 'true', 'basket prices cleanly');
  perform hk_assert(q->>'subtotal_oere', '82300', 'subtotal = 2x349 + 125 kr in øre');
  -- 82 300 øre is over the 499 kr free-shipping threshold.
  perform hk_assert(q->>'shipping_oere', '0', 'free shipping above the threshold');
  perform hk_assert(q->>'total_oere', '82300', 'total');
  -- 25% inclusive VAT is exactly a fifth of the gross.
  perform hk_assert(q->>'vat_oere', '16460', 'moms = 20% of a 25%-inclusive total');
  perform hk_assert(jsonb_array_length(q->'lines')::text, '2', 'two lines');
end $$;

do $$
declare q jsonb;
begin
  -- Below the threshold, shipping is charged and carries its own 25%.
  q := public.quote_cart('[{"product_id":"aaaaaaaa-0000-0000-0000-000000000002","qty":1}]'::jsonb, 'standard', null);
  perform hk_assert(q->>'shipping_oere', '4900', 'shipping charged below the threshold');
  perform hk_assert(q->>'total_oere', '17400', 'total includes shipping');
  perform hk_assert(q->>'vat_oere', '3480', 'moms covers goods and shipping');
end $$;

-- ------------------------------------------------------------- discounts ----

\echo '── discounts'

do $$
declare q jsonb;
begin
  q := public.quote_cart(
    '[{"product_id":"aaaaaaaa-0000-0000-0000-000000000001","qty":2},
      {"product_id":"aaaaaaaa-0000-0000-0000-000000000002","qty":1}]'::jsonb,
    'standard', 'test10');

  perform hk_assert(q->>'ok', 'true', 'valid code applies');
  perform hk_assert(q->>'discount_oere', '8230', '10% of 823,00 kr');
  perform hk_assert(q->>'total_oere', '74070', 'total after discount');
  -- The per-line allocation must still sum to a fifth of the discounted total.
  perform hk_assert(q->>'vat_oere', '14814', 'moms recomputed on the discounted lines');
  perform hk_assert(q->'discount'->>'code', 'TEST10', 'code is echoed back uppercased');

  -- Rounding: the parts of the discount must add back up to the whole.
  perform hk_assert(
    (select sum((l->>'line_discount_oere')::int)::text from jsonb_array_elements(q->'lines') as t(l)),
    '8230', 'line discounts sum to the total discount');
end $$;

do $$
declare q jsonb;
begin
  q := public.quote_cart('[{"product_id":"aaaaaaaa-0000-0000-0000-000000000002","qty":1}]'::jsonb, 'standard', 'STORKURV');
  perform hk_assert(q->>'ok', 'false', 'spend floor is enforced');
  perform hk_assert(q->'problems'->0->>'code', 'below_minimum', 'and says why');
  perform hk_assert(q->>'discount_oere', '0', 'no discount is applied');

  q := public.quote_cart('[{"product_id":"aaaaaaaa-0000-0000-0000-000000000002","qty":1}]'::jsonb, 'standard', 'FINDESIKKE');
  perform hk_assert(q->'problems'->0->>'code', 'invalid_code', 'unknown codes are rejected');
end $$;

-- ------------------------------------------------------------ availability --

\echo '── stock'

do $$
declare q jsonb;
begin
  q := public.quote_cart('[{"product_id":"aaaaaaaa-0000-0000-0000-000000000001","qty":99}]'::jsonb, 'standard', null);
  perform hk_assert(q->>'ok', 'false', 'cannot buy more than we hold');
  perform hk_assert(q->'problems'->0->>'code', 'insufficient_stock', 'reported as insufficient stock');
  perform hk_assert(q->'problems'->0->>'max_qty', '10', 'tells the customer the real ceiling');

  -- track_inventory = false means the count is ignored and in_stock decides.
  q := public.quote_cart('[{"product_id":"aaaaaaaa-0000-0000-0000-000000000002","qty":50}]'::jsonb, 'standard', null);
  perform hk_assert(q->>'ok', 'true', 'uncounted stock is not limited by stock_qty');

  q := public.quote_cart('[]'::jsonb, 'standard', null);
  perform hk_assert(q->'problems'->0->>'code', 'empty_cart', 'an empty basket is a problem, not a zero-kroner order');
end $$;

-- ----------------------------------------------------------- place_order ----

\echo '── place_order'

do $$
declare
  res jsonb;
  replay jsonb;
  placed_order uuid;
begin
  res := public.place_order(
    p_items => '[{"product_id":"aaaaaaaa-0000-0000-0000-000000000001","qty":2},
                 {"product_id":"aaaaaaaa-0000-0000-0000-000000000002","qty":1}]'::jsonb,
    p_shipping_address => '{"name":"Test Testesen","street":"Havnegade 12","postal_code":"1058","city":"København K"}'::jsonb,
    p_shipping_method => 'standard',
    p_discount_code => 'TEST10',
    p_idempotency_key => 'test-key-1');

  perform hk_assert(res->>'ok', 'true', 'order is created');
  placed_order := (res->>'order_id')::uuid;

  perform hk_assert((select total_oere::text from public.orders where id = placed_order), '74070',
                    'stored total matches the quote');
  perform hk_assert((select vat_oere::text from public.orders where id = placed_order), '14814',
                    'stored moms matches the quote');
  perform hk_assert((select status from public.orders where id = placed_order), 'pending', 'starts unpaid');
  perform hk_assert_true(
    (select order_no ~ '^HK-\d{6}-\d{5}$' from public.orders where id = placed_order),
    'order number is human-readable');

  perform hk_assert((select count(*)::text from public.order_items where order_id = placed_order), '2', 'two order lines');
  perform hk_assert((select count(*)::text from public.payments where order_id = placed_order), '1', 'a payment row is opened');
  perform hk_assert((select count(*)::text from public.order_events where order_id = placed_order), '1', 'the placement is logged');

  -- Counted stock went down; uncounted stock did not move.
  perform hk_assert((select stock_qty::text from public.products where id = 'aaaaaaaa-0000-0000-0000-000000000001'),
                    '8', 'counted stock is drawn down');
  perform hk_assert((select stock_qty::text from public.products where id = 'aaaaaaaa-0000-0000-0000-000000000002'),
                    '0', 'uncounted stock is left alone');
  perform hk_assert((select count(*)::text from public.inventory_movements where order_id = placed_order),
                    '1', 'the movement is recorded');

  perform hk_assert((select redemptions::text from public.discount_codes where code = 'TEST10'),
                    '1', 'the code is marked as used');

  -- Submitting the same key again must return the same order, not a second one.
  replay := public.place_order(
    p_items => '[{"product_id":"aaaaaaaa-0000-0000-0000-000000000001","qty":2}]'::jsonb,
    p_shipping_address => '{"name":"Test Testesen","street":"Havnegade 12","postal_code":"1058","city":"København K"}'::jsonb,
    p_idempotency_key => 'test-key-1');

  perform hk_assert(replay->>'replayed', 'true', 'a repeated submit is a replay');
  perform hk_assert(replay->>'order_id', placed_order::text, 'and returns the original order');
  perform hk_assert((select stock_qty::text from public.products where id = 'aaaaaaaa-0000-0000-0000-000000000001'),
                    '8', 'a replay does not draw stock down twice');
end $$;

do $$
declare failed boolean := false;
begin
  begin
    perform public.place_order(
      p_items => '[{"product_id":"aaaaaaaa-0000-0000-0000-000000000001","qty":1}]'::jsonb,
      p_shipping_address => '{"name":"","street":"","postal_code":"","city":""}'::jsonb);
  exception when others then
    failed := true;
  end;
  perform hk_assert_true(failed, 'an incomplete address is refused');
end $$;

-- ---------------------------------------------------------- cancellation ----

\echo '── cancellation'

do $$
declare
  placed_order uuid;
  res jsonb;
begin
  select id into placed_order from public.orders order by created_at desc limit 1;

  res := public.cancel_order(placed_order, 'Fortrudt');
  perform hk_assert(res->>'ok', 'true', 'a pending order can be cancelled');
  perform hk_assert((select status from public.orders where id = placed_order), 'cancelled', 'status follows');
  perform hk_assert((select stock_qty::text from public.products where id = 'aaaaaaaa-0000-0000-0000-000000000001'),
                    '10', 'stock goes back on the shelf');
  perform hk_assert((select redemptions::text from public.discount_codes where code = 'TEST10'),
                    '0', 'the discount code is released again');
  perform hk_assert((select status from public.payments where order_id = placed_order), 'cancelled', 'the payment is closed');
end $$;

-- ---------------------------------------------------------------- reviews ---

\echo '── reviews'

do $$
declare pid uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
begin
  insert into public.product_reviews (product_id, user_id, rating, title, body)
  values (pid, '11111111-1111-1111-1111-111111111111', 5, 'Fint træ', 'Kom velemballeret.');

  -- The only order for this product was cancelled, so it is not a verified
  -- purchase — the trigger decides that, not the submitter.
  perform hk_assert((select verified_purchase::text from public.product_reviews where product_id = pid),
                    'false', 'a cancelled order does not verify a purchase');

  -- Pending reviews must not move the public score.
  perform hk_assert((select rating_count::text from public.products where id = pid), '0',
                    'a pending review does not count');

  update public.product_reviews set status = 'approved' where product_id = pid;
  perform hk_assert((select rating_count::text from public.products where id = pid), '1',
                    'approving a review updates the aggregate');
  perform hk_assert((select rating_avg::text from public.products where id = pid), '5.00', 'and the average');
end $$;

-- ------------------------------------------------------------------- RLS ----

\echo '── privileges'

do $$
begin
  -- The v1 hole: the browser could INSERT an order with any total it liked.
  perform hk_assert(has_table_privilege('authenticated', 'public.orders', 'INSERT')::text,
                    'false', 'the browser cannot insert orders');
  perform hk_assert(has_table_privilege('authenticated', 'public.order_items', 'INSERT')::text,
                    'false', 'nor order lines');
  perform hk_assert(has_table_privilege('authenticated', 'public.orders', 'UPDATE')::text,
                    'false', 'nor change an existing order');
  perform hk_assert(has_table_privilege('authenticated', 'public.orders', 'SELECT')::text,
                    'true', 'but can still read its own (RLS narrows this)');

  -- Discount codes must not be enumerable, and the internal helpers must not be
  -- callable from a session.
  perform hk_assert(has_function_privilege('authenticated', 'public.price_cart(jsonb, text, text, uuid)', 'EXECUTE')::text,
                    'false', 'the raw pricing engine is not callable directly');
  perform hk_assert(has_function_privilege('authenticated', 'public.mark_order_paid(uuid, text, text, int)', 'EXECUTE')::text,
                    'false', 'nobody can mark their own order paid');
  perform hk_assert(has_function_privilege('authenticated', 'public.consume_rate_limit(text, int, int)', 'EXECUTE')::text,
                    'false', 'the rate limiter is service-role only');
  perform hk_assert(has_function_privilege('anon', 'public.quote_cart(jsonb, text, text)', 'EXECUTE')::text,
                    'true', 'but anyone may price a basket');
end $$;

-- ------------------------------------------------------------ rate limits ---

\echo '── rate limiting'

do $$
declare v jsonb;
begin
  v := public.consume_rate_limit('test:bucket', 2, 60);
  perform hk_assert(v->>'allowed', 'true', 'first call allowed');
  v := public.consume_rate_limit('test:bucket', 2, 60);
  perform hk_assert(v->>'allowed', 'true', 'second call allowed');
  v := public.consume_rate_limit('test:bucket', 2, 60);
  perform hk_assert(v->>'allowed', 'false', 'third call over the limit is refused');
  perform hk_assert(v->>'remaining', '0', 'and reports nothing left');
end $$;

do $$
declare v jsonb;
begin
  v := public.consume_ai_quota('11111111-1111-1111-1111-111111111111', null, 'test-fn', 1);
  perform hk_assert(v->>'allowed', 'true', 'first AI call within budget');
  v := public.consume_ai_quota('11111111-1111-1111-1111-111111111111', null, 'test-fn', 1);
  perform hk_assert(v->>'allowed', 'false', 'second exceeds the daily budget');
end $$;

-- --------------------------------------------------------------- newsletter -

\echo '── intake'

do $$
declare v jsonb;
begin
  v := public.subscribe_newsletter('ikke-en-email', 'test');
  perform hk_assert(v->>'ok', 'false', 'a malformed address is rejected');

  v := public.subscribe_newsletter('Ny@Havekongen.dk', 'test');
  perform hk_assert(v->>'ok', 'true', 'a valid address is accepted');
  perform hk_assert((select email from public.newsletter_subscribers where lower(email) = 'ny@havekongen.dk'),
                    'ny@havekongen.dk', 'and stored lowercased');

  -- Signing up twice must not error or duplicate.
  v := public.subscribe_newsletter('ny@havekongen.dk', 'test');
  perform hk_assert(v->>'ok', 'true', 'signing up twice is idempotent');
  perform hk_assert((select count(*)::text from public.newsletter_subscribers), '1', 'and creates one row');

  v := public.submit_contact_message('Test', 'test@havekongen.dk', 'Emne', 'kort');
  perform hk_assert(v->>'ok', 'false', 'a too-short message is refused');

  v := public.submit_contact_message('Test', 'test@havekongen.dk', 'Emne', 'Dette er en rigtig besked med indhold.');
  perform hk_assert(v->>'ok', 'true', 'a real message goes through');
end $$;

-- ------------------------------------------------------------ mower specs ---

\echo '── mower specs'

do $$
declare rejected boolean;
begin
  -- A complete spec is accepted.
  update public.products
     set mower_specs = '{"maxAreaM2":600,"maxSlopePct":35,"minPassageCm":60}'::jsonb
   where id = 'aaaaaaaa-0000-0000-0000-000000000001';
  perform hk_assert(
    (select (mower_specs->>'maxAreaM2') from public.products where id = 'aaaaaaaa-0000-0000-0000-000000000001'),
    '600', 'a complete mower spec is stored');

  -- A half-filled one is refused rather than silently dropping the product out
  -- of the recommendations.
  rejected := false;
  begin
    update public.products set mower_specs = '{"maxAreaM2":600}'::jsonb
     where id = 'aaaaaaaa-0000-0000-0000-000000000002';
  exception when check_violation then rejected := true;
  end;
  perform hk_assert_true(rejected, 'an incomplete mower spec is refused');

  -- So is a nonsensical slope.
  rejected := false;
  begin
    update public.products
       set mower_specs = '{"maxAreaM2":600,"maxSlopePct":250,"minPassageCm":60}'::jsonb
     where id = 'aaaaaaaa-0000-0000-0000-000000000002';
  exception when check_violation then rejected := true;
  end;
  perform hk_assert_true(rejected, 'an out-of-range slope is refused');

  perform hk_assert(
    (select count(*)::text from public.products where mower_specs is null),
    '2', 'non-mower products keep a null spec');
end $$;

-- ------------------------------------------------------------------- GDPR ---

\echo '── GDPR'

do $$
declare doc jsonb;
begin
  doc := public.export_my_data();
  perform hk_assert_true(doc ? 'account', 'the export includes the account');
  perform hk_assert_true(doc ? 'orders', 'and the orders');
  perform hk_assert_true(doc ? 'consents', 'and the consent log');
  perform hk_assert((doc->'account'->>'id'), '11111111-1111-1111-1111-111111111111', 'and it is the caller''s own data');
end $$;

\echo ''
\echo 'All pricing and order-pipeline checks passed.'
