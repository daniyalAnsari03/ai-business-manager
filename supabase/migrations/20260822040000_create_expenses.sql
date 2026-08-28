-- Phase 6: expenses.
-- Simple, real expense records for a business. Private data — RLS below
-- restricts every path to the owning business.

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  title text not null,
  amount numeric(12, 2) not null,
  category text not null default 'other',
  expense_date date not null default current_date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint expenses_title_length check (char_length(btrim(title)) between 1 and 120),
  constraint expenses_amount_positive check (amount > 0),
  constraint expenses_amount_reasonable check (amount <= 99999999999.99),
  constraint expenses_category_allowed check (
    category in ('rent', 'utilities', 'salaries', 'marketing', 'supplies', 'transport', 'other')
  ),
  constraint expenses_notes_length check (notes is null or char_length(notes) <= 2000)
);

comment on table public.expenses is
  'Business expenses (rent, utilities, salaries...). Private per business; deletion requires explicit confirmation in the UI.';

create index expenses_business_id_idx on public.expenses (business_id);
create index expenses_business_date_idx on public.expenses (business_id, expense_date desc);
create index expenses_business_category_idx on public.expenses (business_id, category);

create trigger expenses_set_updated_at
  before update on public.expenses
  for each row
  execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security — ownership chain:
--   authenticated user -> owned business -> expense.business_id
-- No broad policies; the caller's business always comes from auth.uid().
-- ---------------------------------------------------------------------------

alter table public.expenses enable row level security;

create policy "Owners can view their business's expenses"
  on public.expenses for select
  using (
    exists (
      select 1 from public.businesses b
      where b.id = business_id and b.owner_id = (select auth.uid())
    )
  );

create policy "Owners can create expenses for their business"
  on public.expenses for insert
  with check (
    exists (
      select 1 from public.businesses b
      where b.id = business_id and b.owner_id = (select auth.uid())
    )
  );

create policy "Owners can update their business's expenses"
  on public.expenses for update
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

create policy "Owners can delete their business's expenses"
  on public.expenses for delete
  using (
    exists (
      select 1 from public.businesses b
      where b.id = business_id and b.owner_id = (select auth.uid())
    )
  );
