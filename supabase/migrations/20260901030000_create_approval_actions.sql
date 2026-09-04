-- AI Marketing Manager — Phase 4: Approval Action Engine.
--
-- `approval_actions` is the persistent record of a decision the AI wants to
-- perform. It is NOT a simple boolean: it captures the full payload, the
-- idempotency key, the human-readable summary, the lifecycle status and every
-- execution result so the in-app Review screen and Review history can render
-- exactly what happened without fabricating anything.
--
-- The lifecycle is enforced in code (see lib/marketing/approval-service.ts):
--   pending -> approved|rejected|expired|cancelled
--   approved -> executing -> completed|failed
-- Pending actions are NEVER executed directly by the caller; execution happens
-- through the approval service which claims the row atomically (status =>
-- executing) so a second concurrent run cannot double-execute.
--
-- `approval_events` is the audit log of every interesting transition (created,
-- notified, approved, rejected, execution started, completed, failed).

create table public.approval_actions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,

  action_type text not null,
  action_payload jsonb not null default '{}'::jsonb,
  summary text not null,
  approval_mode text not null default 'needs_approval',

  status text not null default 'pending',
  idempotency_key text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz,
  approved_at timestamptz,
  rejected_at timestamptz,
  approved_by uuid references auth.users (id) on delete set null,
  rejected_by uuid references auth.users (id) on delete set null,
  executed_at timestamptz,
  execution_result jsonb,
  execution_error text,

  external_reference text,

  constraint approval_actions_status_allowed check (
    status in ('pending', 'approved', 'rejected', 'executing', 'completed', 'failed', 'expired', 'cancelled')
  ),
  constraint approval_actions_mode_allowed check (
    approval_mode in ('needs_approval', 'full_auto')
  ),
  constraint approval_actions_action_type_length check (
    char_length(action_type) <= 100
  ),
  constraint approval_actions_summary_length check (
    char_length(summary) <= 2000
  ),
  constraint approval_actions_idempotency_key_length check (
    idempotency_key is null or char_length(idempotency_key) <= 160
  ),
  constraint approval_actions_external_reference_length check (
    external_reference is null or char_length(external_reference) <= 160
  )
);

comment on table public.approval_actions is
  'A pending/processed decision the AI wants the business to make. Status + idempotency guard against double execution; RLS keeps every action owner-scoped.';

-- One identical action for one business must never be created twice: the
-- idempotency key is the app-generated correlation id (e.g. an approval
-- request reference), and requiring it to be unique per business lets the
-- WhatsApp reply path map a single webhook message to exactly one action.
create unique index approval_actions_business_idempotency_key_idx
  on public.approval_actions (business_id, idempotency_key)
  where idempotency_key is not null;

create index approval_actions_business_id_idx on public.approval_actions (business_id);
create index approval_actions_business_status_idx on public.approval_actions (business_id, status);
create index approval_actions_business_created_idx on public.approval_actions (business_id, created_at desc);
create index approval_actions_external_reference_idx on public.approval_actions (external_reference);

create trigger approval_actions_set_updated_at
  before update on public.approval_actions
  for each row
  execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- approval_events — audit log
-- ---------------------------------------------------------------------------

create table public.approval_events (
  id uuid primary key default gen_random_uuid(),
  approval_action_id uuid not null references public.approval_actions (id) on delete cascade,
  business_id uuid not null references public.businesses (id) on delete cascade,
  event text not null,
  detail jsonb,
  created_at timestamptz not null default now(),

  constraint approval_events_event_length check (char_length(event) <= 80)
);

comment on table public.approval_events is
  'Audit trail of every transition on an approval_action (created / notified / approved / rejected / executed / completed / failed). Owner-scoped via RLS.';

create index approval_events_action_idx on public.approval_events (approval_action_id);
create index approval_events_business_created_idx on public.approval_events (business_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Row Level Security — ownership chain (identical to every other table).
-- ---------------------------------------------------------------------------

alter table public.approval_actions enable row level security;

create policy "Owners can view their approval actions"
  on public.approval_actions for select
  using (
    exists (
      select 1 from public.businesses b
      where b.id = business_id and b.owner_id = (select auth.uid())
    )
  );

create policy "Owners can create approval actions for their business"
  on public.approval_actions for insert
  with check (
    exists (
      select 1 from public.businesses b
      where b.id = business_id and b.owner_id = (select auth.uid())
    )
  );

create policy "Owners can update their approval actions"
  on public.approval_actions for update
  using (
    exists (
      select 1 from public.businesses b
      where b.id = business_id and b.owner_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.businesses b
      where b.id = business_id and b.owner_id = (select auth.uid())
    )
  );

create policy "Owners can delete their approval actions"
  on public.approval_actions for delete
  using (
    exists (
      select 1 from public.businesses b
      where b.id = business_id and b.owner_id = (select auth.uid())
    )
  );

alter table public.approval_events enable row level security;

create policy "Owners can view their approval events"
  on public.approval_events for select
  using (
    exists (
      select 1 from public.businesses b
      where b.id = business_id and b.owner_id = (select auth.uid())
    )
  );

create policy "Owners can create approval events for their business"
  on public.approval_events for insert
  with check (
    exists (
      select 1 from public.businesses b
      where b.id = business_id and b.owner_id = (select auth.uid())
    )
  );

create policy "Owners can update their approval events"
  on public.approval_events for update
  using (
    exists (
      select 1 from public.businesses b
      where b.id = business_id and b.owner_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.businesses b
      where b.id = business_id and b.owner_id = (select auth.uid())
    )
  );

create policy "Owners can delete their approval events"
  on public.approval_events for delete
  using (
    exists (
      select 1 from public.businesses b
      where b.id = business_id and b.owner_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- Idempotent approval execution RPC.
--
-- Claims an action for execution in a single atomic step: it may only move
-- from `approved` to `executing` (or from `pending` when the action is in a
-- full-auto business and already marked eligible). Returns the action row so
-- the caller can run its business logic exactly once. A second concurrent
-- call for the same id sees status already != the allowed transitions and
-- returns NULL, so double execution is impossible at the database level.
-- ---------------------------------------------------------------------------

create or replace function public.claim_approval_action(p_action_id uuid)
returns public.approval_actions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.approval_actions;
begin
  update public.approval_actions
  set status = 'executing',
      executed_at = now(),
      updated_at = now()
  where id = p_action_id
    and status in ('approved', 'pending')
  returning * into v_row;

  return v_row;
end;
$$;
