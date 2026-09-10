-- Privilege grants for WhatsApp inbound events table.
--
-- Postgres checks table privileges BEFORE RLS, so without these grants
-- the API returns 42501 "permission denied" on every query.

grant select, insert, update, delete on public.whatsapp_inbound_events to anon;
grant select, insert, update, delete on public.whatsapp_inbound_events to authenticated;
grant select, insert, update, delete on public.whatsapp_inbound_events to service_role;
