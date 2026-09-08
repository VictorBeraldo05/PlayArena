create extension if not exists btree_gist;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  phone text,
  role text not null check (role in ('player', 'arena_owner', 'admin')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.arenas (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  description text,
  phone text,
  whatsapp text,
  address text not null,
  city text not null,
  state text not null,
  latitude numeric(9, 6),
  longitude numeric(9, 6),
  active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.arena_owners (
  arena_id uuid not null references public.arenas (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (arena_id, user_id)
);

create table if not exists public.sports (
  id bigserial primary key,
  name text not null unique,
  slug text not null unique
);

create table if not exists public.courts (
  id uuid primary key default gen_random_uuid(),
  arena_id uuid not null references public.arenas (id) on delete cascade,
  name text not null,
  description text,
  active boolean not null default true,
  default_duration_minutes integer not null default 60 check (default_duration_minutes > 0),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.court_sports (
  court_id uuid not null references public.courts (id) on delete cascade,
  sport_id bigint not null references public.sports (id) on delete restrict,
  primary key (court_id, sport_id)
);

create table if not exists public.opening_hours (
  id uuid primary key default gen_random_uuid(),
  arena_id uuid not null references public.arenas (id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  open_time time not null,
  close_time time not null,
  active boolean not null default true,
  check (open_time < close_time)
);

create table if not exists public.pricing_rules (
  id uuid primary key default gen_random_uuid(),
  court_id uuid not null references public.courts (id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  start_time time not null,
  end_time time not null,
  price numeric(10, 2) not null check (price >= 0),
  active boolean not null default true,
  check (start_time < end_time)
);

create table if not exists public.reservations (
  id uuid primary key default gen_random_uuid(),
  arena_id uuid not null references public.arenas (id) on delete cascade,
  court_id uuid not null references public.courts (id) on delete cascade,
  user_id uuid references public.profiles (id) on delete set null,
  customer_name text not null,
  customer_phone text not null,
  start_at timestamptz not null,
  end_at timestamptz not null,
  price numeric(10, 2) not null check (price >= 0),
  status text not null check (status in ('pending', 'confirmed', 'cancelled', 'completed', 'no_show')),
  source text not null check (source in ('app', 'arena_manual', 'whatsapp', 'admin')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  reservation_window tstzrange generated always as (tstzrange(start_at, end_at, '[)')) stored,
  check (start_at < end_at)
);

alter table public.reservations
  add constraint reservations_no_overlap_active
  exclude using gist (
    court_id with =,
    reservation_window with &&
  )
  where (status in ('pending', 'confirmed'));

create table if not exists public.recurring_reservations (
  id uuid primary key default gen_random_uuid(),
  arena_id uuid not null references public.arenas (id) on delete cascade,
  court_id uuid not null references public.courts (id) on delete cascade,
  user_id uuid references public.profiles (id) on delete set null,
  customer_name text not null,
  customer_phone text not null,
  weekday smallint not null check (weekday between 0 and 6),
  start_time time not null,
  end_time time not null,
  start_date date not null,
  end_date date,
  price numeric(10, 2) not null check (price >= 0),
  active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check (start_time < end_time),
  check (end_date is null or start_date <= end_date)
);

create table if not exists public.blocked_slots (
  id uuid primary key default gen_random_uuid(),
  court_id uuid not null references public.courts (id) on delete cascade,
  start_at timestamptz not null,
  end_at timestamptz not null,
  reason text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  check (start_at < end_at)
);

create table if not exists public.favorites (
  user_id uuid not null references public.profiles (id) on delete cascade,
  arena_id uuid not null references public.arenas (id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (user_id, arena_id)
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  type text not null,
  title text not null,
  body text not null,
  read_at timestamptz,
  created_at timestamptz not null default timezone('utc', now())
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create trigger set_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create trigger set_arenas_updated_at
before update on public.arenas
for each row execute function public.set_updated_at();

create trigger set_courts_updated_at
before update on public.courts
for each row execute function public.set_updated_at();

create trigger set_reservations_updated_at
before update on public.reservations
for each row execute function public.set_updated_at();

create trigger set_recurring_reservations_updated_at
before update on public.recurring_reservations
for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.arenas enable row level security;
alter table public.arena_owners enable row level security;
alter table public.courts enable row level security;
alter table public.reservations enable row level security;

create policy "profiles_self_select"
on public.profiles
for select
using (auth.uid() = id);

create policy "arenas_public_read_active"
on public.arenas
for select
using (active = true);

create policy "courts_public_read_active"
on public.courts
for select
using (
  active = true
  and exists (
    select 1
    from public.arenas
    where arenas.id = courts.arena_id
      and arenas.active = true
  )
);

create policy "arena_owners_manage_linked_arenas"
on public.arenas
for all
using (
  exists (
    select 1
    from public.arena_owners
    where arena_owners.arena_id = arenas.id
      and arena_owners.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.arena_owners
    where arena_owners.arena_id = arenas.id
      and arena_owners.user_id = auth.uid()
  )
);

create policy "arena_owners_manage_linked_courts"
on public.courts
for all
using (
  exists (
    select 1
    from public.arena_owners
    where arena_owners.arena_id = courts.arena_id
      and arena_owners.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.arena_owners
    where arena_owners.arena_id = courts.arena_id
      and arena_owners.user_id = auth.uid()
  )
);

create policy "owners_select_linked_memberships"
on public.arena_owners
for select
using (user_id = auth.uid());

create policy "players_read_reservations_own"
on public.reservations
for select
using (user_id = auth.uid());

create policy "owners_manage_reservations_linked_arenas"
on public.reservations
for all
using (
  exists (
    select 1
    from public.arena_owners
    where arena_owners.arena_id = reservations.arena_id
      and arena_owners.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.arena_owners
    where arena_owners.arena_id = reservations.arena_id
      and arena_owners.user_id = auth.uid()
  )
);
