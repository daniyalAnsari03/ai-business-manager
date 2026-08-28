-- Phase 6: orders + order_items.
--
-- Structure (AGENTS.md §6 of prompt 6):
--   Order -> Order Items -> Products (existing products table is reused;
--   no duplicate product storage).
--
-- Data-integrity strategy:
--   * Money columns are numeric(12,2). The database enforces
--     total = subtotal - discount and line_total = unit_price * quantity,
--     so totals can never drift from their parts (server-side calculations).
--   * Item lines snapshot product_name / unit_price at sale time, so later
--     price edits or archived products never corrupt historical records.
--   * stock_applied_at marks whether completion-time stock deduction has run.
--     It makes deduction idempotent: changing a status repeatedly can never
--     deduct twice, and leaving "completed" restores what was deducted.
--   * Deleting a completed order is refused by the database function —
--     historical financial information stays intact; cancellations are the
--     supported path instead.
--   * Creation and status changes run inside SECURITY INVOKER functions that
--     verify ownership from auth.uid() themselves, giving atomic multi-row
--     writes that plain PostgREST calls cannot guarantee.

create sequence public.orders_order_number_seq start 1;

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  customer_id uuid references public.customers (id) on delete set null,
  order_number text not null default
    ('ORD-' || lpad(nextval('public.orders_order_number_seq')::text, 6, '0')),
  status text not null default 'pending',
  subtotal numeric(12, 2) not null default 0,
  discount numeric(12, 2) not null default 0,
  total numeric(12, 2) not null,
  notes text,
  ordered_at timestamptz not null default now(),
  stock_applied_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint orders_status_allowed check (
    status in ('pending', 'confirmed', 'processing', 'completed', 'cancelled')
  ),
  constraint orders_subtotal_non_negative check (subtotal >= 0),
  constraint orders_discount_non_negative check (discount >= 0),
  -- Discount may never exceed the order value.
  constraint orders_discount_limited check (discount <= subtotal),
  -- Authoritative money identity maintained by the database itself.
  constraint orders_total_identity check (total = subtotal - discount),
  constraint orders_notes_length check (notes is null or char_length(notes) <= 2000),
  -- Referenced by order_items' composite FK below (see comment there).
  constraint orders_business_pair_key unique (id, business_id),
  constraint orders_number_unique unique (order_number)
);

comment on table public.orders is
  'Orders owned by one business. Totals are database-enforced identities; stock_applied_at guards idempotent completion-time inventory deduction. Completed orders are financial records and cannot be hard-deleted.';

create index orders_business_id_idx on public.orders (business_id);
create index orders_business_ordered_idx on public.orders (business_id, ordered_at desc);
create index orders_business_status_idx on public.orders (business_id, status);
create index orders_customer_idx on public.orders (customer_id);

create trigger orders_set_updated_at
  before update on public.orders
  for each row
  execute function public.set_updated_at();

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  -- Denormalized owner column: keeps RLS cheap and indexes local per business.
  -- The composite FK guarantees (order_id, business_id) always describe the
  -- same real order, so an item can never be attached across businesses.
  business_id uuid not null references public.businesses (id) on delete cascade,
  product_id uuid references public.products (id) on delete set null,
  -- Sale-time snapshots keep history correct forever, independent of what
  -- later happens to the referenced product row.
  product_name text not null,
  unit_price numeric(12, 2) not null,
  quantity integer not null,
  line_total numeric(12, 2) not null,

  constraint order_items_product_name_length
    check (char_length(btrim(product_name)) between 1 and 120),
  constraint order_items_unit_price_non_negative check (unit_price >= 0),
  constraint order_items_quantity_positive check (quantity > 0),
  constraint order_items_line_total_identity
    check (line_total = unit_price * quantity)
);

comment on table public.order_items is
  'Line items of one order. Product name/price are sale-time snapshots; the composite FK to orders(id, business_id) enforces same-business attachment.';

create index order_items_order_idx on public.order_items (order_id);
create index order_items_business_idx on public.order_items (business_id);
create index order_items_product_idx on public.order_items (product_id);

