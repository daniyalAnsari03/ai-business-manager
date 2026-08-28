-- Phase 6: atomic relative stock adjustment for the Inventory module.
--
-- Plain read-then-write via PostgREST could race and silently lose updates.
-- This SECURITY INVOKER function applies the delta relative to the stored
-- value inside one statement-level transaction:
--   * verifies ownership from auth.uid() before touching anything;
--   * refuses removals below zero with a clear NOT_ENOUGH_STOCK signal;
--   * returns the updated product row so the caller never needs a second
--     round trip.

create or replace function public.adjust_product_stock(
  p_product_id uuid,
  p_delta integer
)
returns public.products
language plpgsql
security invoker
as $$
declare
  v_business_id uuid;
  v_product public.products%rowtype;
begin
  select b.id into v_business_id
  from public.businesses b
  where b.owner_id = (select auth.uid());
  if v_business_id is null then
    raise exception 'NO_BUSINESS';
  end if;

  select pr.* into v_product
  from public.products pr
  where pr.id = p_product_id and pr.business_id = v_business_id
  for update;
  if not found then
    raise exception 'PRODUCT_NOT_FOUND';
  end if;

  if p_delta < 0 and v_product.stock_quantity + p_delta < 0 then
    raise exception 'NOT_ENOUGH_STOCK';
  end if;

  update public.products
    set stock_quantity = stock_quantity + p_delta
    where id = v_product.id
    returning * into v_product;

  return v_product;
end;
$$;

revoke all on function public.adjust_product_stock(uuid, integer) from public, anon;
grant execute on function public.adjust_product_stock(uuid, integer) to authenticated;
