alter table public.reservations add column if not exists confirmed_at timestamptz;
alter table public.reservations add column if not exists cancelled_at timestamptz;

create table if not exists public.analytics_events (
  id uuid primary key default gen_random_uuid(),
  event_name text not null check (event_name in (
    'app_opened', 'search_started', 'availability_searched', 'availability_results_viewed',
    'availability_no_results', 'arena_viewed', 'reservation_started',
    'reservation_login_required'
  )),
  user_id uuid references public.profiles(id) on delete set null,
  anonymous_id text,
  session_id text not null,
  arena_id uuid references public.arenas(id) on delete set null,
  court_id uuid references public.courts(id) on delete set null,
  sport_id bigint references public.sports(id) on delete set null,
  reservation_id uuid references public.reservations(id) on delete set null,
  properties jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists analytics_events_occurred_at_idx on public.analytics_events (occurred_at desc);
create index if not exists analytics_events_name_occurred_at_idx on public.analytics_events (event_name, occurred_at desc);
create index if not exists analytics_events_session_id_idx on public.analytics_events (session_id, occurred_at desc);
create index if not exists analytics_events_arena_id_idx on public.analytics_events (arena_id, occurred_at desc);
create index if not exists reservations_status_created_at_idx on public.reservations (status, created_at desc);

alter table public.analytics_events enable row level security;

create or replace function public.set_reservation_status_timestamps()
returns trigger language plpgsql as $$
begin
  if new.status = 'confirmed' and old.status is distinct from 'confirmed' then
    new.confirmed_at = coalesce(new.confirmed_at, timezone('utc', now()));
  end if;
  if new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    new.cancelled_at = coalesce(new.cancelled_at, timezone('utc', now()));
  end if;
  return new;
end;
$$;

drop trigger if exists set_reservation_status_timestamps on public.reservations;
create trigger set_reservation_status_timestamps
before update of status on public.reservations
for each row execute function public.set_reservation_status_timestamps();
