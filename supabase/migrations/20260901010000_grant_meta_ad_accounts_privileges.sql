-- Privilege grants for meta_ad_accounts (Phase 0: Connect Meta Ads).
--
-- Same reasoning as every other grants migration: RLS policies never replace
-- SQL-level GRANTs — Postgres checks table privileges first, so without these
-- grants every API query fails with 42501 before RLS is evaluated. DELETE is
-- granted because the owner may clean up their own account row; RLS limits
-- every path to the owning business only.

grant select, insert, update, delete on public.meta_ad_accounts to anon;
grant select, insert, update, delete on public.meta_ad_accounts to authenticated;
grant select, insert, update, delete on public.meta_ad_accounts to service_role;
