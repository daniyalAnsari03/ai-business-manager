-- Privilege grants for public.products.
--
-- Same reasoning as the businesses grants migration: RLS policies never
-- replace SQL-level GRANTs — Postgres checks table privileges first, so
-- without these grants every API query fails with 42501 "permission denied
-- for table products" before RLS is evaluated.
--
-- DELETE is granted now because product deletion is part of this phase; the
-- application still archives (is_active = false) behind an explicit
-- confirmation step, and RLS limits every path to the owning business only.

grant select, insert, update, delete on public.products to anon;
grant select, insert, update, delete on public.products to authenticated;
grant select, insert, update, delete on public.products to service_role;
