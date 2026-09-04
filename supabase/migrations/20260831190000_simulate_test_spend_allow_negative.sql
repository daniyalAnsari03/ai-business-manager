-- Revert the previous allow-negative migration and fix simulate_test_spend
-- to enforce the same insufficient-balance guard as process_wallet_spend.
--
-- The wallet must NEVER allow a negative balance, even in testing.
-- The test-spend tool should only simulate spending money that actually
-- exists in the wallet. If the balance is insufficient, the RPC must
-- reject the spend with "Insufficient wallet balance".

-- Re-add the non-negative CHECK constraints in an idempotent way.
-- PostgreSQL does not support ADD CONSTRAINT IF NOT EXISTS, so we
-- check pg_constraint first and only add the constraint when missing.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'marketing_wallet_balance_non_negative'
      and conrelid = 'public.marketing_wallet'::regclass
  ) then
    alter table public.marketing_wallet
      add constraint marketing_wallet_balance_non_negative
      check (balance >= 0);
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'wallet_transactions_balance_non_negative'
      and conrelid = 'public.wallet_transactions'::regclass
  ) then
    alter table public.wallet_transactions
      add constraint wallet_transactions_balance_non_negative
      check (balance_after >= 0);
  end if;
end
$$;

-- Replace the simulate_test_spend function so it rejects insufficient
-- balance like the real process_wallet_spend does.
create or replace function public.simulate_test_spend(
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

  -- Ensure wallet row exists (balance stays unchanged).
  insert into public.marketing_wallet (business_id, balance)
  values (p_business_id, 0)
  on conflict (business_id) do nothing;

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

comment on function public.simulate_test_spend is
  'Test-only simulated ad spend that enforces the same insufficient-balance guard as process_wallet_spend. REMOVE when real ad spend exists.';
