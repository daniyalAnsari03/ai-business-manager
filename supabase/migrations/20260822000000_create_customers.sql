-- Phase 6: customers.
-- Every customer belongs to exactly one business (User -> Business -> Customer).
-- Ownership is always derived from the authenticated server-side session;
-- RLS below is the second enforcement boundary.
--
-- Deleting a customer keeps their order history intact: orders.customer_id
-- is ON DELETE SET NULL, so past financial records never disappear.

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  name text not null,
  phone text,
  email text,
  address text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint customers_name_length check (char_length(btrim(name)) between 1 and 120),
  constraint customers_phone_length check (phone is null or char_length(btrim(phone)) <= 30),
  constraint customers_email_length check (email is null or char_length(btrim(email)) <= 200),
  constraint customers_address_length check (address is null or char_length(address) <= 500),
  constraint customers_notes_length check (notes is null or char_length(notes) <= 2000)
);

comment on table public.customers is
  'Customers owned by one business. Private business data — no public access.';

-- Listing (newest first) + name/phone/email search support.
create index customers_business_id_idx on public.customers (business_id);
create index customers_business_created_idx on public.customers (business_id, created_at desc);
create index customers_business_name_idx on public.customers (business_id, lower(name));
create index customers_business_phone_idx on public.customers (business_id, phone);

create trigger customers_set_updated_at
  before update on public.customers
  for each row
  execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security — ownership chain:
--   authenticated user -> owned business -> customer.business_id
-- Deliberately NO "any authenticated user" access and no USING (true).
-- Every policy resolves the caller's business from auth.uid(), never from
-- client-supplied ids.
-- ---------------------------------------------------------------------------

alter table public.customers enable row level security;

create policy "Owners can view their business's customers"
  on public.customers for select
  using (
    exists (
      select 1 from public.businesses b
      where b.id = business_id and b.owner_id = (select auth.uid())
    )
  );

create policy "Owners can create customers for their business"
  on public.customers for insert
  with check (
    exists (
      select 1 from public.businesses b
      where b.id = business_id and b.owner_id = (select auth.uid())
    )
  );

create policy "Owners can update their business's customers"
  on public.customers for update
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

-- Deletion stays owner-scoped; the UI always asks for explicit confirmation
-- first and order history survives via ON DELETE SET NULL.
create policy "Owners can delete their business's customers"
  on public.customers for delete
  using (
    exists (
      select 1 from public.businesses b
      where b.id = business_id and b.owner_id = (select auth.uid())
    )
  );
