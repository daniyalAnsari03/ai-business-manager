-- Privilege grants for public.ai_conversations and public.ai_messages.
--
-- Same reasoning as other grants migrations: RLS policies never replace
-- SQL-level GRANTs — Postgres checks table privileges first, so without
-- these grants every API query fails with 42501 before RLS is evaluated.
--
-- DELETE is granted because conversation deletion is part of this phase;
-- the UI always asks for explicit confirmation, and RLS limits every path
-- to the owning business only.

grant select, insert, update, delete on public.ai_conversations to anon;
grant select, insert, update, delete on public.ai_conversations to authenticated;
grant select, insert, update, delete on public.ai_conversations to service_role;

grant select, insert, update, delete on public.ai_messages to anon;
grant select, insert, update, delete on public.ai_messages to authenticated;
grant select, insert, update, delete on public.ai_messages to service_role;
