-- AI Marketing Manager — Phase 4: Weekly WhatsApp Marketing Report.
--
-- `weekly_report_deliveries` records each weekly marketing report delivery so
-- the cron job is idempotent: a given week (Monday of an ISO week) for a given
-- business is delivered at most once. If the job is re-run for the same
-- business/week (clock skew, retry after a transient failure, duplicate cron
-- fire) it reads the existing row and skips — no duplicate reports.
--
-- The unique constraint on (business_id, week_start) is the idempotency
-- guarantee. `delivery_status` distinguishes a genuinely sent report from a
-- `skipped` (WhatsApp not connected) outcome so we never pretend a report was
-- delivered when the channel was unavailable.

create table public.weekly_report_deliveries (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  week_start date not null,
  delivery_status text not null default 'pending',
  report_payload jsonb,
  delivery_error text,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint weekly_report_deliveries_business_week_key unique (business_id, week_start),
  constraint weekly_report_deliveries_status_allowed check (
    delivery_status in ('pending', 'sent', 'skipped', 'failed')
  )
);

comment on table public.weekly_report_deliveries is
  'One row per (business, ISO week) proving the weekly marketing report was sent at most once. Owner-scoped via RLS.';

create index weekly_report_deliveries_business_id_idx on public.weekly_report_deliveries (business_id);
create index weekly_report_deliveries_week_idx on public.weekly_report_deliveries (week_start);

create trigger weekly_report_deliveries_set_updated_at
  before update on public.weekly_report_deliveries
  for each row
  execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security — ownership chain.
-- ---------------------------------------------------------------------------

alter table public.weekly_report_deliveries enable row level security;

create policy "Owners can view their weekly report deliveries"
  on public.weekly_report_deliveries for select
  using (
    exists (
      select 1 from public.businesses b
      where b.id = business_id and b.owner_id = (select auth.uid())
    )
  );

create policy "Owners can create weekly report deliveries for their business"
  on public.weekly_report_deliveries for insert
  with check (
    exists (
      select 1 from public.businesses b
      where b.id = business_id and b.owner_id = (select auth.uid())
    )
  );

create policy "Owners can update their weekly report deliveries"
  on public.weekly_report_deliveries for update
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

create policy "Owners can delete their weekly report deliveries"
  on public.weekly_report_deliveries for delete
  using (
    exists (
      select 1 from public.businesses b
      where b.id = business_id and b.owner_id = (select auth.uid())
    )
  );
