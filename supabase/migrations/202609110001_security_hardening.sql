-- Security hardening for tables that are in the exposed public schema but are
-- not accessed directly by anonymous application clients.
alter table public.sports enable row level security;
alter table public.recurring_reservations enable row level security;
alter table public.favorites enable row level security;
alter table public.notifications enable row level security;

drop policy if exists "sports_public_read" on public.sports;
create policy "sports_public_read"
on public.sports for select to anon, authenticated
using (true);

drop policy if exists "favorites_select_own" on public.favorites;
create policy "favorites_select_own"
on public.favorites for select to authenticated
using (user_id = auth.uid());

drop policy if exists "favorites_insert_own" on public.favorites;
create policy "favorites_insert_own"
on public.favorites for insert to authenticated
with check (user_id = auth.uid());

drop policy if exists "favorites_delete_own" on public.favorites;
create policy "favorites_delete_own"
on public.favorites for delete to authenticated
using (user_id = auth.uid());

drop policy if exists "notifications_select_own" on public.notifications;
create policy "notifications_select_own"
on public.notifications for select to authenticated
using (user_id = auth.uid());

-- Browser roles must not modify catalog data or the currently unused private
-- tables. The API/database role retains its existing server-side access.
revoke insert, update, delete on public.sports from anon, authenticated;
revoke all on public.recurring_reservations from anon, authenticated;
revoke insert, update, delete on public.notifications from authenticated;

-- Client writes for arena configuration run through the API or security-definer
-- onboarding RPC. Closing direct table writes prevents bypassing their schema
-- validation and ownership checks. Profiles retain only the fields edited by
-- the player profile form.
revoke insert, update, delete on public.arenas from authenticated;
revoke insert, update, delete on public.arena_owners from authenticated;
revoke insert, update, delete on public.courts from authenticated;
revoke insert, update, delete on public.court_sports from authenticated;
revoke insert, update, delete on public.opening_hours from authenticated;
revoke insert, update, delete on public.pricing_rules from authenticated;
revoke update on public.profiles from authenticated;
grant update (full_name, phone) on public.profiles to authenticated;

-- These RPCs only exposed temporary onboarding diagnostics. They are not part
-- of the product flow and should not remain callable by browser sessions.
revoke all on function public.get_current_onboarding_diagnostic() from public, anon, authenticated;
revoke all on function public.onboarding_function_context_diagnostic() from public, anon, authenticated;
drop function if exists public.get_current_onboarding_diagnostic();
drop function if exists public.onboarding_function_context_diagnostic();

-- This helper is used inside the security-definer onboarding RPC only.
revoke all on function public.generate_unique_arena_slug(text) from public, anon, authenticated;
