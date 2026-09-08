-- Temporary-safe diagnostic: exposes only the identity and role resolved for the caller.
create or replace function public.get_current_onboarding_diagnostic()
returns table (
  auth_uid uuid,
  profile_id uuid,
  profile_role text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    auth.uid() as auth_uid,
    profile.id as profile_id,
    profile.role as profile_role
  from (select 1) as current_request
  left join public.profiles as profile on profile.id = auth.uid();
$$;

revoke all on function public.get_current_onboarding_diagnostic() from public;
grant execute on function public.get_current_onboarding_diagnostic() to authenticated;
