-- Pricing precedence uses the newest matching rule as a deterministic tie-breaker.
alter table public.pricing_rules
  add column if not exists created_at timestamptz not null default timezone('utc', now());

-- Player reservations are written through the authenticated API, where arena,
-- duration, price, status and source are derived server-side. Keep direct client
-- writes closed so an authenticated browser cannot forge those fields.
revoke insert, update, delete on public.reservations from authenticated;

-- The API performs ownership checks before writing blocked slots as well.
revoke insert, update, delete on public.blocked_slots from authenticated;
