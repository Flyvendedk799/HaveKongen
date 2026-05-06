create or replace function public.write_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_entity text := TG_TABLE_NAME;
  v_id text;
  v_diff jsonb;
begin
  if TG_OP = 'DELETE' then
    v_id := coalesce((to_jsonb(OLD)->>'id'), '');
    v_diff := jsonb_build_object('old', to_jsonb(OLD));
  elsif TG_OP = 'INSERT' then
    v_id := coalesce((to_jsonb(NEW)->>'id'), '');
    v_diff := jsonb_build_object('new', to_jsonb(NEW));
  else
    v_id := coalesce((to_jsonb(NEW)->>'id'), '');
    v_diff := jsonb_build_object('old', to_jsonb(OLD), 'new', to_jsonb(NEW));
  end if;
  insert into public.audit_log (entity, entity_id, action, actor_id, diff)
  values (v_entity, v_id, TG_OP, v_actor, v_diff);
  return coalesce(NEW, OLD);
end;
$$;

drop trigger if exists audit_products on public.products;
create trigger audit_products after insert or update or delete on public.products
for each row execute function public.write_audit();

drop trigger if exists audit_product_variants on public.product_variants;
create trigger audit_product_variants after insert or update or delete on public.product_variants
for each row execute function public.write_audit();

drop trigger if exists audit_plants_catalog on public.plants_catalog;
create trigger audit_plants_catalog after insert or update or delete on public.plants_catalog
for each row execute function public.write_audit();

drop trigger if exists audit_orders on public.orders;
create trigger audit_orders after insert or update or delete on public.orders
for each row execute function public.write_audit();

drop trigger if exists audit_content_blocks on public.content_blocks;
create trigger audit_content_blocks after insert or update or delete on public.content_blocks
for each row execute function public.write_audit();