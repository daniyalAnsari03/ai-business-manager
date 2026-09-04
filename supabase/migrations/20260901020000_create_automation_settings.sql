-- AI Marketing Manager — Phase 4: Automation Control.
--
-- One business-level automation setting per business. Unlike marketing_wallet
-- (which is only materialised on first write), a business should always have
-- an explicit automation mode; the safe default is `needs_approval` so no
-- action is ever auto-executed until the owner deliberately switches to
-- `full_auto`.
--
-- Ownership is identical to every other table: one row belongs to exactly one
-- business, and RLS resolves the caller's business from auth.uid().

create table public.automation_settings (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  mode text not null default 'needs_approval',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint automation_settings_business_key unique (business_id),
  constraint automation_settings_mode_allowed check (
    mode in ('needs_approval', 'full_auto')
  )
);

comment on table public.automation_settings is
  'Business-level automation mode. Defaults to needs_approval so no sensitive AI action auto-runs until the owner opts into full_auto. Owner-scoped via RLS.';

create index automation_settings_business_id_idx on public.automation_settings (business_id);

create trigger automation_settings_set_updated_at
  before update on public.automation_settings
  for each row
  execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security — ownership chain (identical to every other table).
-- ---------------------------------------------------------------------------

alter table public.automation_settings enable row level security;

create policy "Owners can view their automation settings"
  on public.automation_settings for select
  using (
    exists (
      select 1 from public.businesses b
      where b.id = business_id and b.owner_id = (select auth.uid())
    )
  );

create policy "Owners can create their automation settings"
  on public.automation_settings for insert
  with check (
    exists (
      select 1 from public.businesses b
      where b.id = business_id and b.owner_id = (select auth.uid())
    )
  );

create policy "Owners can update their automation settings"
  on public.automation_settings for update
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

create policy "Owners can delete their automation settings"
  on public.automation_settings for delete
  using (
    exists (
      select 1 from public.businesses b
      where b.id = business_id and b.owner_id = (select auth.uid())
    )
  );
