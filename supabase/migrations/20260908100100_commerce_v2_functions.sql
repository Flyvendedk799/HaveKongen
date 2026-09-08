-- Havekongen v2 — server-authoritative pricing and order lifecycle.
--
-- Nothing about money is decided in the browser any more. The client sends
-- {product, variant, qty} triples; the database looks up the price, checks the
-- stock, validates the discount code, computes moms and writes the order in one
-- transaction. quote_cart() is the read-only half of the same code path, so the
-- basket total a customer sees is produced by exactly the logic that will bill
-- them.

-- --------------------------------------------------------------- internals --

-- Danish VAT is quoted inclusive, so the tax inside a gross amount is
-- gross * rate / (1 + rate). Rounded once, in øre.
create or replace function public.vat_of_gross(p_gross_oere int, p_rate numeric)
returns int
language sql
immutable
as $fn$
  select round(p_gross_oere::numeric * p_rate / (1 + p_rate))::int
$fn$;

-- The shared pricing engine. Returns a quote document; never writes.
create or replace function public.price_cart(
  p_items jsonb,
  p_shipping_method text default 'standard',
  p_discount_code text default null,
  p_user uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  item jsonb;
  prod public.products%rowtype;
  variant public.product_variants%rowtype;
  ship public.shipping_methods%rowtype;
  disc public.discount_codes%rowtype;
  lines jsonb := '[]'::jsonb;
  problems jsonb := '[]'::jsonb;
  qty int;
  unit_oere int;
  line_total int;
  available int;
  subtotal int := 0;
  eligible int := 0;
  discount_total int := 0;
  shipping_oere int := 0;
  vat_total int := 0;
  allocated int := 0;
  line jsonb;
  line_disc int;
  line_net int;
  line_vat int;
  n_lines int;
  idx int := 0;
  used int;
  code_upper text := nullif(upper(trim(coalesce(p_discount_code, ''))), '');
  discount_doc jsonb := null;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    return jsonb_build_object(
      'ok', false, 'lines', '[]'::jsonb,
      'problems', jsonb_build_array(jsonb_build_object('code','empty_cart','message','Kurven er tom.')),
      'subtotal_oere', 0, 'discount_oere', 0, 'shipping_oere', 0, 'vat_oere', 0, 'total_oere', 0
    );
  end if;

  if jsonb_array_length(p_items) > 50 then
    return jsonb_build_object(
      'ok', false, 'lines', '[]'::jsonb,
      'problems', jsonb_build_array(jsonb_build_object('code','too_many_lines','message','Kurven kan højst indeholde 50 varelinjer.')),
      'subtotal_oere', 0, 'discount_oere', 0, 'shipping_oere', 0, 'vat_oere', 0, 'total_oere', 0
    );
  end if;

  -- 1. Resolve every line against the catalogue.
  for item in select * from jsonb_array_elements(p_items) loop
    qty := greatest(1, least(99, coalesce((item->>'qty')::int, 1)));

    select * into prod from public.products
     where id = nullif(item->>'product_id','')::uuid;

    if not found then
      problems := problems || jsonb_build_object(
        'code','unknown_product', 'message','En vare findes ikke længere.',
        'product_id', item->>'product_id');
      continue;
    end if;

    if not prod.active then
      problems := problems || jsonb_build_object(
        'code','inactive', 'message', prod.name || ' er ikke længere i sortimentet.',
        'product_id', prod.id::text);
      continue;
    end if;

    variant := null;
    if nullif(item->>'variant_id','') is not null then
      select * into variant from public.product_variants
       where id = (item->>'variant_id')::uuid and product_id = prod.id;
      if not found then
        problems := problems || jsonb_build_object(
          'code','unknown_variant', 'message','Den valgte variant findes ikke længere.',
          'product_id', prod.id::text, 'variant_id', item->>'variant_id');
        continue;
      end if;
    end if;

    -- Availability: a counted item is limited by stock_qty; an uncounted one is
    -- either freely available or flatly out of stock. NULL means "no ceiling".
    if variant.id is not null then
      if variant.track_inventory then available := variant.stock_qty;
      elsif not variant.in_stock then available := 0;
      else available := null; end if;
    else
      if prod.track_inventory then available := prod.stock_qty;
      elsif not prod.in_stock then available := 0;
      else available := null; end if;
    end if;

    if available is not null and available <= 0 then
      problems := problems || jsonb_build_object(
        'code','out_of_stock', 'message', prod.name || ' er udsolgt.',
        'product_id', prod.id::text, 'variant_id', variant.id::text, 'max_qty', 0);
      continue;
    end if;

    if available is not null and qty > available then
      problems := problems || jsonb_build_object(
        'code','insufficient_stock',
        'message', 'Vi har kun ' || available || ' stk. af ' || prod.name || ' på lager.',
        'product_id', prod.id::text, 'variant_id', variant.id::text, 'max_qty', available);
      qty := available;
    end if;

    unit_oere := coalesce(variant.price_dkk, prod.base_price_dkk) * 100;
    line_total := unit_oere * qty;
    subtotal := subtotal + line_total;

    lines := lines || jsonb_build_object(
      'product_id', prod.id::text,
      'variant_id', variant.id::text,
      'slug', prod.slug,
      'name', prod.name,
      'variant_name', variant.name,
      'sku', coalesce(variant.sku, prod.sku),
      'category', prod.category,
      'qty', qty,
      'unit_price_oere', unit_oere,
      'line_total_oere', line_total,
      'vat_rate', prod.vat_rate,
      'image_url', prod.image_url,
      'gradient', prod.gradient,
      'svg_art', prod.svg_art,
      'max_qty', available
    );
  end loop;

  n_lines := jsonb_array_length(lines);

  -- 2. Shipping method.
  select * into ship from public.shipping_methods where code = coalesce(p_shipping_method, 'standard') and active;
  if not found then
    select * into ship from public.shipping_methods where active order by sort limit 1;
  end if;
  if found then
    shipping_oere := ship.price_oere;
  end if;

  -- 3. Discount code, validated against time window, spend floor and quota.
  if code_upper is not null and n_lines > 0 then
    select * into disc from public.discount_codes where code = code_upper;
    if not found or not disc.active then
      problems := problems || jsonb_build_object('code','invalid_code','message','Rabatkoden findes ikke.');
    elsif disc.starts_at is not null and now() < disc.starts_at then
      problems := problems || jsonb_build_object('code','code_not_started','message','Rabatkoden er ikke aktiv endnu.');
    elsif disc.ends_at is not null and now() > disc.ends_at then
      problems := problems || jsonb_build_object('code','code_expired','message','Rabatkoden er udløbet.');
    elsif disc.max_redemptions is not null and disc.redemptions >= disc.max_redemptions then
      problems := problems || jsonb_build_object('code','code_exhausted','message','Rabatkoden er brugt op.');
    else
      -- Only lines in the code's category count towards the discount base.
      if disc.category is null then
        eligible := subtotal;
      else
        select coalesce(sum((l->>'line_total_oere')::int), 0) into eligible
          from jsonb_array_elements(lines) as t(l) where l->>'category' = disc.category;
      end if;

      if eligible < disc.min_subtotal_oere then
        problems := problems || jsonb_build_object(
          'code','below_minimum',
          'message','Rabatkoden kræver et køb på mindst ' || round(disc.min_subtotal_oere / 100.0) || ' kr.');
      elsif p_user is not null and disc.per_user_limit > 0 and (
        select count(*) from public.discount_redemptions r
         where r.user_id = p_user and r.code = disc.code) >= disc.per_user_limit then
        problems := problems || jsonb_build_object('code','code_already_used','message','Du har allerede brugt denne rabatkode.');
      else
        if disc.kind = 'percent' then
          discount_total := round(eligible * least(disc.value, 100) / 100.0)::int;
        elsif disc.kind = 'fixed' then
          discount_total := least(disc.value::int, eligible);
        elsif disc.kind = 'free_shipping' then
          shipping_oere := 0;
        end if;
        discount_doc := jsonb_build_object(
          'code', disc.code, 'kind', disc.kind, 'value', disc.value,
          'description', disc.description, 'amount_oere', discount_total);
      end if;
    end if;
  end if;

  -- 4. Free-shipping threshold, evaluated on what the customer actually pays.
  if ship.free_over_oere is not null and (subtotal - discount_total) >= ship.free_over_oere then
    shipping_oere := 0;
  end if;

  -- 5. Allocate the discount across lines proportionally, then take moms out of
  --    each net line. The last line absorbs the rounding remainder so the parts
  --    always sum back to the whole.
  for line in select * from jsonb_array_elements(lines) loop
    idx := idx + 1;
    if discount_total = 0 or subtotal = 0 then
      line_disc := 0;
    elsif idx = n_lines then
      line_disc := discount_total - allocated;
    else
      line_disc := floor((line->>'line_total_oere')::numeric * discount_total / subtotal)::int;
      allocated := allocated + line_disc;
    end if;
    line_net := (line->>'line_total_oere')::int - line_disc;
    line_vat := public.vat_of_gross(line_net, (line->>'vat_rate')::numeric);
    vat_total := vat_total + line_vat;

    lines := jsonb_set(lines, array[(idx - 1)::text],
      line || jsonb_build_object('line_discount_oere', line_disc, 'vat_oere', line_vat));
  end loop;

  -- Shipping is a 25% service in Denmark regardless of what is in the box.
  vat_total := vat_total + public.vat_of_gross(shipping_oere, 0.25);

  return jsonb_build_object(
    'ok', (jsonb_array_length(problems) = 0 and n_lines > 0),
    'lines', lines,
    'problems', problems,
    'subtotal_oere', subtotal,
    'discount_oere', discount_total,
    'shipping_oere', shipping_oere,
    'vat_oere', vat_total,
    'total_oere', subtotal - discount_total + shipping_oere,
    'currency', 'DKK',
    'discount', discount_doc,
    'shipping_method', case when ship.code is null then null else jsonb_build_object(
      'code', ship.code, 'name', ship.name, 'description', ship.description,
      'carrier', ship.carrier, 'price_oere', ship.price_oere,
      'free_over_oere', ship.free_over_oere,
      'eta_min_days', ship.eta_min_days, 'eta_max_days', ship.eta_max_days) end
  );
end;
$fn$;

-- Public entry point for live basket pricing.
create or replace function public.quote_cart(
  p_items jsonb,
  p_shipping_method text default 'standard',
  p_discount_code text default null
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $fn$
  select public.price_cart(p_items, p_shipping_method, p_discount_code, auth.uid())
$fn$;

-- ------------------------------------------------------------ place_order --

create or replace function public.place_order(
  p_items jsonb,
  p_shipping_address jsonb,
  p_shipping_method text default 'standard',
  p_billing_address jsonb default null,
  p_email text default null,
  p_phone text default null,
  p_discount_code text default null,
  p_note text default null,
  p_payment_provider text default 'invoice',
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $fn$
declare
  uid uuid := auth.uid();
  quote jsonb;
  existing public.orders%rowtype;
  new_order public.orders%rowtype;
  line jsonb;
  touched int;
  addr jsonb := p_shipping_address;
  item_id uuid;
begin
  if uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  -- Replaying the same submit (double click, retried request) must not create a
  -- second order.
  if p_idempotency_key is not null then
    select * into existing from public.orders
     where user_id = uid and idempotency_key = p_idempotency_key;
    if found then
      return jsonb_build_object('ok', true, 'replayed', true, 'order_id', existing.id,
                                'order_no', existing.order_no, 'total_oere', existing.total_oere);
    end if;
  end if;

  if addr is null
     or coalesce(addr->>'name','') = ''
     or coalesce(addr->>'street','') = ''
     or coalesce(addr->>'postal_code','') = ''
     or coalesce(addr->>'city','') = '' then
    raise exception 'invalid_address' using errcode = '22023',
      detail = 'Navn, adresse, postnummer og by er påkrævet.';
  end if;

  -- Lock the catalogue rows this cart touches, in a stable order, so two
  -- simultaneous checkouts for the last item cannot both succeed.
  perform 1 from public.products
   where id in (select nullif(value->>'product_id','')::uuid from jsonb_array_elements(p_items))
   order by id
   for update;

  quote := public.price_cart(p_items, p_shipping_method, p_discount_code, uid);

  if not (quote->>'ok')::boolean then
    return jsonb_build_object('ok', false, 'problems', quote->'problems', 'quote', quote);
  end if;

  insert into public.orders (
    user_id, order_no, status, shipping_status, payment_status, payment_provider,
    email, phone, shipping_address, billing_address, shipping_method,
    subtotal_oere, shipping_oere, discount_oere, vat_oere, total_oere,
    total_dkk, currency, discount_code, notes, idempotency_key, placed_at, updated_at
  ) values (
    uid, public.next_order_no(), 'pending', 'pending', 'unpaid', p_payment_provider,
    nullif(p_email, ''), nullif(p_phone, ''), p_shipping_address,
    coalesce(p_billing_address, p_shipping_address), quote->'shipping_method'->>'code',
    (quote->>'subtotal_oere')::int, (quote->>'shipping_oere')::int,
    (quote->>'discount_oere')::int, (quote->>'vat_oere')::int, (quote->>'total_oere')::int,
    round((quote->>'total_oere')::int / 100.0)::int, 'DKK',
    quote->'discount'->>'code', nullif(p_note, ''), p_idempotency_key, now(), now()
  ) returning * into new_order;

  for line in select * from jsonb_array_elements(quote->'lines') loop
    insert into public.order_items (
      order_id, user_id, product_id, variant_id, name, variant_name, product_slug, sku,
      qty, unit_price_dkk, unit_price_oere, line_total_oere, line_discount_oere,
      vat_rate, vat_oere, image_url, gradient, svg_art
    ) values (
      new_order.id, uid,
      nullif(line->>'product_id','')::uuid,
      nullif(line->>'variant_id','')::uuid,
      line->>'name', line->>'variant_name', line->>'slug', line->>'sku',
      (line->>'qty')::int,
      round((line->>'unit_price_oere')::int / 100.0)::int,
      (line->>'unit_price_oere')::int,
      (line->>'line_total_oere')::int,
      (line->>'line_discount_oere')::int,
      (line->>'vat_rate')::numeric,
      (line->>'vat_oere')::int,
      line->>'image_url', line->>'gradient', line->>'svg_art'
    ) returning id into item_id;

    -- Draw down tracked stock. The guard in the WHERE clause is what makes the
    -- oversell impossible; if it matches nothing the whole order rolls back.
    if nullif(line->>'variant_id','') is not null then
      update public.product_variants
         set stock_qty = stock_qty - (line->>'qty')::int
       where id = (line->>'variant_id')::uuid
         and track_inventory
         and stock_qty >= (line->>'qty')::int;
      get diagnostics touched = row_count;
      if touched = 0 and exists (
        select 1 from public.product_variants
         where id = (line->>'variant_id')::uuid and track_inventory) then
        raise exception 'insufficient_stock' using errcode = '23514',
          detail = line->>'name';
      end if;
      if touched > 0 then
        insert into public.inventory_movements (product_id, variant_id, order_id, delta, reason, actor_id)
        values (nullif(line->>'product_id','')::uuid, (line->>'variant_id')::uuid,
                new_order.id, -(line->>'qty')::int, 'order', uid);
      end if;
    else
      update public.products
         set stock_qty = stock_qty - (line->>'qty')::int,
             in_stock = (stock_qty - (line->>'qty')::int) > 0
       where id = (line->>'product_id')::uuid
         and track_inventory
         and stock_qty >= (line->>'qty')::int;
      get diagnostics touched = row_count;
      if touched = 0 and exists (
        select 1 from public.products
         where id = (line->>'product_id')::uuid and track_inventory) then
        raise exception 'insufficient_stock' using errcode = '23514',
          detail = line->>'name';
      end if;
      if touched > 0 then
        insert into public.inventory_movements (product_id, order_id, delta, reason, actor_id)
        values ((line->>'product_id')::uuid, new_order.id, -(line->>'qty')::int, 'order', uid);
      end if;
    end if;
  end loop;

  if quote->'discount' is not null and quote->'discount' <> 'null'::jsonb then
    insert into public.discount_redemptions (code, user_id, order_id, amount_oere)
    values (quote->'discount'->>'code', uid, new_order.id, (quote->>'discount_oere')::int);
    update public.discount_codes set redemptions = redemptions + 1
     where code = quote->'discount'->>'code';
  end if;

  insert into public.payments (order_id, user_id, provider, status, amount_oere, currency)
  values (new_order.id, uid, p_payment_provider, 'pending', (quote->>'total_oere')::int, 'DKK');

  insert into public.order_events (order_id, actor_id, actor_kind, kind, to_status, message)
  values (new_order.id, uid, 'customer', 'order_placed', 'pending',
          'Ordre oprettet med ' || jsonb_array_length(quote->'lines') || ' varelinjer.');

  insert into public.notifications (user_id, kind, title, body, link)
  values (uid, 'order', 'Ordre ' || new_order.order_no || ' er modtaget',
          'Vi har registreret din ordre. Du får besked, når den sendes.',
          '/order/' || new_order.id);

  return jsonb_build_object(
    'ok', true, 'replayed', false,
    'order_id', new_order.id, 'order_no', new_order.order_no,
    'total_oere', new_order.total_oere, 'quote', quote);
end;
$fn$;

-- --------------------------------------------------------- order lifecycle --

-- Which status may follow which. Kept in one place so the customer path, the
-- admin path and the payment webhook cannot disagree.
create or replace function public.order_status_can_transition(p_from text, p_to text)
returns boolean
language sql
immutable
as $fn$
  select case p_from
    when 'pending'   then p_to in ('paid','cancelled','failed')
    when 'confirmed' then p_to in ('paid','packed','cancelled')   -- legacy v1 rows
    when 'paid'      then p_to in ('packed','cancelled','refunded')
    when 'packed'    then p_to in ('shipped','cancelled','refunded')
    when 'shipped'   then p_to in ('delivered','returned','refunded')
    when 'delivered' then p_to in ('returned','refunded')
    when 'returned'  then p_to in ('refunded')
    else false
  end
$fn$;

-- Restock helper shared by cancellation and returns.
create or replace function public.restock_order(p_order_id uuid, p_reason text, p_actor uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $fn$
declare it public.order_items%rowtype;
begin
  for it in select * from public.order_items where order_id = p_order_id loop
    if it.variant_id is not null then
      update public.product_variants set stock_qty = stock_qty + it.qty
       where id = it.variant_id and track_inventory;
    elsif it.product_id is not null then
      update public.products
         set stock_qty = stock_qty + it.qty, in_stock = true
       where id = it.product_id and track_inventory;
    end if;
    insert into public.inventory_movements (product_id, variant_id, order_id, delta, reason, actor_id)
    values (it.product_id, it.variant_id, p_order_id, it.qty, p_reason, p_actor);
  end loop;
end;
$fn$;

create or replace function public.cancel_order(p_order_id uuid, p_reason text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $fn$
declare
  uid uuid := auth.uid();
  o public.orders%rowtype;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '42501'; end if;

  select * into o from public.orders where id = p_order_id for update;
  if not found or o.user_id <> uid then
    raise exception 'order_not_found' using errcode = 'P0002';
  end if;

  -- Once it has left the warehouse it is a return, not a cancellation.
  if o.status not in ('pending','confirmed','paid') or o.shipping_status in ('shipped','delivered') then
    return jsonb_build_object('ok', false, 'error', 'not_cancellable',
      'message', 'Ordren er allerede pakket eller afsendt. Opret en returnering i stedet.');
  end if;

  perform public.restock_order(p_order_id, 'cancel', uid);

  update public.orders
     set status = 'cancelled', cancelled_at = now(), updated_at = now(),
         payment_status = case when payment_status = 'paid' then 'refunded' else payment_status end
   where id = p_order_id;

  update public.payments set status = case when status = 'paid' then 'refunded' else 'cancelled' end,
                             updated_at = now()
   where order_id = p_order_id and status in ('pending','requires_action','authorized','paid');

  -- Hand the discount back so a cancelled order does not burn the customer's
  -- one allowed use of the code.
  if o.discount_code is not null then
    delete from public.discount_redemptions where order_id = p_order_id;
    update public.discount_codes set redemptions = greatest(0, redemptions - 1) where code = o.discount_code;
  end if;

  insert into public.order_events (order_id, actor_id, actor_kind, kind, from_status, to_status, message)
  values (p_order_id, uid, 'customer', 'order_cancelled', o.status, 'cancelled', nullif(p_reason,''));

  return jsonb_build_object('ok', true, 'order_id', p_order_id, 'status', 'cancelled');
end;
$fn$;

create or replace function public.admin_update_order(
  p_order_id uuid,
  p_status text default null,
  p_shipping_status text default null,
  p_tracking_number text default null,
  p_note text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $fn$
declare
  uid uuid := auth.uid();
  o public.orders%rowtype;
  next_status text;
begin
  if uid is null or not public.has_role(uid, 'admin') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select * into o from public.orders where id = p_order_id for update;
  if not found then raise exception 'order_not_found' using errcode = 'P0002'; end if;

  next_status := coalesce(nullif(p_status,''), o.status);

  if next_status <> o.status and not public.order_status_can_transition(o.status, next_status) then
    return jsonb_build_object('ok', false, 'error', 'invalid_transition',
      'message', 'Kan ikke gå fra ' || o.status || ' til ' || next_status || '.');
  end if;

  if next_status = 'cancelled' and o.status <> 'cancelled' then
    perform public.restock_order(p_order_id, 'cancel', uid);
  end if;

  update public.orders set
    status = next_status,
    shipping_status = coalesce(nullif(p_shipping_status,''), shipping_status),
    tracking_number = coalesce(nullif(p_tracking_number,''), tracking_number),
    paid_at      = case when next_status = 'paid'      and paid_at is null      then now() else paid_at end,
    shipped_at   = case when next_status = 'shipped'   and shipped_at is null   then now() else shipped_at end,
    delivered_at = case when next_status = 'delivered' and delivered_at is null then now() else delivered_at end,
    cancelled_at = case when next_status = 'cancelled' and cancelled_at is null then now() else cancelled_at end,
    refunded_at  = case when next_status = 'refunded'  and refunded_at is null  then now() else refunded_at end,
    payment_status = case
      when next_status = 'paid' then 'paid'
      when next_status = 'refunded' then 'refunded'
      else payment_status end,
    updated_at = now()
  where id = p_order_id;

  insert into public.order_events (order_id, actor_id, actor_kind, kind, from_status, to_status, message, meta)
  values (p_order_id, uid, 'admin', 'admin_update', o.status, next_status, nullif(p_note,''),
          jsonb_build_object('tracking_number', p_tracking_number, 'shipping_status', p_shipping_status));

  -- Tell the customer, but only about the moments they care about.
  if next_status <> o.status and next_status in ('paid','shipped','delivered','cancelled','refunded') then
    insert into public.notifications (user_id, kind, title, body, link)
    values (o.user_id, 'order',
      case next_status
        when 'paid'      then 'Betaling modtaget for ' || coalesce(o.order_no, 'din ordre')
        when 'shipped'   then coalesce(o.order_no, 'Din ordre') || ' er sendt'
        when 'delivered' then coalesce(o.order_no, 'Din ordre') || ' er leveret'
        when 'cancelled' then coalesce(o.order_no, 'Din ordre') || ' er annulleret'
        else coalesce(o.order_no, 'Din ordre') || ' er refunderet' end,
      coalesce(nullif(p_note,''), case when p_tracking_number is not null
        then 'Pakkenummer: ' || p_tracking_number else null end),
      '/order/' || p_order_id);
  end if;

  return jsonb_build_object('ok', true, 'order_id', p_order_id, 'status', next_status);
end;
$fn$;

-- Called by the payment webhook (service role) once funds are confirmed.
create or replace function public.mark_order_paid(
  p_order_id uuid,
  p_provider text,
  p_reference text default null,
  p_amount_oere int default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $fn$
declare o public.orders%rowtype;
begin
  select * into o from public.orders where id = p_order_id for update;
  if not found then raise exception 'order_not_found' using errcode = 'P0002'; end if;

  if o.payment_status = 'paid' then
    return jsonb_build_object('ok', true, 'already_paid', true, 'order_id', p_order_id);
  end if;

  if p_amount_oere is not null and p_amount_oere <> o.total_oere then
    return jsonb_build_object('ok', false, 'error', 'amount_mismatch',
      'expected', o.total_oere, 'received', p_amount_oere);
  end if;

  update public.orders
     set status = case when status in ('pending','confirmed') then 'paid' else status end,
         payment_status = 'paid', payment_provider = p_provider,
         paid_at = coalesce(paid_at, now()), updated_at = now()
   where id = p_order_id;

  update public.payments
     set status = 'paid', reference = coalesce(p_reference, reference),
         paid_at = coalesce(paid_at, now()), updated_at = now()
   where order_id = p_order_id and provider = p_provider;

  insert into public.order_events (order_id, actor_kind, kind, from_status, to_status, message, meta)
  values (p_order_id, 'webhook', 'payment_captured', o.status, 'paid',
          'Betaling bekræftet via ' || p_provider,
          jsonb_build_object('reference', p_reference, 'amount_oere', p_amount_oere));

  insert into public.notifications (user_id, kind, title, body, link)
  values (o.user_id, 'order', 'Betaling modtaget for ' || coalesce(o.order_no, 'din ordre'),
          'Vi pakker din ordre nu.', '/order/' || p_order_id);

  return jsonb_build_object('ok', true, 'order_id', p_order_id);
end;
$fn$;

-- Admin-facing wrapper: bank transfers land in a human's inbox, so somebody has
-- to be able to say "the money is here" without holding the service role.
create or replace function public.admin_mark_order_paid(
  p_order_id uuid,
  p_reference text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $fn$
declare
  uid uuid := auth.uid();
  o public.orders%rowtype;
begin
  if uid is null or not public.has_role(uid, 'admin') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into o from public.orders where id = p_order_id;
  if not found then raise exception 'order_not_found' using errcode = 'P0002'; end if;

  return public.mark_order_paid(p_order_id, coalesce(o.payment_provider, 'invoice'), p_reference, null);
end;
$fn$;

-- ----------------------------------------------------------------- returns --

create or replace function public.request_return(
  p_order_id uuid,
  p_reason text,
  p_comment text default null,
  p_items jsonb default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $fn$
declare
  uid uuid := auth.uid();
  o public.orders%rowtype;
  ret_id uuid;
  it jsonb;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'reason_required' using errcode = '22023';
  end if;

  select * into o from public.orders where id = p_order_id and user_id = uid;
  if not found then raise exception 'order_not_found' using errcode = 'P0002'; end if;

  if o.status not in ('shipped','delivered','paid','packed') then
    return jsonb_build_object('ok', false, 'error', 'not_returnable',
      'message', 'Ordren kan ikke returneres i sin nuværende status.');
  end if;

  -- Danish consumer law gives 14 days; Havekongen grants 30 from delivery.
  if coalesce(o.delivered_at, o.shipped_at, o.created_at) < now() - interval '30 days' then
    return jsonb_build_object('ok', false, 'error', 'return_window_closed',
      'message', 'Returfristen på 30 dage er overskredet.');
  end if;

  if exists (select 1 from public.order_returns
              where order_id = p_order_id and status in ('requested','approved','received')) then
    return jsonb_build_object('ok', false, 'error', 'return_exists',
      'message', 'Der er allerede en aktiv returnering på ordren.');
  end if;

  insert into public.order_returns (order_id, user_id, reason, comment)
  values (p_order_id, uid, p_reason, nullif(p_comment,''))
  returning id into ret_id;

  if p_items is not null and jsonb_typeof(p_items) = 'array' then
    for it in select * from jsonb_array_elements(p_items) loop
      insert into public.order_return_items (return_id, order_item_id, qty)
      select ret_id, oi.id, least(greatest(1, coalesce((it->>'qty')::int, oi.qty)), oi.qty)
        from public.order_items oi
       where oi.id = (it->>'order_item_id')::uuid and oi.order_id = p_order_id;
    end loop;
  else
    insert into public.order_return_items (return_id, order_item_id, qty)
    select ret_id, oi.id, oi.qty from public.order_items oi where oi.order_id = p_order_id;
  end if;

  insert into public.order_events (order_id, actor_id, actor_kind, kind, message, meta)
  values (p_order_id, uid, 'customer', 'return_requested', p_reason,
          jsonb_build_object('return_id', ret_id));

  return jsonb_build_object('ok', true, 'return_id', ret_id);
end;
$fn$;

create or replace function public.admin_resolve_return(
  p_return_id uuid,
  p_status text,
  p_refund_oere int default null,
  p_note text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $fn$
declare
  uid uuid := auth.uid();
  r public.order_returns%rowtype;
begin
  if uid is null or not public.has_role(uid, 'admin') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_status not in ('approved','rejected','received','refunded','cancelled') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;

  select * into r from public.order_returns where id = p_return_id for update;
  if not found then raise exception 'return_not_found' using errcode = 'P0002'; end if;

  if p_status = 'received' and r.status <> 'received' then
    perform public.restock_order(r.order_id, 'return', uid);
  end if;

  update public.order_returns
     set status = p_status,
         refund_oere = coalesce(p_refund_oere, refund_oere),
         admin_note = coalesce(nullif(p_note,''), admin_note),
         resolved_at = case when p_status in ('refunded','rejected','cancelled') then now() else resolved_at end,
         updated_at = now()
   where id = p_return_id;

  if p_status = 'refunded' then
    update public.orders
       set status = 'refunded', payment_status = 'refunded',
           refunded_at = coalesce(refunded_at, now()), updated_at = now()
     where id = r.order_id;
    update public.payments
       set status = 'refunded', refunded_oere = coalesce(p_refund_oere, amount_oere), updated_at = now()
     where order_id = r.order_id;
  end if;

  insert into public.order_events (order_id, actor_id, actor_kind, kind, message, meta)
  values (r.order_id, uid, 'admin', 'return_' || p_status, nullif(p_note,''),
          jsonb_build_object('return_id', p_return_id, 'refund_oere', p_refund_oere));

  insert into public.notifications (user_id, kind, title, body, link)
  values (r.user_id, 'order', 'Din returnering er opdateret',
          'Status: ' || p_status, '/konto?tab=ordrer');

  return jsonb_build_object('ok', true, 'return_id', p_return_id, 'status', p_status);
end;
$fn$;

-- ----------------------------------------------------------------- reviews --

-- A review is marked "verified" only if the account actually bought the product
-- on an order that reached at least the paid state.
create or replace function public.mark_review_verified()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  select exists (
    select 1 from public.order_items oi
      join public.orders o on o.id = oi.order_id
     where oi.user_id = new.user_id
       and oi.product_id = new.product_id
       and o.status in ('paid','packed','shipped','delivered','confirmed')
  ) into new.verified_purchase;

  if new.order_id is null then
    select oi.order_id into new.order_id
      from public.order_items oi
      join public.orders o on o.id = oi.order_id
     where oi.user_id = new.user_id and oi.product_id = new.product_id
     order by o.created_at desc limit 1;
  end if;

  new.updated_at := now();
  return new;
end;
$fn$;

drop trigger if exists product_reviews_verify on public.product_reviews;
create trigger product_reviews_verify
  before insert or update on public.product_reviews
  for each row execute function public.mark_review_verified();

-- ------------------------------------------------------------------ search --

create or replace function public.search_catalog(p_q text, p_limit int default 12)
returns table (
  kind text, id text, slug text, title text, subtitle text,
  category text, price_dkk int, image_url text, gradient text, rank real
)
language sql
stable
security definer
set search_path = public
as $fn$
  with q as (select websearch_to_tsquery('danish', coalesce(nullif(trim(p_q), ''), 'zzzz')) as tsq,
                    '%' || lower(coalesce(trim(p_q), '')) || '%' as like_q)
  select 'product'::text, p.id::text, p.slug, p.name, p.short_description, p.category,
         p.base_price_dkk, p.image_url, p.gradient,
         ts_rank(to_tsvector('danish', coalesce(p.name,'') || ' ' || coalesce(p.short_description,'') || ' ' ||
                 coalesce(p.description,'') || ' ' || coalesce(p.category,'')), q.tsq) + 0.5
    from public.products p, q
   where p.active
     and (to_tsvector('danish', coalesce(p.name,'') || ' ' || coalesce(p.short_description,'') || ' ' ||
          coalesce(p.description,'') || ' ' || coalesce(p.category,'')) @@ q.tsq
          or lower(p.name) like q.like_q)
  union all
  select 'plant'::text, c.slug, c.slug, c.name_da, c.latin, coalesce(c.category, 'plante'),
         null::int, c.image_url, null::text,
         ts_rank(to_tsvector('danish', coalesce(c.name_da,'') || ' ' || coalesce(c.latin,'')), q.tsq)
    from public.plants_catalog c, q
   where to_tsvector('danish', coalesce(c.name_da,'') || ' ' || coalesce(c.latin,'')) @@ q.tsq
      or lower(c.name_da) like q.like_q
      or lower(coalesce(c.latin,'')) like q.like_q
  order by rank desc, title
  limit greatest(1, least(coalesce(p_limit, 12), 50))
$fn$;

-- ------------------------------------------------------------------ grants --

-- The browser may price a cart and place an order, but it may no longer write
-- order rows directly — that was the v1 hole that let the total be chosen
-- client-side.
drop policy if exists "own orders insert" on public.orders;
drop policy if exists "own oi insert" on public.order_items;

revoke insert, update, delete on public.orders from authenticated, anon;
revoke insert, update, delete on public.order_items from authenticated, anon;
grant select on public.orders, public.order_items to authenticated;
grant select on public.shipping_methods to anon, authenticated;
grant select on public.product_reviews to anon, authenticated;
grant insert, update, delete on public.product_reviews to authenticated;
grant select, insert, update, delete on public.addresses to authenticated;
grant select on public.order_events, public.payments, public.order_returns,
                public.order_return_items, public.discount_redemptions to authenticated;

revoke execute on function public.price_cart(jsonb, text, text, uuid) from public, anon, authenticated;
grant execute on function public.quote_cart(jsonb, text, text) to anon, authenticated;
grant execute on function public.place_order(jsonb, jsonb, text, jsonb, text, text, text, text, text, text) to authenticated;
grant execute on function public.cancel_order(uuid, text) to authenticated;
grant execute on function public.request_return(uuid, text, text, jsonb) to authenticated;
grant execute on function public.admin_update_order(uuid, text, text, text, text) to authenticated;
grant execute on function public.admin_resolve_return(uuid, text, int, text) to authenticated;
grant execute on function public.search_catalog(text, int) to anon, authenticated;
revoke execute on function public.mark_order_paid(uuid, text, text, int) from public, anon, authenticated;
revoke execute on function public.restock_order(uuid, text, uuid) from public, anon, authenticated;
