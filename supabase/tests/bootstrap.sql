-- Minimal Supabase-shaped scaffolding for a plain Postgres.
--
-- The migrations assume a Supabase project: an `auth` schema with a users
-- table and auth.uid(), a `storage` schema, and the anon / authenticated /
-- service_role roles that the RLS policies and grants name. On a hosted project
-- the platform supplies all of that. In CI we supply just enough of it that the
-- migrations can be applied for real — which is the point: PL/pgSQL function
-- bodies are only compiled when CREATE FUNCTION actually runs, so this file is
-- what turns "the SQL parses" into "the SQL works".
--
-- This is test scaffolding. It is never applied to a real project.

create extension if not exists pgcrypto;

-- ------------------------------------------------------------------- roles --

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end $$;

grant usage on schema public to anon, authenticated, service_role;

-- -------------------------------------------------------------------- auth --

create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  raw_user_meta_data jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- The request's user id. Supabase reads it from the JWT claims injected into
-- the session; here the tests set it directly with
--   set local request.jwt.claim.sub = '<uuid>';
create or replace function auth.uid()
returns uuid
language sql
stable
as $fn$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$fn$;

create or replace function auth.role()
returns text
language sql
stable
as $fn$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon')
$fn$;

grant usage on schema auth to anon, authenticated, service_role;
grant select on auth.users to authenticated, service_role;

-- --------------------------------------------------------------- realtime --

-- Migrations do `alter publication supabase_realtime add table …` to stream
-- changes to subscribed clients. The publication is created by the Supabase
-- platform; here an empty one is enough for those statements to succeed.
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;

-- ----------------------------------------------------------------- storage --

create schema if not exists storage;

create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text,
  owner uuid,
  created_at timestamptz not null default now()
);
alter table storage.objects enable row level security;

-- Splits an object path into its segments, exactly as the real helper does.
create or replace function storage.foldername(name text)
returns text[]
language sql
immutable
as $fn$
  select string_to_array(name, '/')
$fn$;

grant usage on schema storage to anon, authenticated, service_role;
