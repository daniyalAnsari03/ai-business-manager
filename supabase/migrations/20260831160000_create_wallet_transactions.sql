-- AI Marketing Manager — Phase 3 (test mode): wallet transaction ledger.
--
-- Every change to marketing_wallet.balance must be accompanied by a row
-- here — the balance number alone is not a sufficient audit trail.
-- Ownership is derived from the authenticated session (same as all other
-- marketing tables); RLS below is the second enforcement boundary.

-- ---------------------------------------------------------------------------
-- wallet_transactions — immutable append-only ledger for wallet balance
-- changes. type discriminates topup / spend / adjustment. status tracks
-- the lifecycle of each entry (pending → completed | failed).
-- ---------------------------------------------------------------------------

create table public.wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  type text not null,
  amount numeric(12, 2) not null,
  balance_after numeric(12, 2) not null,
  gateway_reference text,
  description text,
  status text not null default 'pending',
  created_at timestamptz not null default now(),

  constraint wallet_transactions_type_allowed check (
    type in ('topup', 'spend', 'adjustment')
  ),
  constraint wallet_transactions_amount_positive check (amount > 0),
  constraint wallet_transactions_balance_non_negative check (balance_after >= 0),
  constraint wallet_transactions_status_allowed check (
    status in ('pending', 'completed', 'failed')
  )
);

comment on table public.wallet_transactions is
  'Append-only ledger for marketing wallet balance changes. Every balance mutation in marketing_wallet must have a corresponding row here.';

create index wallet_transactions_business_id_idx
  on public.wallet_transactions (business_id);

create index wallet_transactions_business_created_idx
  on public.wallet_transactions (business_id, created_at desc);

create index wallet_transactions_business_status_idx
  on public.wallet_transactions (business_id, status);

-- ---------------------------------------------------------------------------
-- RPC: atomically complete a wallet top-up.
-- Creates the wallet row if missing, increases balance, inserts a completed
-- ledger row — all in one database transaction.
-- ---------------------------------------------------------------------------

