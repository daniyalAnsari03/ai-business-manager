-- AI Marketing Manager — Phase 1: foundation.
--
-- Four marketing tables, owned by exactly one business each
-- (User -> Business -> {social_post, ad_campaign, wallet, connected_account}).
-- Ownership is always derived from the authenticated server-side session;
-- RLS below is the second enforcement boundary and mirrors the exact
-- products/customers/orders pattern — deliberately NO "any authenticated
-- user" access and no USING (true).
--
-- Phase-1 note: no payment, OAuth, posting, budget-spending or automation
-- logic exists yet. These tables only hold the schema and safe defaults so
-- later phases build real features on top of a stable, owner-scoped base.

-- ---------------------------------------------------------------------------
-- social_posts — posts drafted/scheduled/published to a connected channel.
-- product_id is optional (a post may promote nothing) and ON DELETE SET NULL
-- so removing a product never destroys its past marketing history.
-- ---------------------------------------------------------------------------

create table public.social_posts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  product_id uuid references public.products (id) on delete set null,
  platform text not null,
  caption text,
  media_url text,
  status text not null default 'draft',
  scheduled_at timestamptz,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint social_posts_platform_allowed check (platform in ('instagram', 'facebook')),
  constraint social_posts_status_allowed check (
    status in ('draft', 'scheduled', 'published', 'failed')
  ),
  constraint social_posts_caption_length check (
    caption is null or char_length(caption) <= 2200
  ),
  constraint social_posts_media_url_length check (
    media_url is null or char_length(media_url) <= 1000
  )
);

comment on table public.social_posts is
  'Social posts owned by one business. Private business data — no public access. Phase 1 stores the field structure only; no real posting happens yet.';

create index social_posts_business_id_idx on public.social_posts (business_id);
create index social_posts_business_created_idx on public.social_posts (business_id, created_at desc);
create index social_posts_business_status_idx on public.social_posts (business_id, status);

create trigger social_posts_set_updated_at
  before update on public.social_posts
  for each row
  execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- ad_campaigns — budget/spend envelope for a marketing goal.
-- social_post_id is optional and ON DELETE SET NULL (a campaign can outlive
-- the specific post it accompanies).
-- ---------------------------------------------------------------------------

create table public.ad_campaigns (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  social_post_id uuid references public.social_posts (id) on delete set null,
  platform text not null,
  budget_amount numeric(12, 2) not null default 0,
  spent_amount numeric(12, 2) not null default 0,
  status text not null default 'draft',
  goal text not null default 'profile',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint ad_campaigns_platform_allowed check (
    platform in ('instagram', 'facebook', 'google_ads', 'whatsapp')
  ),
  constraint ad_campaigns_status_allowed check (
    status in ('draft', 'active', 'paused', 'completed')
  ),
  constraint ad_campaigns_goal_allowed check (
    goal in ('whatsapp', 'website', 'profile')
  ),
  constraint ad_campaigns_budget_non_negative check (budget_amount >= 0),
  constraint ad_campaigns_spent_non_negative check (spent_amount >= 0),
  constraint ad_campaigns_spent_within_budget check (spent_amount <= budget_amount)
);

comment on table public.ad_campaigns is
  'Ad campaigns owned by one business. Budget/spend stay owner-scoped via RLS. Phase 1 stores the envelope only — no real ad creation or spending happens yet.';

create index ad_campaigns_business_id_idx on public.ad_campaigns (business_id);
create index ad_campaigns_business_created_idx on public.ad_campaigns (business_id, created_at desc);
create index ad_campaigns_business_status_idx on public.ad_campaigns (business_id, status);

create trigger ad_campaigns_set_updated_at
  before update on public.ad_campaigns
  for each row
  execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- marketing_wallet — one row per business. balance starts at 0; there is no
-- payment/top-up logic in this phase, only the column existing. The monthly
-- budget cap is nullable so "no cap set" stays distinct from "cap of 0".
-- ---------------------------------------------------------------------------

