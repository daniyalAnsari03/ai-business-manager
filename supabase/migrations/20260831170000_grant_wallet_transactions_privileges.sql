-- Privilege grants for public.wallet_transactions (Phase 3 wallet ledger).
--
-- Same reasoning as every other grants migration in this project:
-- RLS policies never replace SQL-level GRANTs — Postgres checks table
-- privileges first, so without these grants every API query fails with
-- 42501 "permission denied for table wallet_transactions" before RLS is
-- evaluated.
--
-- The wallet_transactions table CA and RPC functions were created in
-- 20260831160000_create_wallet_transactions.sql, but that migration omitted
-- the table grants, so reads/writes via the API (from the wallet-service and
-- from the UI transaction-history list) were blocked after the migration was
-- applied. This closes that gap, consistently with the other marketing
-- tables (20260828150000_grant_marketing_tables_privileges.sql).
--
-- DELETE is granted because the owner may clean up their own ledger rows;
-- RLS limits every path to the owning business only.
--
-- NOTE: This migration is intended for the LIVE Supabase project. Because it
-- only adds GRANTs that are idempotent (they are safe to re-run), it does not
-- need any data-migration guard.

grant select, insert, update, delete on public.wallet_transactions to anon;
grant select, insert, update, delete on public.wallet_transactions to authenticated;
grant select, insert, update, delete on public.wallet_transactions to service_role;
