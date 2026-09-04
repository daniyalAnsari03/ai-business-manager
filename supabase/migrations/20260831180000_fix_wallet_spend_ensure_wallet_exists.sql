-- Fix: process_wallet_spend must ensure the marketing_wallet row exists
-- before attempting the SELECT FOR UPDATE, matching the pattern already
-- used by create_pending_topup and process_wallet_topup.
--
-- Root cause of the test-spend UI error: a new business that has never
-- topped up has no marketing_wallet row, so the spend RPC raised
-- "Wallet not found" and the UI showed a generic failure message.

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
