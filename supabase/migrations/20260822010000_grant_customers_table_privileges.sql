-- Privilege grants for public.customers.
--
-- Same reasoning as the businesses/products grants migrations: RLS policies
-- never replace SQL-level GRANTs — Postgres checks table privileges first,
-- so without these grants every API query fails with 42501 "permission
-- denied for table customers" before RLS is evaluated.
--
-- DELETE is granted because customer deletion is part of this phase; the UI
-- always asks for explicit confirmation, and RLS limits every path to the
-- owning business only.

grant select, insert, update, delete on public.customers to anon;
grant select, insert, update, delete on public.customers to authenticated;
grant select, insert, update, delete on public.customers to service_role;
