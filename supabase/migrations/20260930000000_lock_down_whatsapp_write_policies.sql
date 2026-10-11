-- Lock down the WhatsApp write paths (docs/fix.txt).
--
-- The original migrations created permissive write policies on the three
-- WhatsApp tables:
--
--   20260909000000_create_whatsapp_message_status.sql
--     "Service role can insert WhatsApp message statuses"  (insert, with check (true))
--     "Service role can update WhatsApp message statuses"  (update, using (true) with check (true))
--     "Service role can insert WhatsApp message ID mappings"(insert, with check (true))
--   20260909020000_create_whatsapp_inbound_events.sql
--     "Service role can insert inbound WhatsApp events"     (insert, with check (true))
--
-- RLS policies are NOT role-scoped: they apply to every role that holds the
-- matching table grant. The paired grants migrations hand
-- `select, insert, update, delete` to `anon` and `authenticated`, so those
-- `true` policies were wide open to any caller holding nothing but the public
-- anon key -- fake inbound events, forged delivery statuses, and forged
-- provider-message-ID -> business mappings.
--
-- No replacement write policy is required: every write to these tables goes
-- through getSupabaseAdminClient() (service role), which bypasses RLS
-- outright. Confirmed call sites:
--   app/api/whatsapp/webhook/route.ts   -> inbound_events insert, status upsert
--   lib/marketing/whatsapp/approval-notify.ts -> message_id_map insert
--   lib/marketing/weekly-report.ts             -> message_id_map insert
--
-- The owner-scoped SELECT policies are deliberately left untouched: owners
-- still need to read their own status rows and ID mappings.

drop policy if exists "Service role can insert inbound WhatsApp events"
  on public.whatsapp_inbound_events;

drop policy if exists "Service role can insert WhatsApp message statuses"
  on public.whatsapp_message_status;

drop policy if exists "Service role can update WhatsApp message statuses"
  on public.whatsapp_message_status;

drop policy if exists "Service role can insert WhatsApp message ID mappings"
  on public.whatsapp_message_id_map;
