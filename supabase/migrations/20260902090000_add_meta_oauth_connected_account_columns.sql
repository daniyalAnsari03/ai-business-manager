-- AI Marketing Manager — Phase 0 live: real Instagram/Facebook OAuth.
--
-- connected_accounts gained the columns a real OAuth connection needs:
--   * access_token        — the long-lived Meta token for this channel, so the
--                           future publishing phase can post as the connected
--                           account. Stored owner-scoped behind RLS like every
--                           other row; never exposed to the client.
--   * token_expires_at    — when the token stops working, so the UI can show
--                           an honest "needs reconnect" state later.
--   * external_account_id — the Meta-side Page id (facebook) or Instagram
--                           business account id (instagram) this row refers to.
--
-- No weakening of existing constraints; the new columns are all nullable.

alter table public.connected_accounts
  add column access_token text,
  add column token_expires_at timestamptz,
  add column external_account_id text;

alter table public.connected_accounts
  add constraint connected_accounts_access_token_length check (
    access_token is null or char_length(access_token) <= 2048
  );

alter table public.connected_accounts
  add constraint connected_accounts_external_account_id_length check (
    external_account_id is null or char_length(external_account_id) <= 120
  );

comment on column public.connected_accounts.access_token is
  'Long-lived Meta access token for this connected channel. Server-verifiable, owner-scoped via RLS; never returned to the client.';

comment on column public.connected_accounts.token_expires_at is
  'When access_token stops being valid. Null while unknown.';

comment on column public.connected_accounts.external_account_id is
  'The Meta-side account id this row refers to (Facebook Page id or Instagram business account id).';
