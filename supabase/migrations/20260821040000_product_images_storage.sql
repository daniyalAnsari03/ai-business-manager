-- Phase 3: product image storage.
--
-- Strategy: ONE public bucket ("product-images"), business-scoped object
-- paths: {business_id}/{random-uuid}.{ext}
--
-- Why a public bucket is the safest practical choice here:
--   * Product photos are non-sensitive marketing content that must render in
--     plain <img> tags; private buckets would force signed URLs (expiry
--     management, extra round-trips) for every thumbnail in every list.
--   * Isolation is enforced on WRITE: policies below verify that the first
--     path segment is a business OWNED BY THE CALLER (resolved from
--     auth.uid(), never trusted from the client). Users can never place,
--     overwrite or remove files outside their own business folder.
--   * Object names are random UUIDs, so paths are not enumerable.
--
-- Limits keep usage inside the free tier: 5 MB per file, images only.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product-images',
  'product-images',
  true,
  5242880, -- 5 MB
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Helper predicate: does the first path segment belong to a business owned
-- by the current user? Shared shape across the three write policies.
create or replace function public.owns_product_image_path(object_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.businesses b
    where b.owner_id = (select auth.uid())
      and b.id::text = (storage.foldername(object_name))[1]
  )
$$;

revoke execute on function public.owns_product_image_path(text) from anon;
grant execute on function public.owns_product_image_path(text) to authenticated;

-- Uploads must land inside the caller's own business folder.
create policy "Owners can upload product images"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'product-images'
    and public.owns_product_image_path(name)
  );

-- Replacing an image (same path) stays owner-only as well.
create policy "Owners can update their product images"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'product-images'
    and public.owns_product_image_path(name)
  )
  with check (
    bucket_id = 'product-images'
    and public.owns_product_image_path(name)
  );

-- Removing an image (e.g. replaced/cleared on edit) stays owner-only.
create policy "Owners can delete their product images"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'product-images'
    and public.owns_product_image_path(name)
  );
