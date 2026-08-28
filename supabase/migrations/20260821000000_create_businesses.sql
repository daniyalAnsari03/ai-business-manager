-- Phase 2: business identity + ownership foundation.
-- One row per business; every future module (products, customers, orders,
-- inventory, sales, expenses, AI context) will reference this record so all
-- data stays isolated per business.

create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  business_type text not null,
  currency text not null default 'PKR',
  language text not null default 'en' check (language in ('en', 'ur')),
  phone text,
  address text,
  setup_completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint businesses_name_length check (char_length(btrim(name)) between 2 and 80),
  -- One business per owner account for now (future phases can relax this).
  constraint businesses_owner_id_key unique (owner_id)
);

comment on table public.businesses is
  'Business profile owned by exactly one authenticated user. Ownership is always derived from the server-side session, never from client input.';

create index businesses_owner_id_idx on public.businesses (owner_id);

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger businesses_set_updated_at
  before update on public.businesses
  for each row
  execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security — owners may only touch their own business.
-- Deliberately NO policy allows "any authenticated user" access, and no
-- DELETE policy exists yet (destructive actions come later behind explicit
-- confirmation flows).
-- ---------------------------------------------------------------------------

alter table public.businesses enable row level security;

create policy "Owners can view their own business"
  on public.businesses for select
  using (auth.uid() = owner_id);

create policy "Owners can create their own business"
  on public.businesses for insert
  with check (auth.uid() = owner_id and owner_id = auth.uid());

create policy "Owners can update their own business"
  on public.businesses for update
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);
