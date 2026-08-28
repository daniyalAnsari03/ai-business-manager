-- Privilege grants for public.businesses.
--
-- RLS policies never replace SQL-level GRANTs: Postgres checks table
-- privileges first, so without these grants every API query fails with
-- 42501 "permission denied for table businesses" before RLS is evaluated.
-- This is why Business Setup could not save ("database abhi set nahi hua"
-- / database_error paths) even with correct env vars and RLS policies.
--
-- Standard Supabase API roles only — no schema or policy changes here.
-- DELETE is intentionally NOT granted to client roles: no DELETE policy
-- exists yet, and destructive actions stay behind explicit confirmation
-- flows in a later phase.

grant select, insert, update on public.businesses to anon;
grant select, insert, update on public.businesses to authenticated;
grant select, insert, update, delete on public.businesses to service_role;
