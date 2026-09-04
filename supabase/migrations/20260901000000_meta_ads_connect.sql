-- AI Marketing Manager — Phase 0: Connect Meta Ads (reduced scope).
--
-- This phase ONLY builds the UI/schema/logic foundation for connecting a
-- business's own Meta Ad Account. There is NO real Meta OAuth, NO campaign
-- creation via the Marketing API, and NO live spend monitoring here — a real
-- Meta Developer App (App ID + Secret) is still required for the live flow
-- (docs/phase0.txt). This migration only:
--   1. admits "meta_ads" as a valid platform on the existing
--      connected_accounts (the same row type already used for Instagram,
--      Facebook, Google Ads and WhatsApp) and on ad_campaigns.
--   2. adds the fields ad_campaigns needs to plan/draft a campaign envelope
--      (daily_budget, monthly_budget_cap, spend_to_date) and the
--      "pending_connection" status that honestly describes a campaign waiting
--      on a connected Meta account.
--   3. creates meta_ad_accounts, the owner-scoped record of a business's
--      Meta Ad Account id/name once it is linked.
--
-- Ownership stays identical to every other table: one row belongs to exactly
-- one business, and RLS resolves the caller's business from auth.uid().

-- ---------------------------------------------------------------------------
-- 1. Admit meta_ads on the existing platform checks (DROP + re-ADD the check
--    constraint — Postgres cannot ALTER an existing CHECK's allowed set).
-- ---------------------------------------------------------------------------

alter table public.connected_accounts
  drop constraint connected_accounts_platform_allowed;

alter table public.connected_accounts
  add constraint connected_accounts_platform_allowed check (
    platform in ('instagram', 'facebook', 'google_ads', 'whatsapp', 'meta_ads')
  );

alter table public.ad_campaigns
  drop constraint ad_campaigns_platform_allowed;

alter table public.ad_campaigns
  add constraint ad_campaigns_platform_allowed check (
    platform in ('instagram', 'facebook', 'google_ads', 'whatsapp', 'meta_ads')
  );

-- ---------------------------------------------------------------------------
-- 2. ad_campaigns — campaign envelope columns for the budget planner plus the
--    honest "pending_connection" status (a draft waiting on a real Meta
--    connection). Existing rows keep working: the new columns default to 0 /
--    null and the old statuses remain valid.
-- ---------------------------------------------------------------------------

alter table public.ad_campaigns
  add column daily_budget numeric(12, 2) not null default 0;

alter table public.ad_campaigns
  add column monthly_budget_cap numeric(12, 2);

alter table public.ad_campaigns
  add column spend_to_date numeric(12, 2) not null default 0;

alter table public.ad_campaigns
  drop constraint ad_campaigns_status_allowed;

alter table public.ad_campaigns
  add constraint ad_campaigns_status_allowed check (
    status in ('draft', 'pending_connection', 'active', 'paused', 'completed')
  );

alter table public.ad_campaigns
  add constraint ad_campaigns_daily_budget_non_negative check (daily_budget >= 0);

alter table public.ad_campaigns
  add constraint ad_campaigns_monthly_cap_non_negative check (
    monthly_budget_cap is null or monthly_budget_cap >= 0
  );

alter table public.ad_campaigns
  add constraint ad_campaigns_spend_to_date_non_negative check (spend_to_date >= 0);

-- ---------------------------------------------------------------------------
-- 3. meta_ad_accounts — one row per business holding the linked Meta Ad
--    Account identity once the owner connects it. A missing row (or status
--    'not_connected') honestly means the business has not connected an ads
--    account yet. Ad spend never flows through this table — the app only
--    reads/creates campaigns on the account the owner funds on Meta's side.
-- ---------------------------------------------------------------------------

create table public.meta_ad_accounts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  ad_account_id text,
  ad_account_name text,
  status text not null default 'not_connected',
  connected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint meta_ad_accounts_business_key unique (business_id),
  constraint meta_ad_accounts_status_allowed check (
    status in ('not_connected', 'connected')
  ),
  constraint meta_ad_accounts_id_length check (
    ad_account_id is null or char_length(ad_account_id) <= 80
  ),
  constraint meta_ad_accounts_name_length check (
    ad_account_name is null or char_length(ad_account_name) <= 160
  )
);

comment on table public.meta_ad_accounts is
  'Linked Meta Ad Account per business, owner-scoped via RLS. Phase 0 stores identity only; real OAuth connection arrives in a later phase.';

create index meta_ad_accounts_business_id_idx on public.meta_ad_accounts (business_id);

create trigger meta_ad_accounts_set_updated_at
  before update on public.meta_ad_accounts
  for each row
  execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security — identical ownership chain to every other table:
--   authenticated user -> owned business -> row.business_id
-- ---------------------------------------------------------------------------

alter table public.meta_ad_accounts enable row level security;

create policy "Owners can view their business's meta ad account"
  on public.meta_ad_accounts for select
  using (
    exists (
      select 1 from public.businesses b
      where b.id = business_id and b.owner_id = (select auth.uid())
    )
  );

create policy "Owners can create their meta ad account"
  on public.meta_ad_accounts for insert
  with check (
    exists (
      select 1 from public.businesses b
      where b.id = business_id and b.owner_id = (select auth.uid())
    )
  );

create policy "Owners can update their business's meta ad account"
  on public.meta_ad_accounts for update
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

create policy "Owners can delete their business's meta ad account"
  on public.meta_ad_accounts for delete
  using (
    exists (
      select 1 from public.businesses b
      where b.id = business_id and b.owner_id = (select auth.uid())
    )
  );
