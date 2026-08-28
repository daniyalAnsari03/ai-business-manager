-- docs/fix.txt — order status consistency (financial data, high priority).
--
-- Root cause of the ORD-000011 contradiction:
--   * create_business_order HARD-CODED status='pending' on insert, so an order
--     could never be recorded as completed in one step. When a user said
--     "complete Osama ka order", the agent had to create (pending) and then run
--     a second update_order_status call; if the model skipped that second call
--     (or set it to a no-op), the real row stayed 'pending' while the reply text
--     falsely claimed "complete".
--   * the create_order tool ALSO returned no status, so the model had no
--     authoritative value to read and could fabricate completion.
--
-- This migration lets create_business_order create an order as 'pending'
-- (default, unchanged behaviour) OR 'completed' atomically, applying the same
-- idempotent stock handling (verify -> deduct -> stock_applied_at) that
-- update_order_status uses. Inventory is verified BEFORE any row is committed so
-- an insufficiency returns a clean INSUFFICIENT_STOCK error without leaving a
-- stray order behind.

create or replace function public.create_business_order(p_payload jsonb)
returns jsonb
language plpgsql
security invoker
as $$
declare
  v_business_id uuid;
  v_customer_id uuid;
  v_status text;
  v_discount numeric(12, 2);
  v_notes text;
  v_ordered_at timestamptz;
  v_item jsonb;
  v_product public.products%rowtype;
  v_quantity integer;
  v_line_total numeric(12, 2);
  v_subtotal numeric(12, 2) := 0;
  v_item_count integer := 0;
  v_order_id uuid;
  v_available integer;
begin
  select b.id into v_business_id
  from public.businesses b
  where b.owner_id = (select auth.uid());
  if v_business_id is null then
    return jsonb_build_object('ok', false, 'error', 'NO_BUSINESS');
  end if;

  -- Optional explicit creation status. Defaults to 'pending' (prior behaviour);
  -- only 'pending' and 'completed' are meaningful at creation time.
  v_status := lower(coalesce(nullif(btrim(coalesce(p_payload->>'status', '')), ''), 'pending'));
  if v_status not in ('pending', 'completed') then
    return jsonb_build_object('ok', false, 'error', 'INVALID_STATUS');
  end if;

  begin
    -- Optional customer: must already belong to this business.
    if p_payload ? 'customerId' and p_payload->>'customerId' is not null
       and btrim(p_payload->>'customerId') <> '' then
      select c.id into v_customer_id
      from public.customers c
      where c.id = (p_payload->>'customerId')::uuid
        and c.business_id = v_business_id;
      if v_customer_id is null then
        return jsonb_build_object('ok', false, 'error', 'CUSTOMER_INVALID');
      end if;
    end if;

    v_notes := nullif(btrim(coalesce(p_payload->>'notes', '')), '');
    if v_notes is not null and char_length(v_notes) > 2000 then
      return jsonb_build_object('ok', false, 'error', 'INVALID_INPUT');
    end if;

    if p_payload ? 'orderedAt' and btrim(coalesce(p_payload->>'orderedAt', '')) <> '' then
      v_ordered_at := (p_payload->>'orderedAt')::timestamptz;
    else
      v_ordered_at := now();
    end if;

    if not jsonb_typeof(p_payload->'items') = 'array'
       or jsonb_array_length(p_payload->'items') = 0 then
      return jsonb_build_object('ok', false, 'error', 'ITEMS_EMPTY');
    end if;
    if jsonb_array_length(p_payload->'items') > 50 then
      return jsonb_build_object('ok', false, 'error', 'ITEMS_TOO_MANY');
    end if;

    -- First pass: authoritative pricing straight from the products table.
    for v_item in select * from jsonb_array_elements(p_payload->'items') loop
      if coalesce(jsonb_typeof(v_item->'quantity'), 'null') <> 'number' then
        return jsonb_build_object('ok', false, 'error', 'INVALID_INPUT');
      end if;
      v_quantity := (v_item->>'quantity');
      if v_quantity <= 0 or v_quantity > 100000 then
        return jsonb_build_object('ok', false, 'error', 'INVALID_QUANTITY');
      end if;

      select p.* into v_product
      from public.products p
      where p.id = (v_item->>'productId')::uuid
        and p.business_id = v_business_id
        and p.is_active = true;
      if not found then
        return jsonb_build_object('ok', false, 'error', 'PRODUCT_NOT_FOUND');
      end if;

      v_line_total := round(v_product.price * v_quantity, 2);
      v_subtotal := v_subtotal + v_line_total;
      v_item_count := v_item_count + 1;
    end loop;

    v_discount := coalesce((p_payload->>'discount')::numeric, 0);
    if v_discount < 0 or v_discount > v_subtotal then
      return jsonb_build_object('ok', false, 'error', 'DISCOUNT_INVALID');
    end if;

    -- Completing at creation time requires inventory. Lock + verify BEFORE any
    -- row is inserted so an insufficiency returns cleanly and commits nothing.
    if v_status = 'completed' then
      for v_item in select * from jsonb_array_elements(p_payload->'items') loop
        select pr.stock_quantity into v_available
        from public.products pr
        where pr.id = (v_item->>'productId')::uuid
          and pr.business_id = v_business_id
          and pr.is_active = true
        for update;
        if found and v_available < ((v_item->>'quantity')::integer) then
          return jsonb_build_object('ok', false, 'error', 'INSUFFICIENT_STOCK');
        end if;
      end loop;
    end if;

    -- Second pass: insert header + snapshot line items atomically.
    insert into public.orders (
      business_id, customer_id, status, subtotal, discount, total,
      notes, ordered_at
    ) values (
      v_business_id, v_customer_id, v_status,
      round(v_subtotal, 2), round(v_discount, 2), round(v_subtotal - v_discount, 2),
      v_notes, v_ordered_at
    )
    returning id into v_order_id;

    for v_item in select * from jsonb_array_elements(p_payload->'items') loop
      select p.* into v_product
      from public.products p
      where p.id = (v_item->>'productId')::uuid
        and p.business_id = v_business_id
        and p.is_active = true;

      v_quantity := (v_item->>'quantity');
      v_line_total := round(v_product.price * v_quantity, 2);

      insert into public.order_items (
        order_id, business_id, product_id, product_name, unit_price,
        quantity, line_total
      ) values (
        v_order_id, v_business_id, v_product.id, v_product.name,
        v_product.price, v_quantity, v_line_total
      );
    end loop;

    -- Completed at creation: deduct stock exactly once (rows already locked
    -- above), mirroring update_order_status' idempotent bookkeeping.
    if v_status = 'completed' then
      for v_item in
        select oi.product_id, oi.quantity
        from public.order_items oi
        where oi.order_id = v_order_id and oi.product_id is not null
        order by oi.id
      loop
        update public.products
          set stock_quantity = stock_quantity - v_item.quantity
          where id = v_item.product_id;
      end loop;
      update public.orders
        set stock_applied_at = now()
        where id = v_order_id;
    end if;

    return jsonb_build_object(
      'ok', true,
      'order', (select to_jsonb(o.*) from public.orders o where o.id = v_order_id),
      'items', coalesce((
        select jsonb_agg(to_jsonb(oi.*))
        from public.order_items oi
        where oi.order_id = v_order_id
      ), '[]'::jsonb)
    );
  exception
    when others then
      -- Anything raised above rolls back the whole attempt (header included).
      return jsonb_build_object('ok', false, 'error', 'DATABASE_ERROR');
  end;
end;
$$;

revoke all on function public.create_business_order(jsonb) from public, anon;
grant execute on function public.create_business_order(jsonb) to authenticated;
