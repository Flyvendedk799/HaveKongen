-- Grant the PostgREST API roles access to the public schema.
--
-- Supabase Cloud sets these up as part of a project; a self-hosted stack that is
-- provisioned schema-only does not. Without them every request fails with
--   42501  permission denied for table <name>
-- even though the table has RLS policies that would allow it, because a GRANT is
-- checked before any policy is consulted.
--
-- Granting broadly is safe here: every table in `public` has RLS enabled and at
-- least one policy, so which ROWS a caller sees is still decided by the policies.
-- These grants only decide which TABLES the role may attempt at all.
--
-- If you add a table, RLS-enable it and give it a policy. The default privileges
-- at the bottom will hand the API roles their grants automatically, so an
-- unprotected new table would otherwise be readable.

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

GRANT ALL    ON ALL TABLES IN SCHEMA public TO service_role;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;

GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role, anon, authenticated;
GRANT ALL ON ALL ROUTINES  IN SCHEMA public TO service_role, anon, authenticated;

-- Tables created by later migrations inherit the same shape.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON ROUTINES  TO service_role, anon, authenticated;

-- PostgREST caches the schema, including privileges.
NOTIFY pgrst, 'reload schema';