create or replace function public.process_wallet_topup(
  p_business_id uuid,
  p_amount numeric,
  p_gateway_reference text default null,
  p_description text default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wallet_id uuid;
  v_new_balance numeric;
  v_tx_id uuid;
begin
  if p_amount <= 0 then
    raise exception 'Amount must be positive';
  end if;

  -- Upsert wallet row, returning its id and new balance.
  insert into public.marketing_wallet (business_id, balance)
  values (p_business_id, p_amount)
  on conflict (business_id) do update
    set balance = marketing_wallet.balance + p_amount,
        updated_at = now()
  returning id, balance into v_wallet_id, v_new_balance;

  -- Insert the ledger row.
  insert into public.wallet_transactions (
    business_id, type, amount, balance_after, gateway_reference, description, status
  ) values (
    p_business_id, 'topup', p_amount, v_new_balance,
    p_gateway_reference, p_description, 'completed'
  ) returning id into v_tx_id;

  return json_build_object(
    'wallet_id', v_wallet_id,
    'transaction_id', v_tx_id,
    'new_balance', v_new_balance
  );
end;
$$;

comment on function public.process_wallet_topup is
  'Atomically increases wallet balance and inserts a completed topup ledger row. Used by payment provider callbacks.';

-- ---------------------------------------------------------------------------
-- RPC: atomically process a wallet spend (deduction).
-- Decreases balance, inserts a spend ledger row — fails if insufficient
-- funds, all in one database transaction.
-- ---------------------------------------------------------------------------

create or replace function public.process_wallet_spend(
  p_business_id uuid,
  p_amount numeric,
  p_description text default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wallet_id uuid;
  v_current_balance numeric;
  v_new_balance numeric;
  v_tx_id uuid;
begin
  if p_amount <= 0 then
    raise exception 'Amount must be positive';
  end if;

  -- Lock the wallet row for update to prevent race conditions.
  select id, balance into v_wallet_id, v_current_balance
  from public.marketing_wallet
  where business_id = p_business_id
  for update;

  if v_wallet_id is null then
    raise exception 'Wallet not found for this business';
  end if;

  if v_current_balance < p_amount then
    raise exception 'Insufficient wallet balance';
  end if;

  v_new_balance := v_current_balance - p_amount;

  update public.marketing_wallet
  set balance = v_new_balance, updated_at = now()
  where id = v_wallet_id;

  insert into public.wallet_transactions (
    business_id, type, amount, balance_after, description, status
  ) values (
    p_business_id, 'spend', p_amount, v_new_balance, p_description, 'completed'
  ) returning id into v_tx_id;

  return json_build_object(
    'wallet_id', v_wallet_id,
    'transaction_id', v_tx_id,
    'new_balance', v_new_balance
  );
end;
$$;

comment on function public.process_wallet_spend is
  'Atomically decreases wallet balance and inserts a completed spend ledger row. Fails on insufficient funds. Used by test-spend tool and future ad spend deduction.';

-- ---------------------------------------------------------------------------
-- RPC: create a pending topup row (for redirect-based payment flows).
-- The wallet row is created if missing. The transaction stays pending
-- until the payment provider confirms via process_wallet_topup.
-- ---------------------------------------------------------------------------

create or replace function public.create_pending_topup(
  p_business_id uuid,
  p_amount numeric,
  p_description text default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wallet_id uuid;
  v_tx_id uuid;
begin
  if p_amount <= 0 then
    raise exception 'Amount must be positive';
  end if;

  -- Ensure wallet row exists (balance stays unchanged).
  insert into public.marketing_wallet (business_id, balance)
  values (p_business_id, 0)
  on conflict (business_id) do nothing
  returning id into v_wallet_id;

  -- If upsert returned nothing, fetch the existing id.
  if v_wallet_id is null then
    select id into v_wallet_id
    from public.marketing_wallet
    where business_id = p_business_id;
  end if;

  insert into public.wallet_transactions (
    business_id, type, amount, balance_after, description, status
  ) values (
    p_business_id, 'topup', p_amount, 0, p_description, 'pending'
  ) returning id into v_tx_id;

  return json_build_object(
    'wallet_id', v_wallet_id,
    'transaction_id', v_tx_id
  );
end;
$$;

comment on function public.create_pending_topup is
  'Creates a pending topup ledger row without changing the balance. Used when initiating a payment flow (e.g. redirect to payment provider).';

-- ---------------------------------------------------------------------------
-- RPC: fail a pending topup (e.g. payment declined or cancelled).
-- ---------------------------------------------------------------------------

create or replace function public.fail_pending_topup(
  p_transaction_id uuid,
  p_business_id uuid
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tx_status text;
begin
  select status into v_tx_status
  from public.wallet_transactions
  where id = p_transaction_id and business_id = p_business_id;

  if v_tx_status is null then
    raise exception 'Transaction not found';
  end if;

  if v_tx_status != 'pending' then
    raise exception 'Only pending transactions can be failed';
  end if;

  update public.wallet_transactions
  set status = 'failed'
  where id = p_transaction_id;

  return json_build_object('ok', true);
end;
$$;

comment on function public.fail_pending_topup is
  'Marks a pending topup transaction as failed. Does not affect wallet balance.';

-- ---------------------------------------------------------------------------
-- Row Level Security — identical ownership pattern to all other marketing
-- tables: authenticated user → owned business → row.business_id.
-- ---------------------------------------------------------------------------

alter table public.wallet_transactions enable row level security;

create policy "Owners can view their business's wallet transactions"
  on public.wallet_transactions for select
  using (
    exists (
      select 1 from public.businesses b
      where b.id = business_id and b.owner_id = (select auth.uid())
    )
  );

create policy "Owners can create wallet transactions for their business"
  on public.wallet_transactions for insert
  with check (
    exists (
      select 1 from public.businesses b
      where b.id = business_id and b.owner_id = (select auth.uid())
    )
  );

create policy "Owners can update their business's wallet transactions"
  on public.wallet_transactions for update
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

create policy "Owners can delete their business's wallet transactions"
  on public.wallet_transactions for delete
  using (
    exists (
      select 1 from public.businesses b
      where b.id = business_id and b.owner_id = (select auth.uid())
    )
  );
