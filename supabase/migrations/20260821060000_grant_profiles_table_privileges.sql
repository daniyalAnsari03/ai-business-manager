-- Privilege grants for public.profiles.
--
-- Same reasoning as the businesses/products grants migrations: RLS policies
-- never replace SQL-level GRANTs — Postgres checks table privileges first,
-- so without these grants every API query fails with 42501 "permission
-- denied for table profiles" before RLS is evaluated.
--
-- This single gap broke two visible features:
--   1. Language preference could not be saved (profiles UPDATE denied),
--      so English ↔ Roman Urdu never persisted across refresh/re-login.
--   2. getUserProfile() SELECT was denied, so profile.avatar_url never
--      reached the account menu and only the initials fallback rendered.
--
-- RLS remains the ownership boundary: every policy is bound to auth.uid()
-- = id. DELETE is intentionally NOT granted to client roles — profiles are
-- removed automatically via ON DELETE CASCADE when the auth user is deleted.

grant select, insert, update on public.profiles to anon;
grant select, insert, update on public.profiles to authenticated;
grant select, insert, update, delete on public.profiles to service_role;
