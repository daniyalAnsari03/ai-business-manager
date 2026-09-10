-- WhatsApp inbound webhook event persistence.
--
-- Every inbound WhatsApp message (approval replies, ad-hoc messages, etc.)
-- is recorded here BEFORE processing so we always have a debugging trail
-- even if downstream processing fails.  This is the answer to:
-- "Did the app receive my inbound WhatsApp message?"
--
-- business_id is nullable because the sender's phone may not yet be
-- registered in the businesses table (e.g. a new number or a test from
-- a different phone).

create table public.whatsapp_inbound_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references public.businesses (id) on delete set null,
  sender_phone text not null,
  body text not null,
  provider_message_id text not null,
  created_at timestamptz not null default now(),

  constraint whatsapp_inbound_events_provider_msg_key unique (provider_message_id)
);

comment on table public.whatsapp_inbound_events is
  'Raw inbound WhatsApp webhook events. Persisted before processing for audit and debugging.';

create index whatsapp_inbound_events_business_id_idx
  on public.whatsapp_inbound_events (business_id);

create index whatsapp_inbound_events_sender_phone_idx
  on public.whatsapp_inbound_events (sender_phone);

create index whatsapp_inbound_events_created_at_idx
  on public.whatsapp_inbound_events (created_at desc);

-- ---------------------------------------------------------------------------
-- Row Level Security — ownership chain.
-- ---------------------------------------------------------------------------

alter table public.whatsapp_inbound_events enable row level security;

create policy "Owners can view their inbound WhatsApp events"
  on public.whatsapp_inbound_events for select
  using (
    exists (
      select 1 from public.businesses b
      where b.id = business_id and b.owner_id = (select auth.uid())
    )
  );

create policy "Service role can insert inbound WhatsApp events"
  on public.whatsapp_inbound_events for insert
  with check (true);
