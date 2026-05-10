-- Helper: get postal code for a user
create or replace function public.user_postal(_user_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select postal_code from public.profiles where id = _user_id
$$;

-- Helper: are two users in same postal code
create or replace function public.same_postal(_a uuid, _b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles pa
    join public.profiles pb on pa.postal_code = pb.postal_code
    where pa.id = _a and pb.id = _b and pa.postal_code is not null
  )
$$;

-- Posts
create table public.neighbor_posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  kind text not null default 'tip',
  title text not null,
  body text,
  image_url text,
  postal_code text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);
alter table public.neighbor_posts enable row level security;

create policy "neighbor posts select same postal"
on public.neighbor_posts for select to authenticated
using (auth.uid() = user_id or public.same_postal(auth.uid(), user_id));

create policy "neighbor posts insert own"
on public.neighbor_posts for insert to authenticated
with check (auth.uid() = user_id);

create policy "neighbor posts update own"
on public.neighbor_posts for update to authenticated
using (auth.uid() = user_id);

create policy "neighbor posts delete own"
on public.neighbor_posts for delete to authenticated
using (auth.uid() = user_id);

create trigger neighbor_posts_touch
before update on public.neighbor_posts
for each row execute function public.touch_updated_at();

create index idx_neighbor_posts_postal on public.neighbor_posts(postal_code);
create index idx_neighbor_posts_created on public.neighbor_posts(created_at desc);

-- Comments
create table public.neighbor_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.neighbor_posts(id) on delete cascade,
  user_id uuid not null,
  body text not null,
  created_at timestamp with time zone not null default now()
);
alter table public.neighbor_comments enable row level security;

create policy "neighbor comments select via post"
on public.neighbor_comments for select to authenticated
using (
  exists (
    select 1 from public.neighbor_posts p
    where p.id = post_id and (p.user_id = auth.uid() or public.same_postal(auth.uid(), p.user_id))
  )
);

create policy "neighbor comments insert own"
on public.neighbor_comments for insert to authenticated
with check (auth.uid() = user_id);

create policy "neighbor comments delete own"
on public.neighbor_comments for delete to authenticated
using (auth.uid() = user_id);

create index idx_neighbor_comments_post on public.neighbor_comments(post_id);

-- Likes
create table public.neighbor_likes (
  post_id uuid not null references public.neighbor_posts(id) on delete cascade,
  user_id uuid not null,
  created_at timestamp with time zone not null default now(),
  primary key (post_id, user_id)
);
alter table public.neighbor_likes enable row level security;

create policy "neighbor likes select via post"
on public.neighbor_likes for select to authenticated
using (
  exists (
    select 1 from public.neighbor_posts p
    where p.id = post_id and (p.user_id = auth.uid() or public.same_postal(auth.uid(), p.user_id))
  )
);

create policy "neighbor likes insert own"
on public.neighbor_likes for insert to authenticated
with check (auth.uid() = user_id);

create policy "neighbor likes delete own"
on public.neighbor_likes for delete to authenticated
using (auth.uid() = user_id);

-- Seed swaps
create table public.seed_swaps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  plant_slug text,
  title text not null,
  description text,
  qty text,
  wants text,
  postal_code text,
  status text not null default 'open',
  image_url text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);
alter table public.seed_swaps enable row level security;

create policy "seed swaps select same postal"
on public.seed_swaps for select to authenticated
using (auth.uid() = user_id or public.same_postal(auth.uid(), user_id));

create policy "seed swaps insert own"
on public.seed_swaps for insert to authenticated
with check (auth.uid() = user_id);

create policy "seed swaps update own"
on public.seed_swaps for update to authenticated
using (auth.uid() = user_id);

create policy "seed swaps delete own"
on public.seed_swaps for delete to authenticated
using (auth.uid() = user_id);

create trigger seed_swaps_touch
before update on public.seed_swaps
for each row execute function public.touch_updated_at();

create index idx_seed_swaps_postal on public.seed_swaps(postal_code);