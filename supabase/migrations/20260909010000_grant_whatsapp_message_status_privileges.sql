-- Privilege grants for WhatsApp message status tables.
--
-- Postgres checks table privileges BEFORE RLS, so without these grants
-- the API returns 42501 "permission denied" on every query. Same pattern
-- as every other grants migration in this project.

grant select, insert, update, delete on public.whatsapp_message_status to anon;
grant select, insert, update, delete on public.whatsapp_message_status to authenticated;
grant select, insert, update, delete on public.whatsapp_message_status to service_role;

grant select, insert, update, delete on public.whatsapp_message_id_map to anon;
grant select, insert, update, delete on public.whatsapp_message_id_map to authenticated;
grant select, insert, update, delete on public.whatsapp_message_id_map to service_role;
