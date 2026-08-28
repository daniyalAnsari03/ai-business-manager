-- AI Manager chat persistence: conversations + messages.
-- Every conversation belongs to exactly one business (User -> Business -> Conversation).
-- Messages belong to a conversation via FK.
-- Ownership is always derived from the authenticated server-side session;
-- RLS below is the second enforcement boundary.

create table public.ai_conversations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  title text not null default 'New chat',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint ai_conversations_title_length check (char_length(btrim(title)) between 1 and 200)
);

comment on table public.ai_conversations is
  'AI Manager conversation sessions owned by one business. Private business data — no public access.';

create index ai_conversations_business_id_idx on public.ai_conversations (business_id);
create index ai_conversations_business_updated_idx on public.ai_conversations (business_id, updated_at desc);

create trigger ai_conversations_set_updated_at
  before update on public.ai_conversations
  for each row
  execute function public.set_updated_at();

-- ---------------------------------------------------------------------------

create table public.ai_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.ai_conversations (id) on delete cascade,
  business_id uuid not null references public.businesses (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null default '',
  actions jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),

  constraint ai_messages_content_length check (char_length(content) <= 10000)
);

comment on table public.ai_messages is
  'Individual messages within an AI Manager conversation. Cascade-deletes with the parent conversation.';

create index ai_messages_conversation_id_idx on public.ai_messages (conversation_id);
create index ai_messages_conversation_created_idx on public.ai_messages (conversation_id, created_at asc);
create index ai_messages_business_id_idx on public.ai_messages (business_id);

-- ---------------------------------------------------------------------------
-- Row Level Security — same ownership chain as every other business table:
--   authenticated user -> owned business -> conversation.business_id / message.business_id
-- Deliberately NO "any authenticated user" access and no USING (true).
-- Every policy resolves the caller's business from auth.uid(), never from
-- client-supplied ids.
-- ---------------------------------------------------------------------------

alter table public.ai_conversations enable row level security;

create policy "Owners can view their business's conversations"
  on public.ai_conversations for select
  using (
    exists (
      select 1 from public.businesses b
      where b.id = business_id and b.owner_id = (select auth.uid())
    )
  );

create policy "Owners can create conversations for their business"
  on public.ai_conversations for insert
  with check (
    exists (
      select 1 from public.businesses b
      where b.id = business_id and b.owner_id = (select auth.uid())
    )
  );

create policy "Owners can update their business's conversations"
  on public.ai_conversations for update
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

create policy "Owners can delete their business's conversations"
  on public.ai_conversations for delete
  using (
    exists (
      select 1 from public.businesses b
      where b.id = business_id and b.owner_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------------

alter table public.ai_messages enable row level security;

create policy "Owners can view their business's messages"
  on public.ai_messages for select
  using (
    exists (
      select 1 from public.businesses b
      where b.id = business_id and b.owner_id = (select auth.uid())
    )
  );

create policy "Owners can create messages for their business"
  on public.ai_messages for insert
  with check (
    exists (
      select 1 from public.businesses b
      where b.id = business_id and b.owner_id = (select auth.uid())
    )
  );

create policy "Owners can update their business's messages"
  on public.ai_messages for update
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

create policy "Owners can delete their business's messages"
  on public.ai_messages for delete
  using (
    exists (
      select 1 from public.businesses b
      where b.id = business_id and b.owner_id = (select auth.uid())
    )
  );