create table public.marketing_wallet (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  balance numeric(12, 2) not null default 0,
  monthly_budget_cap numeric(12, 2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint marketing_wallet_business_key unique (business_id),
  constraint marketing_wallet_balance_non_negative check (balance >= 0),
  constraint marketing_wallet_cap_non_negative check (
    monthly_budget_cap is null or monthly_budget_cap >= 0
  )
);

comment on table public.marketing_wallet is
  'Single marketing wallet per business. Phase 1 only persists the schema and default zero balance — top-ups and payments arrive in later phases.';

create trigger marketing_wallet_set_updated_at
  before update on public.marketing_wallet
  for each row
  execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- connected_accounts — one row per (business, platform) describing whether a
-- channel is linked. No real OAuth tokens exist in Phase 1; every row starts
-- as not_connected and the settings shell displays that honestly.
-- ---------------------------------------------------------------------------

create table public.connected_accounts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  platform text not null,
  status text not null default 'not_connected',
  account_label text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint connected_accounts_platform_allowed check (
    platform in ('instagram', 'facebook', 'google_ads', 'whatsapp')
  ),
  constraint connected_accounts_status_allowed check (
    status in ('not_connected', 'connected')
  ),
  constraint connected_accounts_business_platform_key unique (business_id, platform),
  constraint connected_accounts_label_length check (
    account_label is null or char_length(account_label) <= 120
  )
);

comment on table public.connected_accounts is
  'Channel link status per business and platform. Phase 1 stores status only; real OAuth connections arrive in later phases.';

create index connected_accounts_business_id_idx on public.connected_accounts (business_id);

create trigger connected_accounts_set_updated_at
  before update on public.connected_accounts
  for each row
  execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security — ownership chain (identical to products/customers/orders):
--   authenticated user -> owned business -> row.business_id
-- Every policy resolves the caller's business from auth.uid(), never from
-- client-supplied ids.
-- ---------------------------------------------------------------------------

alter table public.social_posts enable row level security;

create policy "Owners can view their business's social posts"
  on public.social_posts for select
  using (
    exists (
      select 1 from public.businesses b
      where b.id = business_id and b.owner_id = (select auth.uid())
    )
  );

create policy "Owners can create social posts for their business"
  on public.social_posts for insert
  with check (
    exists (
      select 1 from public.businesses b
      where b.id = business_id and b.owner_id = (select auth.uid())
    )
  );

create policy "Owners can update their business's social posts"
  on public.social_posts for update
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

create policy "Owners can delete their business's social posts"
  on public.social_posts for delete
  using (
    exists (
      select 1 from public.businesses b
      where b.id = business_id and b.owner_id = (select auth.uid())
    )
  );

alter table public.ad_campaigns enable row level security;

create policy "Owners can view their business's ad campaigns"
  on public.ad_campaigns for select
  using (
    exists (
      select 1 from public.businesses b
      where b.id = business_id and b.owner_id = (select auth.uid())
    )
  );

create policy "Owners can create ad campaigns for their business"
  on public.ad_campaigns for insert
  with check (
    exists (
      select 1 from public.businesses b
      where b.id = business_id and b.owner_id = (select auth.uid())
    )
  );

create policy "Owners can update their business's ad campaigns"
  on public.ad_campaigns for update
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

create policy "Owners can delete their business's ad campaigns"
  on public.ad_campaigns for delete
  using (
    exists (
      select 1 from public.businesses b
      where b.id = business_id and b.owner_id = (select auth.uid())
    )
  );

alter table public.marketing_wallet enable row level security;

create policy "Owners can view their own marketing wallet"
  on public.marketing_wallet for select
  using (
    exists (
      select 1 from public.businesses b
      where b.id = business_id and b.owner_id = (select auth.uid())
    )
  );

create policy "Owners can create their marketing wallet"
  on public.marketing_wallet for insert
  with check (
    exists (
      select 1 from public.businesses b
      where b.id = business_id and b.owner_id = (select auth.uid())
    )
  );

create policy "Owners can update their marketing wallet"
  on public.marketing_wallet for update
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

create policy "Owners can delete their marketing wallet"
  on public.marketing_wallet for delete
  using (
    exists (
      select 1 from public.businesses b
      where b.id = business_id and b.owner_id = (select auth.uid())
    )
  );

alter table public.connected_accounts enable row level security;

create policy "Owners can view their business's connected accounts"
  on public.connected_accounts for select
  using (
    exists (
      select 1 from public.businesses b
      where b.id = business_id and b.owner_id = (select auth.uid())
    )
  );

create policy "Owners can create connected accounts for their business"
  on public.connected_accounts for insert
  with check (
    exists (
      select 1 from public.businesses b
      where b.id = business_id and b.owner_id = (select auth.uid())
    )
  );

create policy "Owners can update their business's connected accounts"
  on public.connected_accounts for update
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

create policy "Owners can delete their business's connected accounts"
  on public.connected_accounts for delete
  using (
    exists (
      select 1 from public.businesses b
      where b.id = business_id and b.owner_id = (select auth.uid())
    )
  );