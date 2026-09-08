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
  profile_role_value text;
  created_arena public.arenas;
begin
  if target_user_id is null then
    raise exception 'authentication required' using errcode = 'P0001';
  end if;

  select profile.role
  into profile_role_value
  from public.profiles as profile
  where profile.id = target_user_id;

  if not found then
    raise exception 'profile not found for authenticated user' using errcode = 'P0001';
  end if;

  if profile_role_value is distinct from 'arena_owner' then
    raise exception 'user is not an arena owner' using errcode = 'P0001';
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

  insert into public.arena_owners (
    arena_id,
    user_id
  )
  values (
    created_arena.id,
    target_user_id
  );

  return created_arena;
end;
$$;

revoke all on function public.create_arena_for_current_user(text, text, text, text, text, text, text) from public;
grant execute on function public.create_arena_for_current_user(text, text, text, text, text, text, text) to authenticated;
