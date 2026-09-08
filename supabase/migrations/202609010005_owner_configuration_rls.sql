alter table public.court_sports enable row level security;
alter table public.opening_hours enable row level security;
alter table public.pricing_rules enable row level security;

create policy "court_sports_owner_manage"
on public.court_sports
for all to authenticated
using (
  exists (
    select 1 from public.courts c
    join public.arena_owners ao on ao.arena_id = c.arena_id
    where c.id = court_sports.court_id and ao.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.courts c
    join public.arena_owners ao on ao.arena_id = c.arena_id
    where c.id = court_sports.court_id and ao.user_id = auth.uid()
  )
);

create policy "opening_hours_owner_manage"
on public.opening_hours
for all to authenticated
using (
  exists (
    select 1 from public.arena_owners ao
    where ao.arena_id = opening_hours.arena_id and ao.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.arena_owners ao
    where ao.arena_id = opening_hours.arena_id and ao.user_id = auth.uid()
  )
);

create policy "pricing_rules_owner_manage"
on public.pricing_rules
for all to authenticated
using (
  exists (
    select 1 from public.courts c
    join public.arena_owners ao on ao.arena_id = c.arena_id
    where c.id = pricing_rules.court_id and ao.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.courts c
    join public.arena_owners ao on ao.arena_id = c.arena_id
    where c.id = pricing_rules.court_id and ao.user_id = auth.uid()
  )
);
