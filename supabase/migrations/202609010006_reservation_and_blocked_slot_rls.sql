alter table public.blocked_slots enable row level security;

create policy "blocked_slots_owner_manage"
on public.blocked_slots
for all to authenticated
using (
  exists (
    select 1
    from public.courts c
    join public.arena_owners ao on ao.arena_id = c.arena_id
    where c.id = blocked_slots.court_id
      and ao.user_id = auth.uid()
  )
)
with check (
  created_by = auth.uid()
  and exists (
    select 1
    from public.courts c
    join public.arena_owners ao on ao.arena_id = c.arena_id
    where c.id = blocked_slots.court_id
      and ao.user_id = auth.uid()
  )
);

create policy "owners_read_reservations_linked_arenas"
on public.reservations
for select to authenticated
using (
  exists (
    select 1 from public.arena_owners ao
    where ao.arena_id = reservations.arena_id
      and ao.user_id = auth.uid()
  )
);
