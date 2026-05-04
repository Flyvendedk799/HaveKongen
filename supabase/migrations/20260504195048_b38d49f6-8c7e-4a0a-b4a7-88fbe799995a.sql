
-- ROLES
create type public.app_role as enum ('admin', 'user');

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  unique (user_id, role)
);
alter table public.user_roles enable row level security;

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role)
$$;

create policy "Users can view own roles" on public.user_roles
  for select to authenticated using (auth.uid() = user_id);
create policy "Admins manage roles" on public.user_roles
  for all to authenticated using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));

-- PROFILES
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text,
  address text,
  postal_code text,
  latitude double precision,
  longitude double precision,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

create policy "Users view own profile" on public.profiles
  for select to authenticated using (auth.uid() = id);
create policy "Users update own profile" on public.profiles
  for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);
create policy "Users insert own profile" on public.profiles
  for insert to authenticated with check (auth.uid() = id);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, name)
  values (new.id, coalesce(new.raw_user_meta_data->>'name', new.email));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- updated_at trigger helper
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

-- GARDENS
create table public.gardens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null default 'Min have',
  address text,
  latitude double precision,
  longitude double precision,
  polygon jsonb,
  area_m2 numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.gardens enable row level security;
create policy "own gardens select" on public.gardens for select to authenticated using (auth.uid() = user_id);
create policy "own gardens insert" on public.gardens for insert to authenticated with check (auth.uid() = user_id);
create policy "own gardens update" on public.gardens for update to authenticated using (auth.uid() = user_id);
create policy "own gardens delete" on public.gardens for delete to authenticated using (auth.uid() = user_id);
create trigger gardens_touch before update on public.gardens for each row execute function public.touch_updated_at();

create type public.zone_type as enum ('lawn','bed','greenhouse','terrace','pond','tree');

create table public.garden_zones (
  id uuid primary key default gen_random_uuid(),
  garden_id uuid not null references public.gardens(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  type public.zone_type not null default 'bed',
  polygon jsonb,
  area_m2 numeric,
  soil text,
  sun_exposure text,
  created_at timestamptz not null default now()
);
alter table public.garden_zones enable row level security;
create policy "own zones select" on public.garden_zones for select to authenticated using (auth.uid() = user_id);
create policy "own zones insert" on public.garden_zones for insert to authenticated with check (auth.uid() = user_id);
create policy "own zones update" on public.garden_zones for update to authenticated using (auth.uid() = user_id);
create policy "own zones delete" on public.garden_zones for delete to authenticated using (auth.uid() = user_id);

-- PLANTS CATALOG (public read)
create table public.plants_catalog (
  slug text primary key,
  name_da text not null,
  latin text,
  category text,
  water_need text,
  sun text,
  sow_months int[],
  harvest_months int[],
  description text,
  image_url text,
  created_at timestamptz not null default now()
);
alter table public.plants_catalog enable row level security;
create policy "plants public read" on public.plants_catalog for select to anon, authenticated using (true);
create policy "plants admin write" on public.plants_catalog for all to authenticated using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));

create table public.user_plants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  garden_id uuid not null references public.gardens(id) on delete cascade,
  zone_id uuid references public.garden_zones(id) on delete set null,
  plant_slug text references public.plants_catalog(slug) on delete set null,
  custom_name text,
  qty int not null default 1,
  planted_at date,
  notes text,
  created_at timestamptz not null default now()
);
alter table public.user_plants enable row level security;
create policy "own plants select" on public.user_plants for select to authenticated using (auth.uid() = user_id);
create policy "own plants insert" on public.user_plants for insert to authenticated with check (auth.uid() = user_id);
create policy "own plants update" on public.user_plants for update to authenticated using (auth.uid() = user_id);
create policy "own plants delete" on public.user_plants for delete to authenticated using (auth.uid() = user_id);

-- WATERING
create table public.watering_schedules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  zone_id uuid not null references public.garden_zones(id) on delete cascade,
  name text not null default 'Vanding',
  weekday_mask int not null default 127, -- bit per day, sun=1..sat=64
  start_time time not null default '06:30',
  duration_min int not null default 15,
  enabled boolean not null default true,
  ai_adjusted boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.watering_schedules enable row level security;