-- ---------------------------------------------------------------------------
-- Row Level Security — ownership chain:
--   authenticated user -> owned business -> order.business_id / item.business_id
-- Deliberately NO broad policies and no USING (true).
-- ---------------------------------------------------------------------------

alter table public.orders enable row level security;

create policy "Owners can view their business's orders"
  on public.orders for select
  using (
    exists (
      select 1 from public.businesses b
      where b.id = business_id and b.owner_id = (select auth.uid())
    )
  );

create policy "Owners can create orders for their business"
  on public.orders for insert
  with check (
    exists (
      select 1 from public.businesses b
      where b.id = business_id and b.owner_id = (select auth.uid())
    )
  );

create policy "Owners can update their business's orders"
  on public.orders for update
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

alter table public.order_items enable row level security;

create policy "Owners can view their business's order items"
  on public.order_items for select
  using (
    exists (
      select 1 from public.businesses b
      where b.id = business_id and b.owner_id = (select auth.uid())
    )
  );

create policy "Owners can create order items for their business"
  on public.order_items for insert
  with check (
    exists (
      select 1 from public.businesses b
      where b.id = business_id and b.owner_id = (select auth.uid())
    )
  );

create policy "Owners can update their business's order items"
  on public.order_items for update
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

-- ---------------------------------------------------------------------------
-- Atomic business operations (SECURITY INVOKER — table RLS still applies on
-- top of the explicit auth.uid() checks; every statement touches only fixed
-- logic, never dynamic SQL supplied by clients or models).
-- ---------------------------------------------------------------------------

