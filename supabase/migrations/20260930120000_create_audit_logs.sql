-- General audit log (docs/fix.txt).
--
-- One row per noteworthy thing that happened inside a business: an AI action,
-- a manual edit, an automation run, a webhook delivery. The point is a single
-- answer to "who changed what, when, and why" that does not depend on any one
-- module remembering to log its own history.
--
-- This table is deliberately NOT an equivalent of public.approval_events:
--   - approval_events is scoped to approval_action lifecycles only
--     (created / notified / approved / rejected / executed / ...);
--   - whatsapp_inbound_events stores raw provider payloads for debugging.
-- Neither can answer a cross-module question, so a general table is needed.
--
-- `before` / `after` are the row snapshots either side of a change (jsonb).
-- They are intentionally nullable: not every action has a meaningful prior
-- state (a creation has no `before`, a deletion has no `after`).
--
-- `correlation_id` ties every row produced by one request/conversation/agent
-- turn together, so a single user-visible action can be traced end to end.

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,

  -- who acted. actor_id is a profile/auth uid for 'user', and is left null for
  -- 'ai', 'system' and 'webhook' (they have no owning user).
  actor_type text not null,
  actor_id uuid,

  -- what happened, to which record, and why.
  action text not null,
  entity text not null,
  entity_id uuid,
  "before" jsonb,
  "after" jsonb,
  reason text,

  -- free-form trace id shared by every row written during one request/turn.
  correlation_id text,

  created_at timestamptz not null default now(),

  constraint audit_logs_actor_type_allowed check (
    actor_type in ('user', 'ai', 'system', 'webhook')
  ),
  constraint audit_logs_action_length check (char_length(btrim(action)) between 1 and 100),
  constraint audit_logs_entity_length check (char_length(btrim(entity)) between 1 and 60),
  constraint audit_logs_reason_length check (reason is null or char_length(reason) <= 2000),
  constraint audit_logs_correlation_id_length check (
    correlation_id is null or char_length(correlation_id) <= 160
  )
);

comment on table public.audit_logs is
  'Append-only activity log per business. Written by the server (service role) only; owners can read their own rows and can never write, edit or delete them.';

-- ---------------------------------------------------------------------------
-- Indexes — the three read shapes the log is queried by.
-- ---------------------------------------------------------------------------

-- "Show me this business's activity, newest first" (the only UI read).
create index audit_logs_business_created_idx
  on public.audit_logs (business_id, created_at desc);

-- "Everything that ever happened to this one record" (drill-down from a row).
create index audit_logs_business_entity_idx
  on public.audit_logs (business_id, entity, entity_id);

-- "Everything one request/turn produced" (cross-module trace).
create index audit_logs_correlation_id_idx
  on public.audit_logs (correlation_id);

-- ---------------------------------------------------------------------------
-- Row Level Security — owner-scoped READ ONLY.
--
-- This is the same ownership chain every other table uses (authenticated user
-- -> owned business -> row.business_id), and it is the ONLY policy here.
--
-- There is deliberately no INSERT / UPDATE / DELETE policy for anon or
-- authenticated. RLS policies are not role-scoped, they apply to every role
-- that holds a matching table GRANT, so the "service role writes, users read"
-- split is enforced at the GRANT level below instead:
--
--   - audit rows are written only through getSupabaseAdminClient() (service
--     role), which bypasses RLS outright;
--   - no user, browser client or agent tool can forge, rewrite or erase history.
--
-- `before` and `after` snapshots are the reason this is append-only: an audit
-- row that its own subject can edit is not an audit row.
-- ---------------------------------------------------------------------------

alter table public.audit_logs enable row level security;

create policy "Owners can view their business's audit log"
  on public.audit_logs for select
  using (
    exists (
      select 1 from public.businesses b
      where b.id = business_id and b.owner_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- Privileges.
--
-- Postgres checks table privileges BEFORE RLS, so the GRANTs are the real
-- enforcement boundary for the write path (see the note above). Grants are
-- revoked first so any Supabase default-privilege setup cannot leak a write
-- grant that this migration did not intend to give.
-- ---------------------------------------------------------------------------

revoke all on public.audit_logs from anon;
revoke all on public.audit_logs from authenticated;

-- Owners may read their own history; nothing else.
grant select on public.audit_logs to authenticated;

-- The server writes and (for retention/migration work) maintains the log.
grant select, insert, update, delete on public.audit_logs to service_role;
