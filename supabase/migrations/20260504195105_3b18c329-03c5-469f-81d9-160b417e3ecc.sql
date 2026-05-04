
-- Pin search_path on remaining helpers
create or replace function public.touch_updated_at()
returns trigger language plpgsql
set search_path = public
as $$ begin new.updated_at = now(); return new; end; $$;

create or replace function public.handle_new_user()
returns trigger language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, name)
  values (new.id, coalesce(new.raw_user_meta_data->>'name', new.email));
  return new;
end;
$$;

-- Restrict who can execute SECURITY DEFINER functions
revoke execute on function public.has_role(uuid, public.app_role) from public, anon;
-- has_role still callable from RLS policies; keep authenticated execute (used in policies)
revoke execute on function public.handle_new_user() from public, anon, authenticated;
