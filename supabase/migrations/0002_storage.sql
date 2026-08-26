-- =====================================================================
-- TradeSNA Web :: trade screenshot storage
--
-- Private bucket. Objects are keyed `<user_id>/<uuid>.<ext>`, and the
-- policies below pin the first path segment to the caller's auth.uid(), so
-- one trader can never read or delete another's screenshots. The client
-- hands out short-lived signed URLs for display.
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'trade-images',
  'trade-images',
  false,
  26214400,  -- 25 MB per image
  array['image/png','image/jpeg','image/gif','image/webp','image/bmp']
)
on conflict (id) do update
  set file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists trade_images_select on storage.objects;
create policy trade_images_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'trade-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists trade_images_insert on storage.objects;
create policy trade_images_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'trade-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists trade_images_update on storage.objects;
create policy trade_images_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'trade-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists trade_images_delete on storage.objects;
create policy trade_images_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'trade-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
