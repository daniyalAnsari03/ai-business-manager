-- Privilege grants for the four Phase-1 marketing tables.
--
-- Same reasoning as the businesses/products/customers/orders grants
-- migrations: RLS policies never replace SQL-level GRANTs — Postgres checks
-- table privileges first, so without these grants every API query fails with
-- 42501 "permission denied for table ..." before RLS is evaluated.
--
-- DELETE is granted because the owner may clean up their own marketing rows;
-- the UI always asks for explicit confirmation first, and RLS limits every
-- path to the owning business only.

grant select, insert, update, delete on public.social_posts to anon;
grant select, insert, update, delete on public.social_posts to authenticated;
grant select, insert, update, delete on public.social_posts to service_role;

grant select, insert, update, delete on public.ad_campaigns to anon;
grant select, insert, update, delete on public.ad_campaigns to authenticated;
grant select, insert, update, delete on public.ad_campaigns to service_role;

grant select, insert, update, delete on public.marketing_wallet to anon;
grant select, insert, update, delete on public.marketing_wallet to authenticated;
grant select, insert, update, delete on public.marketing_wallet to service_role;

grant select, insert, update, delete on public.connected_accounts to anon;
grant select, insert, update, delete on public.connected_accounts to authenticated;
grant select, insert, update, delete on public.connected_accounts to service_role;