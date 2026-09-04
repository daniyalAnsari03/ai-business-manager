-- Privilege grants for the Phase 4 tables.
--
-- Same reasoning as every other grants migration: Postgres checks table
-- privileges BEFORE RLS, so without these grants the API returns 42501
-- "permission denied" on every query. DELETE is granted because owners may
-- clean up their own rows; RLS limits every path to the owning business only.

grant select, insert, update, delete on public.automation_settings to anon;
grant select, insert, update, delete on public.automation_settings to authenticated;
grant select, insert, update, delete on public.automation_settings to service_role;

grant select, insert, update, delete on public.approval_actions to anon;
grant select, insert, update, delete on public.approval_actions to authenticated;
grant select, insert, update, delete on public.approval_actions to service_role;

grant select, insert, update, delete on public.approval_events to anon;
grant select, insert, update, delete on public.approval_events to authenticated;
grant select, insert, update, delete on public.approval_events to service_role;

grant select, insert, update, delete on public.weekly_report_deliveries to anon;
grant select, insert, update, delete on public.weekly_report_deliveries to authenticated;
grant select, insert, update, delete on public.weekly_report_deliveries to service_role;

grant select, insert, update, delete on public.marketing_videos to anon;
grant select, insert, update, delete on public.marketing_videos to authenticated;
grant select, insert, update, delete on public.marketing_videos to service_role;

-- The claim_approval_action RPC is used by server-side code (service role /
-- authenticated) to atomically claim an action for execution.
grant execute on function public.claim_approval_action(uuid) to authenticated;
grant execute on function public.claim_approval_action(uuid) to service_role;
