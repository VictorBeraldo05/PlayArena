create extension if not exists pgcrypto;
create extension if not exists unaccent;

create or replace function public.slugify_text(value text)
returns text
language sql
immutable
as $$
  select trim(both '-' from regexp_replace(lower(unaccent(coalesce(value, ''))), '[^a-z0-9]+', '-', 'g'));
$$;

create or replace function public.generate_unique_arena_slug(value text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  base_slug text;
  next_slug text;
begin
  base_slug := nullif(public.slugify_text(value), '');

  if base_slug is null then
    base_slug := 'arena';
  end if;

  next_slug := base_slug;

  while exists (select 1 from public.arenas where slug = next_slug) loop
    next_slug := base_slug || '-' || substring(md5(gen_random_uuid()::text), 1, 6);
  end loop;

  return next_slug;
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, phone, role)
  values (
    new.id,
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'phone', ''),
    'player'
  )
  on conflict (id) do update
  set
    full_name = coalesce(public.profiles.full_name, excluded.full_name),
    phone = coalesce(public.profiles.phone, excluded.phone);

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

insert into public.profiles (id, full_name, phone, role, created_at, updated_at)
select
  users.id,
  nullif(users.raw_user_meta_data ->> 'full_name', ''),
  nullif(users.raw_user_meta_data ->> 'phone', ''),
  'player',
  timezone('utc', now()),
  timezone('utc', now())
from auth.users as users
on conflict (id) do nothing;

drop policy if exists "profiles_self_select" on public.profiles;
drop policy if exists "arenas_public_read_active" on public.arenas;
drop policy if exists "arena_owners_manage_linked_arenas" on public.arenas;
drop policy if exists "owners_select_linked_memberships" on public.arena_owners;

create policy "profiles_self_select"
on public.profiles
for select
to authenticated
using (auth.uid() = id);

create policy "profiles_self_update"
on public.profiles
for update
to authenticated
using (auth.uid() = id)
with check (
  auth.uid() = id
  and role = (select existing.role from public.profiles as existing where existing.id = auth.uid())
);

create policy "arenas_authenticated_read_active"
on public.arenas
for select
to authenticated
using (active = true);

create policy "arenas_owner_select_linked"
on public.arenas
for select
to authenticated
using (
  exists (
    select 1
    from public.arena_owners
    where arena_owners.arena_id = arenas.id
      and arena_owners.user_id = auth.uid()
  )
);

create policy "arenas_owner_update_linked"
on public.arenas
for update
to authenticated
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

create policy "arena_owners_select_own"
on public.arena_owners
for select
to authenticated
using (user_id = auth.uid());

create or replace function public.become_arena_owner()
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_profile public.profiles;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  update public.profiles
  set role = 'arena_owner'
  where id = auth.uid()
    and role in ('player', 'arena_owner')
  returning * into updated_profile;

  if updated_profile.id is null then
    raise exception 'profile not found or role cannot be changed';
  end if;

  return updated_profile;
end;
$$;

revoke all on function public.become_arena_owner() from public;
grant execute on function public.become_arena_owner() to authenticated;

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
set search_path = public
as $$
declare
  target_user_id uuid;
  current_role text;
  created_arena public.arenas;
begin
  target_user_id := auth.uid();

  if target_user_id is null then
    raise exception 'authentication required';
  end if;

  select role into current_role
  from public.profiles
  where id = target_user_id;

  if current_role is distinct from 'arena_owner' then
    raise exception 'user is not an arena owner';
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
  values (created_arena.id, target_user_id)
  on conflict do nothing;

  return created_arena;
end;
$$;

revoke all on function public.create_arena_for_current_user(text, text, text, text, text, text, text) from public;
grant execute on function public.create_arena_for_current_user(text, text, text, text, text, text, text) to authenticated;
