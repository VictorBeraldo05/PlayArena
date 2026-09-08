create or replace function public.create_arena_for_current_user(
  p_name text,
  p_whatsapp text,
  p_phone text,
  p_description text,
  p_address text,
  p_city text,
  p_state text
)
returns public.arenas
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_user_id uuid := auth.uid();
  current_role text;
  created_arena public.arenas;
begin
  if target_user_id is null then
    raise exception 'authentication required' using errcode = 'P0001';
  end if;

  select profile.role
  into current_role
  from public.profiles as profile
  where profile.id = target_user_id;

  if not found then
    raise exception 'profile not found for authenticated user' using errcode = 'P0001';
  end if;

  if current_role is distinct from 'arena_owner' then
    raise exception
      'owner validation failed: uid=%, role=%, role_length=%, role_hex=%',
      target_user_id,
      coalesce(current_role, '<NULL>'),
      length(current_role),
      encode(convert_to(coalesce(current_role, ''), 'UTF8'), 'hex')
    using errcode = 'P0001';
  end if;

  insert into public.arenas (
    name,
    slug,
    description,
    phone,
    whatsapp,
    address,
    city,
    state
  )
  values (
    p_name,
    public.generate_unique_arena_slug(p_name),
    nullif(p_description, ''),
    nullif(p_phone, ''),
    nullif(p_whatsapp, ''),
    p_address,
    coalesce(nullif(p_city, ''), 'Piracicaba'),
    coalesce(nullif(p_state, ''), 'SP')
  )
  returning * into created_arena;

  insert into public.arena_owners (arena_id, user_id)
  values (created_arena.id, target_user_id);

  return created_arena;
end;
$$;

create or replace function public.onboarding_function_context_diagnostic()
returns table (
  auth_uid uuid,
  database_current_user text,
  database_session_user text,
  profile_id uuid,
  profile_role text,
  profile_role_length integer,
  profile_is_arena_owner boolean,
  profile_role_hex text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return query
  select
    auth.uid(),
    current_user::text,
    session_user::text,
    profile.id,
    profile.role,
    length(profile.role),
    profile.role = 'arena_owner',
    encode(convert_to(profile.role, 'UTF8'), 'hex')
  from (select 1) as current_request
  left join public.profiles as profile on profile.id = auth.uid();
end;
$$;

revoke all on function public.create_arena_for_current_user(text, text, text, text, text, text, text) from public;
grant execute on function public.create_arena_for_current_user(text, text, text, text, text, text, text) to authenticated;

revoke all on function public.onboarding_function_context_diagnostic() from public;
grant execute on function public.onboarding_function_context_diagnostic() to authenticated;
