alter table public.arenas
  add column if not exists logo_path text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'arena-assets',
  'arena-assets',
  true,
  5242880,
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "arena_assets_public_read" on storage.objects;
create policy "arena_assets_public_read"
on storage.objects for select
using (bucket_id = 'arena-assets');

drop policy if exists "arena_assets_owner_insert" on storage.objects;
create policy "arena_assets_owner_insert"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'arena-assets'
  and (storage.foldername(name))[1] = 'arenas'
  and exists (
    select 1 from public.arena_owners ao
    where ao.arena_id::text = (storage.foldername(name))[2]
      and ao.user_id = auth.uid()
  )
);

drop policy if exists "arena_assets_owner_update" on storage.objects;
create policy "arena_assets_owner_update"
on storage.objects for update to authenticated
using (
  bucket_id = 'arena-assets'
  and (storage.foldername(name))[1] = 'arenas'
  and exists (
    select 1 from public.arena_owners ao
    where ao.arena_id::text = (storage.foldername(name))[2]
      and ao.user_id = auth.uid()
  )
)
with check (
  bucket_id = 'arena-assets'
  and (storage.foldername(name))[1] = 'arenas'
  and exists (
    select 1 from public.arena_owners ao
    where ao.arena_id::text = (storage.foldername(name))[2]
      and ao.user_id = auth.uid()
  )
);

drop policy if exists "arena_assets_owner_delete" on storage.objects;
create policy "arena_assets_owner_delete"
on storage.objects for delete to authenticated
using (
  bucket_id = 'arena-assets'
  and (storage.foldername(name))[1] = 'arenas'
  and exists (
    select 1 from public.arena_owners ao
    where ao.arena_id::text = (storage.foldername(name))[2]
      and ao.user_id = auth.uid()
  )
);