create policy "own ws select" on public.watering_schedules for select to authenticated using (auth.uid() = user_id);
create policy "own ws insert" on public.watering_schedules for insert to authenticated with check (auth.uid() = user_id);
create policy "own ws update" on public.watering_schedules for update to authenticated using (auth.uid() = user_id);
create policy "own ws delete" on public.watering_schedules for delete to authenticated using (auth.uid() = user_id);

create table public.watering_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  schedule_id uuid references public.watering_schedules(id) on delete cascade,
  zone_id uuid references public.garden_zones(id) on delete cascade,
  scheduled_for timestamptz not null,
  ran_at timestamptz,
  mm_delivered numeric,
  weather_skipped boolean not null default false,
  reason text,
  created_at timestamptz not null default now()
);
alter table public.watering_events enable row level security;
create policy "own we select" on public.watering_events for select to authenticated using (auth.uid() = user_id);
create policy "own we insert" on public.watering_events for insert to authenticated with check (auth.uid() = user_id);
create policy "own we update" on public.watering_events for update to authenticated using (auth.uid() = user_id);
create policy "own we delete" on public.watering_events for delete to authenticated using (auth.uid() = user_id);

-- DEVICES
create type public.device_kind as enum ('mower','sprinkler','sensor','greenhouse');
create table public.devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  garden_id uuid references public.gardens(id) on delete set null,
  kind public.device_kind not null,
  name text not null,
  status text not null default 'idle',
  battery int,
  last_seen timestamptz,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.devices enable row level security;
create policy "own dev select" on public.devices for select to authenticated using (auth.uid() = user_id);
create policy "own dev insert" on public.devices for insert to authenticated with check (auth.uid() = user_id);
create policy "own dev update" on public.devices for update to authenticated using (auth.uid() = user_id);
create policy "own dev delete" on public.devices for delete to authenticated using (auth.uid() = user_id);

-- WEBSHOP
create table public.products (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  category text not null,
  short_description text,
  description text,
  base_price_dkk int not null,
  image_url text,
  gradient text,
  svg_art text,
  meta text,
  in_stock boolean not null default true,
  featured boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.products enable row level security;
create policy "products public read" on public.products for select to anon, authenticated using (true);
create policy "products admin write" on public.products for all to authenticated using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));

create table public.product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  name text not null,
  price_dkk int not null,
  sku text,
  in_stock boolean not null default true
);
alter table public.product_variants enable row level security;
create policy "variants public read" on public.product_variants for select to anon, authenticated using (true);
create policy "variants admin write" on public.product_variants for all to authenticated using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending',
  total_dkk int not null,
  shipping_address jsonb,
  created_at timestamptz not null default now()
);
alter table public.orders enable row level security;
create policy "own orders select" on public.orders for select to authenticated using (auth.uid() = user_id);
create policy "own orders insert" on public.orders for insert to authenticated with check (auth.uid() = user_id);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid references public.products(id),
  variant_id uuid references public.product_variants(id),
  name text not null,
  qty int not null default 1,
  unit_price_dkk int not null
);
alter table public.order_items enable row level security;
create policy "own oi select" on public.order_items for select to authenticated using (auth.uid() = user_id);
create policy "own oi insert" on public.order_items for insert to authenticated with check (auth.uid() = user_id);

-- AI CHAT
create table public.chat_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'Ny samtale',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.chat_conversations enable row level security;
create policy "own conv select" on public.chat_conversations for select to authenticated using (auth.uid() = user_id);
create policy "own conv insert" on public.chat_conversations for insert to authenticated with check (auth.uid() = user_id);
create policy "own conv update" on public.chat_conversations for update to authenticated using (auth.uid() = user_id);
create policy "own conv delete" on public.chat_conversations for delete to authenticated using (auth.uid() = user_id);
create trigger chat_conversations_touch before update on public.chat_conversations
  for each row execute function public.touch_updated_at();

create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user','assistant','system','tool')),
  content text not null,
  created_at timestamptz not null default now()
);
alter table public.chat_messages enable row level security;
create policy "own msg select" on public.chat_messages for select to authenticated using (auth.uid() = user_id);
create policy "own msg insert" on public.chat_messages for insert to authenticated with check (auth.uid() = user_id);
create policy "own msg delete" on public.chat_messages for delete to authenticated using (auth.uid() = user_id);

-- Realtime
alter publication supabase_realtime add table public.devices;
alter publication supabase_realtime add table public.watering_events;
alter publication supabase_realtime add table public.chat_messages;
