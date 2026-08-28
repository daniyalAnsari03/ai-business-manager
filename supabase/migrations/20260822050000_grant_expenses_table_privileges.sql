-- Privilege grants for public.expenses.
--
-- Same reasoning as the other grants migrations: RLS policies never replace
-- SQL-level GRANTs — Postgres checks table privileges first, so without
-- these grants every API query fails with 42501 "permission denied" before
-- RLS is evaluated. DELETE is granted because expense deletion is part of
-- this phase behind explicit UI confirmation; RLS limits every path to the
-- owning business only.

grant select, insert, update, delete on public.expenses to anon;
grant select, insert, update, delete on public.expenses to authenticated;
grant select, insert, update, delete on public.expenses to service_role;