-- Creates an order with its items atomically. Prices/names always come from
-- the live products table — client-supplied prices are never trusted.
-- Payload shape (already validated by the service layer):
--   {
--     customerId?: string | null,
--     discount?: number,
--     notes?: string | null,
--     orderedAt?: string (ISO timestamp),
--     items: [{ productId: string, quantity: number }, ...]
--   }
-- Returns: { ok: true, order: {...}, items: [...] } or { ok: false, error }.
create or replace function public.create_business_order(p_payload jsonb)
returns jsonb
language plpgsql
security invoker
as $$
declare
  v_business_id uuid;
  v_customer_id uuid;
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
begin
  select b.id into v_business_id
  from public.businesses b
  where b.owner_id = (select auth.uid());
  if v_business_id is null then
    return jsonb_build_object('ok', false, 'error', 'NO_BUSINESS');
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

    -- Second pass: insert header + snapshot line items atomically.
    insert into public.orders (
      business_id, customer_id, status, subtotal, discount, total,
      notes, ordered_at
    ) values (
      v_business_id, v_customer_id, 'pending',
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

-- Updates an order's status and handles the inventory side effects
-- atomically (prompt STEP 13):
--   * entering "completed" deducts item quantities once (guarded by
--     stock_applied_at — repeated status changes never deduct twice);
--   * leaving "completed" restores exactly what was deducted;
--   * insufficient stock refuses the transition without any partial change.
create or replace function public.update_order_status(p_order_id uuid, p_status text)
returns jsonb
language plpgsql
security invoker
as $$
declare
  v_business_id uuid;
  v_order public.orders%rowtype;
  v_item record;
  v_available integer;
begin
  if p_status not in ('pending', 'confirmed', 'processing', 'completed', 'cancelled') then
    return jsonb_build_object('ok', false, 'error', 'INVALID_STATUS');
  end if;

  select b.id into v_business_id
  from public.businesses b
  where b.owner_id = (select auth.uid());
  if v_business_id is null then
    return jsonb_build_object('ok', false, 'error', 'NO_BUSINESS');
  end if;

  begin
    select o.* into v_order
    from public.orders o
    where o.id = p_order_id and o.business_id = v_business_id
    for update;
    if not found then
      return jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
    end if;

    if v_order.status <> 'completed' and p_status = 'completed' then
      if v_order.stock_applied_at is null then
        -- Pass 1: lock every involved product row and verify availability
        -- up front. Locks are held until commit, so nothing can change
        -- between verification and deduction.
        for v_item in
          select oi.product_id, oi.quantity
          from public.order_items oi
          where oi.order_id = v_order.id and oi.product_id is not null
          order by oi.id
        loop
          select pr.stock_quantity into v_available
          from public.products pr
          where pr.id = v_item.product_id and pr.business_id = v_business_id
          for update;
          if found and v_available < v_item.quantity then
            return jsonb_build_object('ok', false, 'error', 'INSUFFICIENT_STOCK');
          end if;
        end loop;

        -- Pass 2: deduct. Safe — every row is locked and verified above.
        for v_item in
          select oi.product_id, oi.quantity
          from public.order_items oi
          where oi.order_id = v_order.id and oi.product_id is not null
          order by oi.id
        loop
          update public.products
            set stock_quantity = stock_quantity - v_item.quantity
            where id = v_item.product_id;
        end loop;
        update public.orders
          set stock_applied_at = now()
          where id = v_order.id;
      end if;
    elsif v_order.status = 'completed' and p_status <> 'completed' then
      if v_order.stock_applied_at is not null then
        for v_item in
          select oi.product_id, oi.quantity
          from public.order_items oi
          where oi.order_id = v_order.id and oi.product_id is not null
          order by oi.id
        loop
          update public.products
            set stock_quantity = stock_quantity + v_item.quantity
            where id = v_item.product_id and business_id = v_business_id;
        end loop;
        update public.orders
          set stock_applied_at = null
          where id = v_order.id;
      end if;
    end if;

    if v_order.status = p_status then
      -- No-op request: report success without touching anything.
      return jsonb_build_object(
        'ok', true,
        'order', (select to_jsonb(o.*) from public.orders o where o.id = v_order.id)
      );
    end if;

    update public.orders
      set status = p_status
      where id = v_order.id;

    return jsonb_build_object(
      'ok', true,
      'order', (select to_jsonb(o.*) from public.orders o where o.id = v_order.id)
    );
  exception
    when others then
      return jsonb_build_object('ok', false, 'error', 'DATABASE_ERROR');
  end;
end;
$$;

-- Hard-deletes an order — allowed ONLY for orders that were never completed,
-- so historical financial records stay protected (prompt STEP 9). Any stock
-- effect is defensively restored first; items disappear via cascade.
create or replace function public.delete_business_order(p_order_id uuid)
returns jsonb
language plpgsql
security invoker
as $$
declare
  v_business_id uuid;
  v_order public.orders%rowtype;
  v_item record;
begin
  select b.id into v_business_id
  from public.businesses b
  where b.owner_id = (select auth.uid());
  if v_business_id is null then
    return jsonb_build_object('ok', false, 'error', 'NO_BUSINESS');
  end if;

  begin
    select o.* into v_order
    from public.orders o
    where o.id = p_order_id and o.business_id = v_business_id
    for update;
    if not found then
      return jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
    end if;

    if v_order.status = 'completed' then
      return jsonb_build_object('ok', false, 'error', 'DELETE_NOT_ALLOWED');
    end if;

    -- Defensive: should not exist for non-completed orders, but never leave
    -- inventory inconsistent behind a deletion.
    if v_order.stock_applied_at is not null then
      for v_item in
        select oi.product_id, oi.quantity
        from public.order_items oi
        where oi.order_id = v_order.id and oi.product_id is not null
        order by oi.id
      loop
        update public.products
          set stock_quantity = stock_quantity + v_item.quantity
          where id = v_item.product_id and business_id = v_business_id;
      end loop;
    end if;

    delete from public.orders where id = v_order.id;

    return jsonb_build_object('ok', true);
  exception
    when others then
      return jsonb_build_object('ok', false, 'error', 'DATABASE_ERROR');
  end;
end;
$$;

-- Functions are callable only by the signed-in application roles.
revoke all on function public.create_business_order(jsonb) from public, anon;
revoke all on function public.update_order_status(uuid, text) from public, anon;
revoke all on function public.delete_business_order(uuid) from public, anon;
grant execute on function public.create_business_order(jsonb) to authenticated;
grant execute on function public.update_order_status(uuid, text) to authenticated;
grant execute on function public.delete_business_order(uuid) to authenticated;
