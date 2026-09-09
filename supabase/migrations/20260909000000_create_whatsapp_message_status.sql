-- WhatsApp outbound message delivery status persistence.
--
-- Meta sends status webhooks (sent → delivered → read) for each outbound
-- message. Previously these were only logged to console. This migration adds
-- two tables:
--
-- 1. `whatsapp_message_status` — the actual delivery state per message.
--    Unique on `message_id` (Meta's wamid) for idempotent upserts when Meta
--    retries the same status webhook.
--
-- 2. `whatsapp_message_id_map` — maps a Meta provider message ID back to the
--    owning business so that status webhooks (which carry no business context)
--    can be resolved. Populated when outbound messages are sent via the
--    approval engine or weekly report.

create table public.whatsapp_message_status (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  message_id text not null,
  recipient_phone text not null,
  status text not null default 'sent',
  provider_timestamp timestamptz,
  errors jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint whatsapp_message_status_message_id_key unique (message_id),
  constraint whatsapp_message_status_status_allowed check (
    status in ('sent', 'delivered', 'read', 'failed')
  )
);

comment on table public.whatsapp_message_status is
  'Outbound WhatsApp message delivery state (sent/delivered/read/failed). Idempotent per Meta message ID.';

create index whatsapp_message_status_business_id_idx
  on public.whatsapp_message_status (business_id);

create index whatsapp_message_status_status_idx
  on public.whatsapp_message_status (status);

create trigger whatsapp_message_status_set_updated_at
  before update on public.whatsapp_message_status
  for each row
  execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Lookup table: Meta provider message ID → business_id.
-- ---------------------------------------------------------------------------
-- Status webhooks from Meta do NOT include business context. This table maps
-- the provider message ID (wamid.xxx) to the owning business so the status
-- handler can resolve ownership. Populated at send time.

create table public.whatsapp_message_id_map (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  provider_message_id text not null,
  recipient_phone text not null,
  created_at timestamptz not null default now(),

  constraint whatsapp_message_id_map_provider_msg_key unique (provider_message_id)
);

comment on table public.whatsapp_message_id_map is
  'Maps Meta provider message IDs to businesses for status webhook resolution.';

create index whatsapp_message_id_map_provider_idx
  on public.whatsapp_message_id_map (provider_message_id);

-- ---------------------------------------------------------------------------
-- Row Level Security — ownership chain (same pattern as weekly_report_deliveries).
-- ---------------------------------------------------------------------------

alter table public.whatsapp_message_status enable row level security;

create policy "Owners can view their WhatsApp message statuses"
  on public.whatsapp_message_status for select
  using (
    exists (
      select 1 from public.businesses b
      where b.id = business_id and b.owner_id = (select auth.uid())
    )
  );

create policy "Service role can insert WhatsApp message statuses"
  on public.whatsapp_message_status for insert
  with check (true);

create policy "Service role can update WhatsApp message statuses"
  on public.whatsapp_message_status for update
  using (true)
  with check (true);

alter table public.whatsapp_message_id_map enable row level security;

create policy "Owners can view their WhatsApp message ID mappings"
  on public.whatsapp_message_id_map for select
  using (
    exists (
      select 1 from public.businesses b
      where b.id = business_id and b.owner_id = (select auth.uid())
    )
  );

create policy "Service role can insert WhatsApp message ID mappings"
  on public.whatsapp_message_id_map for insert
  with check (true);
