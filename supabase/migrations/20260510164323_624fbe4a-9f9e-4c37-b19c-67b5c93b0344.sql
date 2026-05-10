revoke execute on function public.user_postal(uuid) from public, anon;
revoke execute on function public.same_postal(uuid, uuid) from public, anon;
grant execute on function public.user_postal(uuid) to authenticated;
grant execute on function public.same_postal(uuid, uuid) to authenticated;