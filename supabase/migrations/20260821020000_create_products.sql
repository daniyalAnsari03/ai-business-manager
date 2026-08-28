-- Phase 3: products + inventory foundation.
-- Every product belongs to exactly one business. Ownership is always derived
-- from the authenticated server-side session; RLS is enforced below as the
-- second boundary.
--
-- Deletion strategy: products are ARCHIVED (is_active = false), never hard
-- deleted, by the application. Upcoming Orders/Sales phases will reference
-- products; keeping rows preserves referential integrity and historical
-- reports. A DELETE policy/grant still exists for controlled future use.

create table public.products (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  name text not null,
  description text,
  category text not null,
  price numeric(12, 2) not null,
  stock_quantity integer not null default 0,
  low_stock_threshold integer not null default 5,
  sku text,
  image_url text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint products_name_length check (char_length(btrim(name)) between 1 and 120),
  constraint products_category_length check (char_length(btrim(category)) between 1 and 60),
  constraint products_description_length check (description is null or char_length(description) <= 2000),
  constraint products_sku_length check (sku is null or char_length(btrim(sku)) <= 60),
  constraint products_price_non_negative check (price >= 0),
  constraint products_stock_non_negative check (stock_quantity >= 0),
  constraint products_low_stock_threshold_non_negative check (low_stock_threshold >= 0)
);

comment on table public.products is
  'Products owned by one business. Stock is manual in this phase; orders will deduct it later. App-level delete archives (is_active = false) instead of destroying rows.';

-- Listing (newest first), category filtering and low-stock queries.
create index products_business_id_idx on public.products (business_id);
create index products_business_created_idx on public.products (business_id, created_at desc);
create index products_business_category_idx on public.products (business_id, category);
create index products_business_stock_idx on public.products (business_id, stock_quantity);

-- SKU is optional but, when present, unique inside the owning business.
create unique index products_business_sku_key
  on public.products (business_id, btrim(sku))
  where sku is not null and btrim(sku) <> '';

-- ---------------------------------------------------------------------------
-- updated_at maintenance (trigger function created in the businesses migration)
-- ---------------------------------------------------------------------------

create trigger products_set_updated_at
  before update on public.products
  for each row
  execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security — ownership chain:
--   authenticated user -> owned business -> product.business_id
-- Deliberately NO "any authenticated user" access. Every policy resolves the
-- caller's business from auth.uid(), never from client-supplied ids.
-- ---------------------------------------------------------------------------

alter table public.products enable row level security;

create policy "Owners can view their business's products"
  on public.products for select
  using (
    exists (
      select 1 from public.businesses b
      where b.id = business_id and b.owner_id = (select auth.uid())
    )
  );

create policy "Owners can create products for their business"
  on public.products for insert
  with check (
    exists (
      select 1 from public.businesses b
      where b.id = business_id and b.owner_id = (select auth.uid())
    )
  );

create policy "Owners can update their business's products"
  on public.products for update
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

-- Allowed from this phase: destructive removal stays behind explicit UI
-- confirmation; the app itself prefers archiving (is_active = false).
create policy "Owners can delete their business's products"
  on public.products for delete
  using (
    exists (
      select 1 from public.businesses b
      where b.id = business_id and b.owner_id = (select auth.uid())
    )
  );
