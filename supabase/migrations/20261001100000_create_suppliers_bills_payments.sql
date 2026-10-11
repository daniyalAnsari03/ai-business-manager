-- Suppliers, supplier bills and the append-only payments ledger.
-- (docs/fix.txt — File 3 | Phase 3 | Prompt 2.)
--
-- WHAT THIS FILLS IN
-- --------------------
-- The product can already record a sale (orders) and a cost (expenses), but it
-- cannot answer the two questions every owner actually asks:
--   1. "Isay kis ne abhi tak paisa nahi diya?"  (customer owes us)
--   2. "Mere supplier ko abhi kitna dena hai?"  (we owe the supplier)
-- This migration adds the missing ledger so "owed" is a real database fact and
-- not a number typed into a note.
--
--   suppliers       who we buy from
--   supplier_bills  what one supplier billed us (amount-only for now)
--   payments        ONE append-only ledger for both sides of the money:
--                   direction 'in'  = customer money received against an order
--                   direction 'out' = supplier money paid against a bill
--   orders.opening_paid
--                   the debt a pre-existing order already carried, frozen at
--                   migration time (see the backfill further down)
--
-- OWNER DECISIONS (locked, not open for reinterpretation here)
-- ------------------------------------------------------------
--   * supplier credit IS tracked (suppliers + supplier_bills + payments);
--   * existing orders are treated as fully PAID — debt only starts from new
--     orders, hence orders.opening_paid backfilled to `total`;
--   * a customer payment ALWAYS links to an order (no unlinked cash in v1);
--   * overpayment is BLOCKED;
--   * payments are never updated or deleted — a mistake is fixed with a
--     reversal row, so money history can always be re-derived;
--   * supplier bills are amount-only for now (no link to stock);
--   * methods: cash, bank, easypaisa, jazzcash, cheque, other.
--
-- DESIGN RULES THAT MATTER
-- -------------------------
--   * Money is numeric(12,2) everywhere, matching products/orders.
--   * CUSTOMER-side paid/due is NEVER stored. It is always derived from the
--     payments ledger inside the same transaction that writes a payment
--     (total - opening_paid - net payments). A stored customer balance would
--     be a second source of truth that can silently disagree with the ledger.
--   * SUPPLIER-side paid_amount/due_amount/status ARE stored, because that is
--     the single authoritative statement of the bill and it is rewritten in the
--     exact same transaction as the payment row. They are database identities
--     (total = subtotal - discount, due_amount = total - paid_amount) so they
--     cannot drift even if a function were wrong.
--   * business_id is NEVER taken from a client payload. Authenticated entry
--     points resolve it from auth.uid() through public.businesses.owner_id;
--     the only functions that accept a business_id parameter are the two
--     INTERNAL ones that are not executable by authenticated at all.
--   * Every write path locks the target row `for update` BEFORE re-deriving the
--     due, so two concurrent payments can never both see the same "due" and
--     together overpay.
--   * Idempotency: every payment carries (business_id, idempotency_key) unique.
--     A retry with the same key returns the row that already exists instead of
--     paying twice; the same key with a different target or amount is refused
--     with IDEMPOTENCY_CONFLICT rather than silently doing something else.
--
-- SECURITY INVOKER vs SECURITY DEFINER (please read, this is deliberate)
-- ---------------------------------------------------------------------
-- This phase deliberately gives supplier_bills and payments SELECT-only RLS
-- policies and NO write policies, so all money writes must go through
-- functions. A SECURITY INVOKER function runs as the calling role and would
-- therefore be denied its own INSERT (no write policy). Every function that
-- writes therefore runs SECURITY DEFINER as the migration owner, and:
--   * pins `set search_path = public, pg_temp` so no caller-controlled schema
--     can shadow a table or operator;
--   * re-checks ownership itself (auth.uid() -> businesses.owner_id, or an
--     explicit business_id parameter that is verified against the locked row),
--     so bypassing RLS does not bypass authorisation;
--   * is granted EXECUTE only to the role that is allowed to call it.
-- Read-only helpers stay SECURITY INVOKER on purpose, so RLS applies to them
-- exactly as it would to a direct PostgREST query.

-- ===========================================================================
-- SECTION 1 — orders.opening_paid (+ the one-time backfill)
-- ===========================================================================
--
-- "Existing orders are treated as fully paid; debt only starts from new
--  orders." That is expressed as opening_paid: money already received against
-- an order BEFORE this ledger existed. It is stored on the order (it is a
-- historical fact about that order, not a running balance) and it is frozen —
-- no function may ever change it.
--
-- Pre-flight check performed before writing this migration:
--   * the ONLY trigger on public.orders is `orders_set_updated_at`
--     (20260822020000_create_orders.sql), a BEFORE UPDATE trigger that
--     unconditionally sets new.updated_at = now(). It performs no business
--     logic, recalculates nothing, emits nothing, and cannot fail.
--   * there is NO trigger, NO rule and NO generated column on public.orders
--     anywhere in supabase/migrations that fires on UPDATE, so the backfill
--     below cannot trip an inventory deduction, a status transition or any
--     other side effect.
--   * create_business_order (as last redefined in
--     20260828120000_fix_create_order_completed_branch.sql) inserts an explicit
--     column list that does not mention opening_paid, so new orders keep the
--     default 0 and the function keeps working unchanged.
-- Consequence that is accepted on purpose: because set_updated_at fires on the
-- backfill, updated_at of pre-existing orders is refreshed to the migration
-- timestamp. updated_at is a "last touched" bookkeeping column, not a business
-- fact, and no status/total/stock column is affected. The trigger is NOT
-- disabled: a missing trigger name would abort the whole migration, and
-- keeping it enabled is the safer failure mode.

alter table public.orders
  add column opening_paid numeric(12, 2) not null default 0;

-- Same shape as the other money columns on orders: never negative, never more
-- than the order is worth.
alter table public.orders
  add constraint orders_opening_paid_valid check (
    opening_paid >= 0 and opening_paid <= total
  );

comment on column public.orders.opening_paid is
  'Money already received against this order before the payments ledger existed. Frozen history: set once (0 for new orders, total for orders that existed on 2026-10-01) and never modified by any function. Customer paid/due = total - opening_paid - net payments.';

-- ONE-TIME BACKFILL (part of this migration, run exactly once).
-- Every order that existed before this ledger is treated as fully paid, so its
-- opening debt equals its total. New rows inserted later are unaffected: the
-- default is 0.
update public.orders
  set opening_paid = total;

-- ---------------------------------------------------------------------------
-- opening_paid guards (created AFTER backfill so the backfill does not trip them).
-- ---------------------------------------------------------------------------
create or replace function public.guard_orders_opening_paid_update()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  raise exception
    'orders.opening_paid is frozen history and cannot be changed.'
    using errcode = 'restrict_violation';
end;
$$;

create trigger orders_opening_paid_guard_update
  before update on public.orders
  for each row
  when (old.opening_paid is distinct from new.opening_paid)
  execute function public.guard_orders_opening_paid_update();

create or replace function public.guard_orders_opening_paid_insert()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if new.opening_paid <> 0 then
    raise exception
      'orders.opening_paid must be 0 for new orders (default applies).'
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

create trigger orders_opening_paid_guard_insert
  before insert on public.orders
  for each row
  execute function public.guard_orders_opening_paid_insert();

-- create_business_order (from 20260828120000_fix_create_order_completed_branch.sql)
-- inserts: business_id, customer_id, order_number, status, total, subtotal,
-- discount, items, notes, ordered_at — no opening_paid, so the default 0 is used.
-- The insert trigger therefore allows create_business_order to keep working.

-- ===========================================================================
-- SECTION 2 — suppliers
-- ===========================================================================
-- Mirrors customers on purpose: same ownership chain, same length limits. It
-- is stricter in exactly one place, and deliberately so: a supplier who has
-- billed us can no longer be deleted at all (see the composite FK below).

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  name text not null,
  phone text,
  email text,
  address text,
  -- free text on purpose ("14 din", "cash on delivery"): an enum would lock the
  -- owner out of a perfectly normal term.
  payment_terms text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint suppliers_name_length check (char_length(btrim(name)) between 1 and 120),
  constraint suppliers_phone_length check (phone is null or char_length(btrim(phone)) <= 30),
  constraint suppliers_email_length check (email is null or char_length(btrim(email)) <= 200),
  constraint suppliers_address_length check (address is null or char_length(address) <= 500),
  constraint suppliers_payment_terms_length check (
    payment_terms is null or char_length(payment_terms) <= 200
  ),
  constraint suppliers_notes_length check (notes is null or char_length(notes) <= 2000),
  -- Target of the composite FK on supplier_bills: guarantees a bill can never
  -- reference a supplier from another business.
  constraint suppliers_business_pair_key unique (id, business_id)
);

comment on table public.suppliers is
  'Suppliers a business buys from. Private business data, owner-scoped via RLS. Deleting a supplier that still has bills is refused by the database (ON DELETE RESTRICT).';

-- A supplier name is the owner's only handle on a supplier ("Ali Cloth House"),
-- so it must be unique per business — case- and whitespace-insensitively, so
-- "ali cloth" and "  Ali Cloth " cannot both exist.
create unique index suppliers_business_name_key
  on public.suppliers (business_id, lower(btrim(name)));

create index suppliers_business_id_idx on public.suppliers (business_id);
create index suppliers_business_name_idx on public.suppliers (business_id, name);
create index suppliers_business_phone_idx on public.suppliers (business_id, phone);

create trigger suppliers_set_updated_at
  before update on public.suppliers
  for each row
  execute function public.set_updated_at();

-- ===========================================================================
-- SECTION 3 — supplier_bills
-- ===========================================================================
-- Amount-only for now (owner decision): a bill records what a supplier charged
-- us. It is deliberately NOT connected to products/stock, because guessing how
-- a supplier bill splits across stock lines would be fabricated data.

create table public.supplier_bills (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  supplier_id uuid not null,
  -- The SUPPLIER's own bill number, free text, usually null. Not generated by
  -- us: inventing a number the supplier never sent would be a lie in the books.
  bill_number text,
  bill_date date not null default current_date,
  due_date date,
  subtotal numeric(12, 2) not null default 0,
  discount numeric(12, 2) not null default 0,
  total numeric(12, 2) not null,
  paid_amount numeric(12, 2) not null default 0,
  due_amount numeric(12, 2) not null,
  status text not null default 'unpaid',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- RESTRICT, not CASCADE: a supplier with bills can never be deleted, so
  -- money history is never silently erased by removing a contact.
  constraint supplier_bills_supplier_fk
    foreign key (supplier_id, business_id)
    references public.suppliers (id, business_id)
    on delete restrict,

  -- Mirrors the orders money rules exactly, so both sides of the business read
  -- the same way.
  constraint supplier_bills_subtotal_non_negative check (subtotal >= 0),
  constraint supplier_bills_discount_non_negative check (discount >= 0),
  constraint supplier_bills_discount_limited check (discount <= subtotal),
  constraint supplier_bills_total_identity check (total = subtotal - discount),
  constraint supplier_bills_total_positive check (total > 0),
  constraint supplier_bills_paid_non_negative check (paid_amount >= 0),
  constraint supplier_bills_paid_limited check (paid_amount <= total),
  constraint supplier_bills_due_identity check (due_amount = total - paid_amount),
  constraint supplier_bills_due_date_after_bill_date check (
    due_date is null or due_date >= bill_date
  ),
  constraint supplier_bills_status_allowed check (
    status in ('unpaid', 'partial', 'paid')
  ),
  -- Status is DERIVED, never independently chosen. Because total > 0 is
  -- enforced above, this is a complete and unambiguous partition:
  --   paid_amount = 0            -> 'unpaid' (nothing paid yet)
  --   0 < paid_amount < total    -> 'partial'
  --   paid_amount = total        -> 'paid'      (and due_amount is then 0)
  -- A bill can therefore never claim to be unpaid while due_amount is 0, which
  -- is exactly the "receivables screen disagrees with reality" bug.
  constraint supplier_bills_status_consistent check (
    status = case
      when paid_amount = total then 'paid'
      when paid_amount > 0 then 'partial'
      else 'unpaid'
    end
  ),
  constraint supplier_bills_notes_length check (notes is null or char_length(notes) <= 2000),
  constraint supplier_bills_business_pair_key unique (id, business_id)
);

comment on table public.supplier_bills is
  'One supplier invoice for one business (amount only; not linked to stock). total/due_amount/status are database identities maintained inside the same transaction as every payment, so they can never drift from the payments ledger.';

-- The bill number is the only free-form text on a bill, so its limit is added
-- here rather than inline above, next to the amount identities it has nothing
-- to do with.
alter table public.supplier_bills
  add constraint supplier_bills_bill_number_length check (
    bill_number is null or char_length(btrim(bill_number)) between 1 and 60
  );

-- The supplier's own number identifies the bill within that supplier. NULL
-- numbers (the common case) must not collide with each other, hence the partial
-- index instead of a table-level UNIQUE.
create unique index supplier_bills_business_supplier_number_key
  on public.supplier_bills (business_id, supplier_id, bill_number)
  where bill_number is not null;

create index supplier_bills_business_id_idx on public.supplier_bills (business_id);
create index supplier_bills_business_supplier_idx
  on public.supplier_bills (business_id, supplier_id, bill_date desc);
create index supplier_bills_business_status_idx on public.supplier_bills (business_id, status);
create index supplier_bills_business_bill_date_idx
  on public.supplier_bills (business_id, bill_date desc);

create trigger supplier_bills_set_updated_at
  before update on public.supplier_bills
  for each row
  execute function public.set_updated_at();

-- ===========================================================================
-- SECTION 4 — payments (append-only ledger for BOTH sides of the money)
-- ===========================================================================
-- One table, not two, so "all money movements" is one query and one
-- audit trail. `direction` says whose pocket it is:
--   'in'  -> customer paid us (linked to an order)
--   'out' -> we paid the supplier (linked to a supplier bill)
--
-- Append-only means: no status, no updated_at, no running balance, and NO way
-- to rewrite or remove a row (see the trigger at the end of this section).

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  kind text not null default 'payment',
  direction text not null,
  order_id uuid,
  supplier_bill_id uuid,
  -- The payment this row undoes. Non-null exactly when kind = 'reversal'.
  reversal_of uuid,
  amount numeric(12, 2) not null,
  method text not null,
  paid_at timestamptz not null default now(),
  -- Cheque number / bank transaction id / wallet reference — whatever the owner
  -- can find later to prove the money moved.
  reference text,
  notes text,
  -- Caller-supplied de-duplication key (one per real-world action, e.g. the
  -- WhatsApp message id that triggered the payment). NOT NULL: a payment that
  -- cannot be de-duplicated is a payment that can happen twice.
  idempotency_key text not null,
  -- The acting owner. Recorded verbatim with NO foreign key: this column is
  -- evidence, not a relationship, and a money row must never be rejected or
  -- cascaded away because an auth.users row disappeared (the table is
  -- append-only, so ON DELETE SET NULL is impossible anyway).
  created_by uuid not null,
  created_at timestamptz not null default now(),

  constraint payments_kind_allowed check (kind in ('payment', 'reversal')),
  constraint payments_direction_allowed check (direction in ('in', 'out')),

  -- Exactly one target, always. There is no "unlinked cash" in v1.
  constraint payments_single_target check (
    num_nonnulls(order_id, supplier_bill_id) = 1
  ),
  -- 'in' is customer money and therefore belongs to an order; 'out' is supplier
  -- money and therefore belongs to a bill. Stated explicitly so an 'in' row can
  -- never be pointed at a bill even by a buggy caller.
  constraint payments_direction_matches_target check (
    (direction = 'in' and order_id is not null and supplier_bill_id is null)
    or (direction = 'out' and supplier_bill_id is not null and order_id is null)
  ),
  constraint payments_amount_positive check (amount > 0),
  constraint payments_method_allowed check (
    method in ('cash', 'bank', 'easypaisa', 'jazzcash', 'cheque', 'other')
  ),
  constraint payments_reference_length check (reference is null or char_length(reference) <= 200),
  constraint payments_notes_length check (notes is null or char_length(notes) <= 1000),
  constraint payments_idempotency_key_length check (
    char_length(btrim(idempotency_key)) between 1 and 160
  ),
  -- A reversal always points at exactly one original; a plain payment never
  -- does. This is what makes "reversal_of is not null iff kind = 'reversal'"
  -- impossible to violate.
  constraint payments_reversal_kind_match check (
    (reversal_of is null) = (kind = 'payment')
  ),

  -- Composite FKs (with business_id) are the cross-business tripwire: they make
  -- it impossible for one business's payment to point at another business's
  -- order or bill, even for the service role writing with RLS off.
  constraint payments_order_fk
    foreign key (order_id, business_id)
    references public.orders (id, business_id)
    on delete restrict,
  constraint payments_supplier_bill_fk
    foreign key (supplier_bill_id, business_id)
    references public.supplier_bills (id, business_id)
    on delete restrict,
  constraint payments_reversal_fk
    foreign key (reversal_of, business_id)
    references public.payments (id, business_id)
    on delete restrict,

  constraint payments_business_pair_key unique (id, business_id),
  constraint payments_business_idempotency_key_key unique (business_id, idempotency_key)
);

comment on table public.payments is
  'Append-only money ledger. direction ''in'' = customer money received against an order, ''out'' = supplier money paid against a bill. Rows are never updated or deleted (blocked by trigger); a mistake is corrected with a kind=''reversal'' row. Customer paid/due is always recomputed from this table, never stored.';

create index payments_business_id_idx on public.payments (business_id);
create index payments_business_order_idx on public.payments (business_id, order_id);
create index payments_business_supplier_bill_idx
  on public.payments (business_id, supplier_bill_id);
create index payments_business_created_idx on public.payments (business_id, created_at desc);

-- One payment can be reversed at most once, forever. This is the database's
-- answer to "can I reverse the same receipt twice?" — no.
create unique index payments_reversal_of_key
  on public.payments (reversal_of)
  where reversal_of is not null;

-- ---------------------------------------------------------------------------
-- Append-only enforcement.
--
-- RLS already stops every user from writing payments at all, and the role
-- grants below give authenticated no INSERT/UPDATE/DELETE either. This trigger
-- closes the last hole: the service role (and any future table owner running
-- raw SQL) physically cannot UPDATE or DELETE a money row. The only legal
-- correction is inserting a reversal row.
--
-- Note the accepted side effect: because business_id is ON DELETE CASCADE, this
-- trigger also makes deleting a business (or its auth.users row) fail while it
-- still has payments. That is intended — deleting a business with money history
-- must be a deliberate, separate migration, not a cascade.
-- ---------------------------------------------------------------------------

create or replace function public.block_payment_mutation()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  raise exception
    'public.payments is append-only: % is forbidden. Insert a reversal row instead.',
    tg_op
    using errcode = 'restrict_violation';
end;
$$;

comment on function public.block_payment_mutation() is
  'Trigger function that refuses UPDATE and DELETE on public.payments for every role, including service_role. Money history is corrected by inserting a reversal, never by rewriting a row.';

create trigger payments_append_only
  before update or delete on public.payments
  for each row
  execute function public.block_payment_mutation();

-- ---------------------------------------------------------------------------
-- Append-only enforcement: also block TRUNCATE.
-- service_role has no TRUNCATE grant on public.payments, so this is defence in depth.
-- ---------------------------------------------------------------------------
create or replace function public.block_payment_truncate()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  raise exception
    'public.payments is append-only: TRUNCATE is forbidden. Insert a reversal row instead.'
    using errcode = 'restrict_violation';
end;
$$;

create trigger payments_block_truncate
  before truncate on public.payments
  for each statement
  execute function public.block_payment_truncate();

-- ===========================================================================
-- SECTION 5 — Row Level Security
-- ===========================================================================
-- Ownership chain, identical to every other table in this project:
--   authenticated user -> owned business -> row.business_id
-- No USING (true), no "any authenticated user" policy, and business_id is
-- always the row's own column resolved against businesses.owner_id.
--
-- suppliers     full owner CRUD (a supplier is contact data, like a customer)
-- supplier_bills SELECT only  -> writes happen in create/update/delete_
--                                supplier_bill, never through PostgREST
-- payments      SELECT only  -> writes happen in record_payment /
--                                record_payment_for_business only
--
-- RLS policies are not role-scoped: they apply to every role holding a
-- matching table GRANT. service_role bypasses RLS entirely, which is exactly
-- why the money functions do their own explicit ownership checks.

alter table public.suppliers enable row level security;

create policy "Owners can view their business's suppliers"
  on public.suppliers for select
  using (
    exists (
      select 1 from public.businesses b
      where b.id = business_id and b.owner_id = (select auth.uid())
    )
  );

create policy "Owners can create suppliers for their business"
  on public.suppliers for insert
  with check (
    exists (
      select 1 from public.businesses b
      where b.id = business_id and b.owner_id = (select auth.uid())
    )
  );

create policy "Owners can update their business's suppliers"
  on public.suppliers for update
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

-- The delete policy lets an owner remove a supplier, but if that supplier has
-- any bill the composite FK (ON DELETE RESTRICT) refuses the statement with
-- SQLSTATE 23503. The app must map 23503 to a friendly message such as
-- "This supplier has bills, so they cannot be deleted" and offer to cancel /
-- settle them first. (A future `is_active` flag is the cleaner long-term
-- answer; it is deliberately NOT added here.)
create policy "Owners can delete their business's suppliers"
  on public.suppliers for delete
  using (
    exists (
      select 1 from public.businesses b
      where b.id = business_id and b.owner_id = (select auth.uid())
    )
  );

alter table public.supplier_bills enable row level security;

create policy "Owners can view their business's supplier bills"
  on public.supplier_bills for select
  using (
    exists (
      select 1 from public.businesses b
      where b.id = business_id and b.owner_id = (select auth.uid())
    )
  );

-- NOTE: deliberately no INSERT / UPDATE / DELETE policy. Bills are money; they
-- are written only by create_supplier_bill / update_supplier_bill /
-- delete_supplier_bill, which lock the row and validate the amounts.

alter table public.payments enable row level security;

create policy "Owners can view their business's payments"
  on public.payments for select
  using (
    exists (
      select 1 from public.businesses b
      where b.id = business_id and b.owner_id = (select auth.uid())
    )
  );

-- NOTE: deliberately no INSERT / UPDATE / DELETE policy. Payments are an
-- append-only money ledger written only by record_payment /
-- record_payment_for_business / reverse_payment /
-- reverse_payment_for_business, each with an idempotency key.

-- ===========================================================================
-- SECTION 6 — Table grants
-- ===========================================================================
-- Postgres checks table privileges BEFORE RLS, so the GRANTs are the real
-- enforcement boundary for writes. Everything is revoked first (including from
-- PUBLIC, in case this project has default-privilege setup) and then only the
-- minimum is handed back.

revoke all on public.suppliers from public, anon, authenticated;
grant select, insert, update, delete on public.suppliers to authenticated;
grant select, insert, update, delete on public.suppliers to service_role;

revoke all on public.supplier_bills from public, anon, authenticated;
grant select on public.supplier_bills to authenticated;
grant select, insert, update, delete on public.supplier_bills to service_role;

revoke all on public.payments from public, anon, authenticated;
grant select on public.payments to authenticated;
grant select, insert, update, delete on public.payments to service_role;

-- No sequences are created in this migration: every id is
-- gen_random_uuid(), so no USAGE grants are required.

-- ===========================================================================
-- SECTION 7 — Functions
-- ===========================================================================
-- Shared conventions:
--   * every function returns jsonb: { ok: true, ... } or
--     { ok: false, error: '<CODE>' } — codes are structured strings so the
--     service layer and the agent can localise them instead of guessing;
--   * a broad `when others` returns { ok:false, error:'DATABASE_ERROR' } so a
--     raw constraint name or SQL fragment never reaches the UI;
--   * no function ever runs SQL supplied by a caller: there is no EXECUTE
--     anywhere in this migration, only fixed logic.
--
-- Error codes used below:
--   NO_BUSINESS                  caller owns no business / bad business_id
--   NOT_FOUND                    target row does not exist for this business
--   TARGET_REQUIRED              neither orderId nor supplierBillId given
--   TARGET_AMBIGUOUS             both orderId and supplierBillId given
--   ORDER_INVALID / BILL_INVALID  uuid text is not a uuid
--   INVALID_AMOUNT               missing, non-numeric, <= 0, or out of range
--   INVALID_METHOD               method outside the six allowed values
--   INVALID_REFERENCE            reference longer than 200 characters
--   INVALID_NOTES                notes longer than 1000 characters
--   INVALID_REASON               reversal reason missing or longer than 500
--   IDEMPOTENCY_KEY_REQUIRED     idempotency key missing/blank/too long
--   IDEMPOTENCY_CONFLICT         key reused for a different target or amount
--   ORDER_CANCELLED              cannot collect money for a cancelled order
--   NO_DUE                       nothing left to pay / nothing left to reverse
--   OVERPAYMENT                  amount is larger than the remaining due
--   HAS_PAYMENTS                 bill has payment rows; settle or reverse first
--   BILL_TOTAL_INVALID           total would be <= 0
--   BILL_BELOW_PAID              new total is below money already paid
--   BILL_PAID_NOT_EDITABLE       payload tried to set paid_amount
--   BILL_NUMBER_INVALID          bill number empty or too long
--   BILL_DATE_INVALID            bill date missing/unparsable/after due date
--   NOT_REVERSIBLE               target is itself a reversal
--   ALREADY_REVERSED             the original payment was already reversed
--   NEGATIVE_PAID                reversal would push net paid below zero
--   ACTOR_REQUIRED               internal call without an acting owner
--   DATABASE_ERROR               anything unexpected (see note above)

-- ---------------------------------------------------------------------------
-- 7A. create_supplier_bill(p_payload jsonb)
-- Creates a bill with paid_amount 0, due_amount = total, status 'unpaid'.
-- The owner cannot hand a partially-paid bill into existence, because there
-- would be no ledger row to justify the paid part.
--
-- Payload: { supplierId, subtotal, discount?, billNumber?, billDate?, dueDate?, notes? }
-- SECURITY DEFINER because supplier_bills has no INSERT policy; ownership is
-- still resolved from auth.uid() and the supplier is verified against it.
-- ---------------------------------------------------------------------------
create or replace function public.create_supplier_bill(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_business_id uuid;
  v_supplier_id uuid;
  v_bill_number text;
  v_bill_date date;
  v_due_date date;
  v_subtotal numeric(12, 2);
  v_discount numeric(12, 2);
  v_total numeric(12, 2);
  v_notes text;
  v_bill_id uuid;
begin
  -- business_id comes from the session, never from the payload.
  select b.id into v_business_id
  from public.businesses b
  where b.owner_id = (select auth.uid());
  if v_business_id is null then
    return jsonb_build_object('ok', false, 'error', 'NO_BUSINESS');
  end if;

  begin
    if coalesce(jsonb_typeof(p_payload->'supplierId'), 'null') <> 'string' then
      return jsonb_build_object('ok', false, 'error', 'SUPPLIER_REQUIRED');
    end if;
    if (p_payload->>'supplierId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      return jsonb_build_object('ok', false, 'error', 'SUPPLIER_INVALID');
    end if;
    select s.id into v_supplier_id
    from public.suppliers s
    where s.id = (p_payload->>'supplierId')::uuid
      and s.business_id = v_business_id;
    if v_supplier_id is null then
      return jsonb_build_object('ok', false, 'error', 'SUPPLIER_NOT_FOUND');
    end if;

    if coalesce(jsonb_typeof(p_payload->'subtotal'), 'null') <> 'number' then
      return jsonb_build_object('ok', false, 'error', 'INVALID_AMOUNT');
    end if;
    v_subtotal := round((p_payload->>'subtotal')::numeric, 2);
    v_discount := round(coalesce((p_payload->>'discount')::numeric, 0), 2);
    if v_subtotal is null or v_subtotal < 0 or v_subtotal > 9999999999.99
       or v_discount < 0 or v_discount > v_subtotal then
      return jsonb_build_object('ok', false, 'error', 'INVALID_AMOUNT');
    end if;
    v_total := round(v_subtotal - v_discount, 2);
    if v_total <= 0 then
      return jsonb_build_object('ok', false, 'error', 'BILL_TOTAL_INVALID');
    end if;

    v_bill_number := nullif(btrim(coalesce(p_payload->>'billNumber', '')), '');
    if v_bill_number is not null and char_length(v_bill_number) > 60 then
      return jsonb_build_object('ok', false, 'error', 'BILL_NUMBER_INVALID');
    end if;

    v_bill_date := coalesce(
      nullif(btrim(coalesce(p_payload->>'billDate', '')), '')::date,
      current_date
    );
    if coalesce(jsonb_typeof(p_payload->'dueDate'), 'null') = 'string'
       and btrim(p_payload->>'dueDate') <> '' then
      v_due_date := (p_payload->>'dueDate')::date;
    end if;
    if v_due_date is not null and v_due_date < v_bill_date then
      return jsonb_build_object('ok', false, 'error', 'BILL_DATE_INVALID');
    end if;

    v_notes := nullif(btrim(coalesce(p_payload->>'notes', '')), '');
    if v_notes is not null and char_length(v_notes) > 2000 then
      return jsonb_build_object('ok', false, 'error', 'INVALID_NOTES');
    end if;

    insert into public.supplier_bills (
      business_id, supplier_id, bill_number, bill_date, due_date,
      subtotal, discount, total, paid_amount, due_amount, status, notes
    ) values (
      v_business_id, v_supplier_id, v_bill_number, v_bill_date, v_due_date,
      v_subtotal, v_discount, v_total, 0, v_total, 'unpaid', v_notes
    )
    returning id into v_bill_id;

    return jsonb_build_object(
      'ok', true,
      'bill', (select to_jsonb(sb.*) from public.supplier_bills sb where sb.id = v_bill_id)
    );
  exception
    when others then
      return jsonb_build_object('ok', false, 'error', 'DATABASE_ERROR');
  end;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7B. update_supplier_bill(p_bill_id uuid, p_payload jsonb)
-- Lock the bill, then allow ONLY: notes, bill_number, bill_date, due_date and
-- subtotal/discount. Amounts may only move while the new total stays at or
-- above the money already paid (BILL_BELOW_PAID) — a bill cannot be edited
-- into a state that contradicts the payments already recorded against it.
-- paid_amount / due_amount / status are recomputed here and are NEVER read from
-- the payload: a payload that tries is rejected, not silently ignored, so the
-- caller can never believe it edited money it did not.
-- ---------------------------------------------------------------------------
create or replace function public.update_supplier_bill(p_bill_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_business_id uuid;
  v_bill public.supplier_bills%rowtype;
  v_subtotal numeric(12, 2);
  v_discount numeric(12, 2);
  v_total numeric(12, 2);
  v_due numeric(12, 2);
  v_bill_number text;
  v_bill_date date;
  v_due_date date;
  v_notes text;
  v_status text;
begin
  select b.id into v_business_id
  from public.businesses b
  where b.owner_id = (select auth.uid());
  if v_business_id is null then
    return jsonb_build_object('ok', false, 'error', 'NO_BUSINESS');
  end if;

  begin
    -- Lock first: everything below reads this row's paid_amount.
    select sb.* into v_bill
    from public.supplier_bills sb
    where sb.id = p_bill_id and sb.business_id = v_business_id
    for update;
    if not found then
      return jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
    end if;

    -- The ledger owns these three. Refuse the attempt loudly.
    if p_payload ? 'paidAmount' or p_payload ? 'paid_amount'
       or p_payload ? 'dueAmount' or p_payload ? 'due_amount'
       or p_payload ? 'status' then
      return jsonb_build_object('ok', false, 'error', 'BILL_PAID_NOT_EDITABLE');
    end if;

    v_subtotal := v_bill.subtotal;
    v_discount := v_bill.discount;
    if p_payload ? 'subtotal' then
      if coalesce(jsonb_typeof(p_payload->'subtotal'), 'null') <> 'number' then
        return jsonb_build_object('ok', false, 'error', 'INVALID_AMOUNT');
      end if;
      v_subtotal := round((p_payload->>'subtotal')::numeric, 2);
    end if;
    if p_payload ? 'discount' then
      if coalesce(jsonb_typeof(p_payload->'discount'), 'null') <> 'number' then
        return jsonb_build_object('ok', false, 'error', 'INVALID_AMOUNT');
      end if;
      v_discount := round((p_payload->>'discount')::numeric, 2);
    end if;
    if v_subtotal < 0 or v_subtotal > 9999999999.99
       or v_discount < 0 or v_discount > v_subtotal then
      return jsonb_build_object('ok', false, 'error', 'INVALID_AMOUNT');
    end if;
    v_total := round(v_subtotal - v_discount, 2);
    if v_total <= 0 then
      return jsonb_build_object('ok', false, 'error', 'BILL_TOTAL_INVALID');
    end if;
    -- The edit may never invalidate money that has already been paid.
    if v_total < v_bill.paid_amount then
      return jsonb_build_object('ok', false, 'error', 'BILL_BELOW_PAID');
    end if;

    v_bill_number := v_bill.bill_number;
    if p_payload ? 'billNumber' then
      v_bill_number := nullif(btrim(coalesce(p_payload->>'billNumber', '')), '');
      if v_bill_number is not null and char_length(v_bill_number) > 60 then
        return jsonb_build_object('ok', false, 'error', 'BILL_NUMBER_INVALID');
      end if;
    end if;

    v_bill_date := v_bill.bill_date;
    if coalesce(jsonb_typeof(p_payload->'billDate'), 'null') = 'string'
       and btrim(p_payload->>'billDate') <> '' then
      v_bill_date := (p_payload->>'billDate')::date;
    end if;

    v_due_date := v_bill.due_date;
    if p_payload ? 'dueDate' then
      if coalesce(jsonb_typeof(p_payload->'dueDate'), 'null') = 'string'
         and btrim(p_payload->>'dueDate') <> '' then
        v_due_date := (p_payload->>'dueDate')::date;
      else
        v_due_date := null;
      end if;
    end if;
    if v_due_date is not null and v_due_date < v_bill_date then
      return jsonb_build_object('ok', false, 'error', 'BILL_DATE_INVALID');
    end if;

    v_notes := v_bill.notes;
    if p_payload ? 'notes' then
      v_notes := nullif(btrim(coalesce(p_payload->>'notes', '')), '');
      if v_notes is not null and char_length(v_notes) > 2000 then
        return jsonb_build_object('ok', false, 'error', 'INVALID_NOTES');
      end if;
    end if;

    v_due := round(v_total - v_bill.paid_amount, 2);
    v_status := case
      when v_bill.paid_amount = v_total then 'paid'
      when v_bill.paid_amount > 0 then 'partial'
      else 'unpaid'
    end;

    update public.supplier_bills
      set bill_number = v_bill_number,
          bill_date = v_bill_date,
          due_date = v_due_date,
          subtotal = v_subtotal,
          discount = v_discount,
          total = v_total,
          due_amount = v_due,
          status = v_status,
          notes = v_notes
      where id = v_bill.id and business_id = v_business_id;

    return jsonb_build_object(
      'ok', true,
      'bill', (select to_jsonb(sb.*) from public.supplier_bills sb where sb.id = v_bill.id)
    );
  exception
    when others then
      return jsonb_build_object('ok', false, 'error', 'DATABASE_ERROR');
  end;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7C. delete_supplier_bill(p_bill_id uuid)
-- Allowed only while the bill has no payment rows (HAS_PAYMENTS otherwise).
-- A bill that has been paid against is financial history: the supported
-- correction is to settle/reverse the payments, not to delete the bill.
-- ---------------------------------------------------------------------------
create or replace function public.delete_supplier_bill(p_bill_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_business_id uuid;
  v_payment_count bigint;
begin
  select b.id into v_business_id
  from public.businesses b
  where b.owner_id = (select auth.uid());
  if v_business_id is null then
    return jsonb_build_object('ok', false, 'error', 'NO_BUSINESS');
  end if;

  begin
    perform 1 from public.supplier_bills sb
    where sb.id = p_bill_id and sb.business_id = v_business_id
    for update;
    if not found then
      return jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
    end if;

    select count(*) into v_payment_count
    from public.payments p
    where p.supplier_bill_id = p_bill_id;

    if v_payment_count > 0 then
      return jsonb_build_object('ok', false, 'error', 'HAS_PAYMENTS');
    end if;

    delete from public.supplier_bills
    where id = p_bill_id and business_id = v_business_id;

    return jsonb_build_object('ok', true, 'deleted', true);
  exception
    when others then
      return jsonb_build_object('ok', false, 'error', 'DATABASE_ERROR');
  end;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7D. record_payment_for_business(p_business_id uuid, p_actor uuid, p_payload jsonb)
-- INTERNAL. Not executable by authenticated/anon/public — only service_role,
-- because approved WhatsApp actions are executed by the server without a
-- browser session and must still be able to record money safely. The caller
-- supplies the business, so this function re-proves every claim itself:
--   * the business must exist;
--   * the locked target row must belong to that exact business;
--   * the due is re-derived INSIDE this transaction from the locked row, never
--     from anything the caller said.
--
-- Payload: { orderId | supplierBillId, amount, method, paidAt?, reference?, notes?, idempotencyKey }
--
-- The sequence matters and is the whole point of this function:
--   1. validate the payload shape (no row touched yet)
--   2. LOCK the target row (order or bill) `for update`
--   3. verify it belongs to p_business_id
--   4. derive net paid / due from the ledger
--   5. idempotency check (after the lock, so a concurrent duplicate serialises
--      here and replays instead of double-paying)
--   6. NO_DUE / OVERPAYMENT / ORDER_CANCELLED guards
--   7. insert the ledger row; for a bill, update paid_amount / due_amount /
--      status in the SAME transaction
-- ---------------------------------------------------------------------------
create or replace function public.record_payment_for_business(
  p_business_id uuid,
  p_actor uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order_id uuid;
  v_bill_id uuid;
  v_amount numeric(12, 2);
  v_method text;
  v_paid_at timestamptz;
  v_reference text;
  v_notes text;
  v_key text;
  v_order public.orders%rowtype;
  v_bill public.supplier_bills%rowtype;
  v_existing public.payments%rowtype;
  v_payment_id uuid;
  v_net_paid numeric(12, 2);
  v_paid_total numeric(12, 2);
  v_due numeric(12, 2);
  v_paid_amount numeric(12, 2);
  v_new_status text;
begin
  if p_business_id is null
     or not exists (select 1 from public.businesses b where b.id = p_business_id) then
    return jsonb_build_object('ok', false, 'error', 'NO_BUSINESS');
  end if;
  if p_actor is null then
    return jsonb_build_object('ok', false, 'error', 'ACTOR_REQUIRED');
  end if;

  begin
    -- (1) payload shape ---------------------------------------------------
    v_key := btrim(coalesce(p_payload->>'idempotencyKey', p_payload->>'idempotency_key', ''));
    if v_key = '' or char_length(v_key) > 160 then
      return jsonb_build_object('ok', false, 'error', 'IDEMPOTENCY_KEY_REQUIRED');
    end if;

    if coalesce(jsonb_typeof(p_payload->'orderId'), 'null') = 'string' then
      if (p_payload->>'orderId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        return jsonb_build_object('ok', false, 'error', 'ORDER_INVALID');
      end if;
      v_order_id := (p_payload->>'orderId')::uuid;
    end if;
    if coalesce(jsonb_typeof(p_payload->'supplierBillId'), 'null') = 'string' then
      if (p_payload->>'supplierBillId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        return jsonb_build_object('ok', false, 'error', 'BILL_INVALID');
      end if;
      v_bill_id := (p_payload->>'supplierBillId')::uuid;
    end if;
    if v_order_id is not null and v_bill_id is not null then
      return jsonb_build_object('ok', false, 'error', 'TARGET_AMBIGUOUS');
    end if;
    if v_order_id is null and v_bill_id is null then
      return jsonb_build_object('ok', false, 'error', 'TARGET_REQUIRED');
    end if;

    if coalesce(jsonb_typeof(p_payload->'amount'), 'null') <> 'number' then
      return jsonb_build_object('ok', false, 'error', 'INVALID_AMOUNT');
    end if;
    v_amount := round((p_payload->>'amount')::numeric, 2);
    if v_amount is null or v_amount <= 0 or v_amount > 9999999999.99 then
      return jsonb_build_object('ok', false, 'error', 'INVALID_AMOUNT');
    end if;

    v_method := lower(btrim(coalesce(p_payload->>'method', '')));
    if v_method not in ('cash', 'bank', 'easypaisa', 'jazzcash', 'cheque', 'other') then
      return jsonb_build_object('ok', false, 'error', 'INVALID_METHOD');
    end if;

    if coalesce(jsonb_typeof(p_payload->'paidAt'), 'null') = 'string'
       and btrim(p_payload->>'paidAt') <> '' then
      v_paid_at := (p_payload->>'paidAt')::timestamptz;
    else
      v_paid_at := now();
    end if;

    v_reference := nullif(btrim(coalesce(p_payload->>'reference', '')), '');
    if v_reference is not null and char_length(v_reference) > 200 then
      return jsonb_build_object('ok', false, 'error', 'INVALID_REFERENCE');
    end if;
    v_notes := nullif(btrim(coalesce(p_payload->>'notes', '')), '');
    if v_notes is not null and char_length(v_notes) > 1000 then
      return jsonb_build_object('ok', false, 'error', 'INVALID_NOTES');
    end if;

-- (2-4) customer side: customer money received against an order -------
    if v_order_id is not null then
      select o.* into v_order
      from public.orders o
      where o.id = v_order_id and o.business_id = p_business_id
      for update;
      if not found then
        return jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
      end if;

      -- Customer paid/due is derived, never stored.
      select coalesce(
               round(sum(case when p.kind = 'payment' then p.amount else -p.amount end), 2),
               0
             )
         into v_net_paid
       from public.payments p
       where p.order_id = v_order.id;

      v_paid_total := round(v_order.opening_paid + v_net_paid, 2);
      v_due := round(v_order.total - v_paid_total, 2);

      -- (5) idempotency, re-checked while the order row is locked
      --     MUST run BEFORE any state-dependent rejection (ORDER_CANCELLED,
      --     NO_DUE, OVERPAYMENT) so a retry after a successful payment
      --     returns ok:true with idempotent_replay:true even if the order is
      --     now cancelled or fully paid.
      select p.* into v_existing
      from public.payments p
      where p.business_id = p_business_id and p.idempotency_key = v_key;
      if v_existing.id is not null then
        if v_existing.kind <> 'payment'
           or v_existing.order_id is distinct from v_order.id
           or v_existing.supplier_bill_id is not null
           or v_existing.amount is distinct from v_amount then
          return jsonb_build_object('ok', false, 'error', 'IDEMPOTENCY_CONFLICT');
        end if;
        return jsonb_build_object(
          'ok', true,
          'idempotent_replay', true,
          'payment', to_jsonb(v_existing),
          'orderId', v_order.id,
          'net_paid', v_net_paid,
          'paid', v_paid_total,
          'due', v_due
        );
      end if;

      -- (6) guards: no overpayment, ever
      if v_order.status = 'cancelled' then
        return jsonb_build_object('ok', false, 'error', 'ORDER_CANCELLED');
      end if;
      if v_due <= 0 then
        return jsonb_build_object('ok', false, 'error', 'NO_DUE');
      end if;
      if v_amount > v_due then
        return jsonb_build_object(
          'ok', false, 'error', 'OVERPAYMENT', 'due', v_due
        );
      end if;

      -- (7) append the ledger row. Nothing is stored on orders.
      --     Wrap the INSERT so a unique_violation on the
      --     (business_id, idempotency_key) constraint re-reads the existing
      --     row and returns the replay or IDEMPOTENCY_CONFLICT, never
      --     DATABASE_ERROR. Other unique violations (for example reversal_of)
      --     must still return their own clear errors (ALREADY_REVERSED).
      begin
        insert into public.payments (
          business_id, kind, direction, order_id, amount, method,
          paid_at, reference, notes, idempotency_key, created_by
        ) values (
          p_business_id, 'payment', 'in', v_order.id, v_amount, v_method,
          v_paid_at, v_reference, v_notes, v_key, p_actor
        )
        returning id into v_payment_id;
      exception
        when unique_violation then
          -- Re-read under the same lock to decide replay vs conflict.
          select p.* into v_existing
          from public.payments p
          where p.business_id = p_business_id and p.idempotency_key = v_key;
          if v_existing.id is not null then
            if v_existing.kind <> 'payment'
               or v_existing.order_id is distinct from v_order.id
               or v_existing.supplier_bill_id is not null
               or v_existing.amount is distinct from v_amount then
              return jsonb_build_object('ok', false, 'error', 'IDEMPOTENCY_CONFLICT');
            end if;
            return jsonb_build_object(
              'ok', true,
              'idempotent_replay', true,
              'payment', to_jsonb(v_existing),
              'orderId', v_order.id,
              'net_paid', v_net_paid,
              'paid', v_paid_total,
              'due', v_due
            );
          end if;
          -- Fallback (should not happen): some other unique constraint fired.
          return jsonb_build_object('ok', false, 'error', 'DATABASE_ERROR');
      end;

      return jsonb_build_object(
        'ok', true,
        'idempotent_replay', false,
        'payment', (select to_jsonb(p.*) from public.payments p where p.id = v_payment_id),
        'orderId', v_order.id,
        'net_paid', round(v_net_paid + v_amount, 2),
        'paid', round(v_paid_total + v_amount, 2),
        'due', round(v_due - v_amount, 2)
      );
    end if;

    -- (2-4) supplier side: money paid to a supplier ----------------------
    select sb.* into v_bill
    from public.supplier_bills sb
    where sb.id = v_bill_id and sb.business_id = p_business_id
    for update;
    if not found then
      return jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
    end if;
    v_due := v_bill.due_amount;

    -- (5) idempotency, re-checked while the bill row is locked
    --     MUST run BEFORE any state-dependent rejection (NO_DUE, OVERPAYMENT)
    --     so a retry after a successful payment returns ok:true with
    --     idempotent_replay:true even if the bill is now fully paid.
    select p.* into v_existing
    from public.payments p
    where p.business_id = p_business_id and p.idempotency_key = v_key;
    if v_existing.id is not null then
      if v_existing.kind <> 'payment'
         or v_existing.supplier_bill_id is distinct from v_bill.id
         or v_existing.order_id is not null
         or v_existing.amount is distinct from v_amount then
        return jsonb_build_object('ok', false, 'error', 'IDEMPOTENCY_CONFLICT');
      end if;
      return jsonb_build_object(
        'ok', true,
        'idempotent_replay', true,
        'payment', to_jsonb(v_existing),
        'supplierBillId', v_bill.id,
        'paidAmount', v_bill.paid_amount,
        'due', v_bill.due_amount
      );
    end if;

    -- (6) guards
    if v_due <= 0 then
      return jsonb_build_object('ok', false, 'error', 'NO_DUE');
    end if;
    if v_amount > v_due then
      return jsonb_build_object('ok', false, 'error', 'OVERPAYMENT', 'due', v_due);
    end if;

    -- (7) append the ledger row and move the bill in the same transaction.
    --     Wrap the INSERT so a unique_violation on the
    --     (business_id, idempotency_key) constraint re-reads the existing
    --     row and returns the replay or IDEMPOTENCY_CONFLICT, never
    --     DATABASE_ERROR. Other unique violations (for example reversal_of)
    --     must still return their own clear errors (ALREADY_REVERSED).
    begin
      insert into public.payments (
        business_id, kind, direction, supplier_bill_id, amount, method,
        paid_at, reference, notes, idempotency_key, created_by
      ) values (
        p_business_id, 'payment', 'out', v_bill.id, v_amount, v_method,
        v_paid_at, v_reference, v_notes, v_key, p_actor
      )
      returning id into v_payment_id;
    exception
      when unique_violation then
        -- Re-read under the same lock to decide replay vs conflict.
        select p.* into v_existing
        from public.payments p
        where p.business_id = p_business_id and p.idempotency_key = v_key;
        if v_existing.id is not null then
          if v_existing.kind <> 'payment'
             or v_existing.supplier_bill_id is distinct from v_bill.id
             or v_existing.order_id is not null
             or v_existing.amount is distinct from v_amount then
            return jsonb_build_object('ok', false, 'error', 'IDEMPOTENCY_CONFLICT');
          end if;
          return jsonb_build_object(
            'ok', true,
            'idempotent_replay', true,
            'payment', to_jsonb(v_existing),
            'supplierBillId', v_bill.id,
            'paidAmount', v_bill.paid_amount,
            'due', v_bill.due_amount
          );
        end if;
        -- Fallback (should not happen): some other unique constraint fired.
        return jsonb_build_object('ok', false, 'error', 'DATABASE_ERROR');
    end;

    v_paid_amount := round(v_bill.paid_amount + v_amount, 2);
    -- Defensive: the constraint paid_amount <= total already guarantees this,
    -- but re-asserting it here means a future looser constraint cannot push a
    -- bill into an impossible state.
    if v_paid_amount > v_bill.total then
      return jsonb_build_object('ok', false, 'error', 'OVERPAYMENT', 'due', v_due);
    end if;
    v_new_status := case
      when v_paid_amount = v_bill.total then 'paid'
      when v_paid_amount > 0 then 'partial'
      else 'unpaid'
    end;

    update public.supplier_bills
      set paid_amount = v_paid_amount,
          due_amount = round(v_bill.total - v_paid_amount, 2),
          status = v_new_status
      where id = v_bill.id and business_id = p_business_id;

    return jsonb_build_object(
      'ok', true,
      'idempotent_replay', false,
      'payment', (select to_jsonb(p.*) from public.payments p where p.id = v_payment_id),
      'supplierBillId', v_bill.id,
      'paidAmount', v_paid_amount,
      'due', round(v_bill.total - v_paid_amount, 2)
    );
  exception
    when others then
      return jsonb_build_object('ok', false, 'error', 'DATABASE_ERROR');
  end;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7E. record_payment(p_payload jsonb)
-- The authenticated entry point. It resolves business_id AND the actor from
-- auth.uid() and then delegates, so a browser caller physically cannot choose
-- which business it writes to: there is no business_id parameter here at all.
-- SECURITY DEFINER only so that it may call the service-role-only internal
-- function above (EXECUTE is checked per calling role).
-- ---------------------------------------------------------------------------
create or replace function public.record_payment(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_business_id uuid;
begin
  select b.id into v_business_id
  from public.businesses b
  where b.owner_id = (select auth.uid());
  if v_business_id is null then
    return jsonb_build_object('ok', false, 'error', 'NO_BUSINESS');
  end if;

  return public.record_payment_for_business(
    v_business_id,
    (select auth.uid()),
    p_payload
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 7F. reverse_payment_for_business(...)  +  reverse_payment(...)
-- Corrections are rows, never edits. The reversal mirrors the original
-- (same target, same amount, same method, same reference) with kind='reversal'
-- and reversal_of = the original id, and moves the bill back in the same
-- transaction.
--
-- The reversal edge (requirement H): a reversal may never push net paid below
-- zero (NEGATIVE_PAID) or above the target total (OVERPAYMENT). Both are
-- checked against the locked target, so the ledger cannot be driven into an
-- impossible state by reversing an order of payments.
-- ---------------------------------------------------------------------------
create or replace function public.reverse_payment_for_business(
  p_business_id uuid,
  p_actor uuid,
  p_payment_id uuid,
  p_reason text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_key text;
  v_reason text;
  v_original public.payments%rowtype;
  v_existing public.payments%rowtype;
  v_order public.orders%rowtype;
  v_bill public.supplier_bills%rowtype;
  v_reversal_id uuid;
  v_net_paid numeric(12, 2);
  v_paid_total numeric(12, 2);
  v_due numeric(12, 2);
  v_paid_amount numeric(12, 2);
  v_new_status text;
begin
  if p_business_id is null
     or not exists (select 1 from public.businesses b where b.id = p_business_id) then
    return jsonb_build_object('ok', false, 'error', 'NO_BUSINESS');
  end if;
  if p_actor is null then
    return jsonb_build_object('ok', false, 'error', 'ACTOR_REQUIRED');
  end if;

  begin
    v_key := btrim(coalesce(p_idempotency_key, ''));
    if v_key = '' or char_length(v_key) > 160 then
      return jsonb_build_object('ok', false, 'error', 'IDEMPOTENCY_KEY_REQUIRED');
    end if;
    v_reason := nullif(btrim(coalesce(p_reason, '')), '');
    if v_reason is null or char_length(v_reason) > 500 then
      return jsonb_build_object('ok', false, 'error', 'INVALID_REASON');
    end if;

    -- Read the original first, only to learn which target row to lock.
    select p.* into v_original
    from public.payments p
    where p.id = p_payment_id and p.business_id = p_business_id;
    if not found then
      return jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
    end if;
    if v_original.kind = 'reversal' then
      -- Un-reversing is not a thing: reverse the reversal's target instead.
      return jsonb_build_object('ok', false, 'error', 'NOT_REVERSIBLE');
    end if;

    -- Lock the target row: this is what serialises two concurrent reversals of
    -- the same payment (the second one then sees ALREADY_REVERSED).
    if v_original.order_id is not null then
      select o.* into v_order
      from public.orders o
      where o.id = v_original.order_id and o.business_id = p_business_id
      for update;
      if not found then
        return jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
      end if;
    else
      select sb.* into v_bill
      from public.supplier_bills sb
      where sb.id = v_original.supplier_bill_id and sb.business_id = p_business_id
      for update;
      if not found then
        return jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
      end if;
    end if;

-- Re-read the original under that lock and re-validate everything.
    select p.* into v_original
    from public.payments p
    where p.id = p_payment_id and p.business_id = p_business_id
    for update;
    if v_original.kind = 'reversal' then
      return jsonb_build_object('ok', false, 'error', 'NOT_REVERSIBLE');
    end if;

    -- Idempotency, evaluated under the target lock so a retried reversal
    -- replays instead of inserting a second row.
    -- MUST run BEFORE any state-dependent rejection (ALREADY_REVERSED,
    -- NEGATIVE_PAID, OVERPAYMENT) so a retry after a successful reversal
    -- returns ok:true with idempotent_replay:true even if the target state
    -- has since changed.
    select p.* into v_existing
    from public.payments p
    where p.business_id = p_business_id and p.idempotency_key = v_key;
    if v_existing.id is not null then
      if v_existing.kind <> 'reversal'
         or v_existing.reversal_of is distinct from v_original.id
         or v_existing.amount is distinct from v_original.amount then
        return jsonb_build_object('ok', false, 'error', 'IDEMPOTENCY_CONFLICT');
      end if;
      return jsonb_build_object(
        'ok', true,
        'idempotent_replay', true,
        'payment', to_jsonb(v_existing),
        'reversedPaymentId', v_original.id
      );
    end if;

    if exists (
      select 1 from public.payments p
      where p.reversal_of = v_original.id
    ) then
      return jsonb_build_object('ok', false, 'error', 'ALREADY_REVERSED');
    end if;

    if v_original.order_id is not null then
      select coalesce(
               round(sum(case when p.kind = 'payment' then p.amount else -p.amount end), 2),
               0
             )
         into v_net_paid
       from public.payments p
       where p.order_id = v_order.id;

      v_paid_total := round(v_order.opening_paid + v_net_paid, 2);
      v_due := round(v_order.total - v_paid_total, 2);

      -- Edge (H): never below zero, never above the order total.
      if v_original.amount > v_net_paid then
        return jsonb_build_object('ok', false, 'error', 'NEGATIVE_PAID');
      end if;
      -- The following OVERPAYMENT branch on the customer side can never be
      -- reached in practice: v_paid_total = opening_paid + net_paid, and
      -- v_original.amount <= net_paid (checked above), so
      -- v_paid_total - v_original.amount >= opening_paid >= 0, and
      -- opening_paid <= total by constraint. Thus
      -- round(v_paid_total - v_original.amount, 2) > v_order.total is
      -- impossible. Kept as a defensive guard.
      if round(v_paid_total - v_original.amount, 2) > v_order.total then
        return jsonb_build_object('ok', false, 'error', 'OVERPAYMENT');
      end if;

      -- Wrap the INSERT so a unique_violation on the
      -- (business_id, idempotency_key) constraint re-reads the existing
      -- row and returns the replay or IDEMPOTENCY_CONFLICT, never
      -- DATABASE_ERROR. If that lookup finds nothing, a collision on
      -- reversal_of (one reversal per original) is reported as
      -- ALREADY_REVERSED; only an unknown constraint reaches the generic
      -- DATABASE_ERROR fallback.
      begin
        insert into public.payments (
          business_id, kind, direction, order_id, reversal_of, amount, method,
          paid_at, reference, notes, idempotency_key, created_by
        ) values (
          p_business_id, 'reversal', v_original.direction, v_order.id, v_original.id,
          v_original.amount, v_original.method, now(), v_original.reference, v_reason,
          v_key, p_actor
        )
        returning id into v_reversal_id;
      exception
        when unique_violation then
          -- Re-read under the same lock to decide replay vs conflict.
          select p.* into v_existing
          from public.payments p
          where p.business_id = p_business_id and p.idempotency_key = v_key;
          if v_existing.id is not null then
            if v_existing.kind <> 'reversal'
               or v_existing.reversal_of is distinct from v_original.id
               or v_existing.amount is distinct from v_original.amount then
              return jsonb_build_object('ok', false, 'error', 'IDEMPOTENCY_CONFLICT');
            end if;
            return jsonb_build_object(
              'ok', true,
              'idempotent_replay', true,
              'payment', to_jsonb(v_existing),
              'reversedPaymentId', v_original.id
            );
          end if;
          -- The idempotency re-read found nothing, so this violation is the
          -- reversal_of unique index: the original was already reversed.
          if exists (
            select 1 from public.payments p
            where p.reversal_of = v_original.id
          ) then
            return jsonb_build_object('ok', false, 'error', 'ALREADY_REVERSED');
          end if;
          -- Fallback (should not happen): some other unique constraint fired.
          return jsonb_build_object('ok', false, 'error', 'DATABASE_ERROR');
      end;

      return jsonb_build_object(
        'ok', true,
        'idempotent_replay', false,
        'payment', (select to_jsonb(p.*) from public.payments p where p.id = v_reversal_id),
        'reversedPaymentId', v_original.id,
        'orderId', v_order.id,
        'net_paid', round(v_net_paid - v_original.amount, 2),
        'paid', round(v_paid_total - v_original.amount, 2),
        'due', round(v_due + v_original.amount, 2)
      );
    end if;

    -- Supplier side: restore the bill.
    v_paid_amount := round(v_bill.paid_amount - v_original.amount, 2);
    if v_paid_amount < 0 then
      return jsonb_build_object('ok', false, 'error', 'NEGATIVE_PAID');
    end if;
    if v_paid_amount > v_bill.total then
      return jsonb_build_object('ok', false, 'error', 'OVERPAYMENT');
    end if;

    -- Wrap the INSERT so a unique_violation on the
    -- (business_id, idempotency_key) constraint re-reads the existing
    -- row and returns the replay or IDEMPOTENCY_CONFLICT, never
    -- DATABASE_ERROR. If that lookup finds nothing, a collision on
    -- reversal_of (one reversal per original) is reported as
    -- ALREADY_REVERSED; only an unknown constraint reaches the generic
    -- DATABASE_ERROR fallback.
    begin
      insert into public.payments (
        business_id, kind, direction, supplier_bill_id, reversal_of, amount, method,
        paid_at, reference, notes, idempotency_key, created_by
      ) values (
        p_business_id, 'reversal', v_original.direction, v_bill.id, v_original.id,
        v_original.amount, v_original.method, now(), v_original.reference, v_reason,
        v_key, p_actor
      )
      returning id into v_reversal_id;
    exception
      when unique_violation then
        -- Re-read under the same lock to decide replay vs conflict.
        select p.* into v_existing
        from public.payments p
        where p.business_id = p_business_id and p.idempotency_key = v_key;
        if v_existing.id is not null then
          if v_existing.kind <> 'reversal'
             or v_existing.reversal_of is distinct from v_original.id
             or v_existing.amount is distinct from v_original.amount then
            return jsonb_build_object('ok', false, 'error', 'IDEMPOTENCY_CONFLICT');
          end if;
          return jsonb_build_object(
            'ok', true,
            'idempotent_replay', true,
            'payment', to_jsonb(v_existing),
            'reversedPaymentId', v_original.id
          );
        end if;
        -- The idempotency re-read found nothing, so this violation is the
        -- reversal_of unique index: the original was already reversed.
        if exists (
          select 1 from public.payments p
          where p.reversal_of = v_original.id
        ) then
          return jsonb_build_object('ok', false, 'error', 'ALREADY_REVERSED');
        end if;
        -- Fallback (should not happen): some other unique constraint fired.
        return jsonb_build_object('ok', false, 'error', 'DATABASE_ERROR');
    end;

    v_new_status := case
      when v_paid_amount = v_bill.total then 'paid'
      when v_paid_amount > 0 then 'partial'
      else 'unpaid'
    end;

    update public.supplier_bills
      set paid_amount = v_paid_amount,
          due_amount = round(v_bill.total - v_paid_amount, 2),
          status = v_new_status
      where id = v_bill.id and business_id = p_business_id;

    return jsonb_build_object(
      'ok', true,
      'idempotent_replay', false,
      'payment', (select to_jsonb(p.*) from public.payments p where p.id = v_reversal_id),
      'reversedPaymentId', v_original.id,
      'supplierBillId', v_bill.id,
      'paidAmount', v_paid_amount,
      'due', round(v_bill.total - v_paid_amount, 2)
    );
  exception
    when others then
      return jsonb_build_object('ok', false, 'error', 'DATABASE_ERROR');
  end;
end;
$$;

-- Authenticated wrapper: business and actor come from auth.uid(), so no caller
-- can reverse a payment in somebody else's business.
create or replace function public.reverse_payment(
  p_payment_id uuid,
  p_reason text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_business_id uuid;
begin
  select b.id into v_business_id
  from public.businesses b
  where b.owner_id = (select auth.uid());
  if v_business_id is null then
    return jsonb_build_object('ok', false, 'error', 'NO_BUSINESS');
  end if;

  return public.reverse_payment_for_business(
    v_business_id,
    (select auth.uid()),
    p_payment_id,
    p_reason,
    p_idempotency_key
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 7G. Read helpers.
--
-- get_order_payment_summary(p_order_id uuid)
--   Customer-side truth for ONE order: total, opening_paid, net_paid from the
--   ledger, paid (= opening_paid + net_paid) and due (= total - paid).
--
-- list_order_payment_summaries()
--   The same numbers for every order of the caller's business, for a
--   receivables screen.
--
-- WHY A FUNCTION AND NOT A VIEW (the safer of the two, as required):
--   A view over orders + payments must be created `security_invoker = true` to
--   have the caller's RLS apply; that option only exists from Postgres 15. In
--   an older database the view silently runs as its owner and every business
--   would see every other business's receivables. A SECURITY INVOKER function
--   has carried caller-RLS semantics forever, can be revoked from PUBLIC/anon
--   precisely (a view shows up in the PostgREST schema next to the tables,
--   where it is easy to hit by accident), and this migration cannot verify the
--   live Postgres version from the repository. Both helpers are read-only, so
--   invoker is exactly what we want here.
-- ---------------------------------------------------------------------------

create or replace function public.get_order_payment_summary(p_order_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_order public.orders%rowtype;
  v_net_paid numeric(12, 2);
  v_paid_total numeric(12, 2);
  v_due numeric(12, 2);
begin
  -- SECURITY INVOKER: RLS on orders applies, so another business's order id is
  -- simply invisible and reported as NOT_FOUND.
  select o.* into v_order
  from public.orders o
  where o.id = p_order_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  end if;

  select coalesce(
           round(sum(case when p.kind = 'payment' then p.amount else -p.amount end), 2),
           0
         )
    into v_net_paid
  from public.payments p
  where p.order_id = v_order.id;

  v_paid_total := round(v_order.opening_paid + v_net_paid, 2);
  v_due := round(v_order.total - v_paid_total, 2);

  return jsonb_build_object(
    'ok', true,
    'orderId', v_order.id,
    'orderNumber', v_order.order_number,
    'status', v_order.status,
    'total', v_order.total,
    'openingPaid', v_order.opening_paid,
    'netPaid', v_net_paid,
    'paid', v_paid_total,
    'due', v_due
  );
end;
$$;

comment on function public.get_order_payment_summary(uuid) is
  'Derived customer-side money for one order: total, opening_paid, net_paid (from the payments ledger), paid and due. SECURITY INVOKER, so RLS decides visibility; nothing here is stored on orders.';

create or replace function public.list_order_payment_summaries()
returns table (
  order_id uuid,
  order_number text,
  customer_id uuid,
  status text,
  ordered_at timestamptz,
  total numeric(12, 2),
  opening_paid numeric(12, 2),
  net_paid numeric(12, 2),
  paid numeric(12, 2),
  due numeric(12, 2),
  payment_count bigint
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  -- One pass over the ledger, then joined to the orders the caller can see.
  -- SECURITY INVOKER on both sides: RLS on orders AND on payments applies, so
  -- this can only ever return the caller's own business rows.
  with ledger as (
    select p.order_id as order_id,
           coalesce(
             round(sum(case when p.kind = 'payment' then p.amount else -p.amount end), 2),
             0
           ) as net_paid,
           count(*) as payment_count
    from public.payments p
    where p.order_id is not null
    group by p.order_id
  )
  select
    o.id,
    o.order_number,
    o.customer_id,
    o.status,
    o.ordered_at,
    round(o.total, 2),
    round(o.opening_paid, 2),
    round(coalesce(l.net_paid, 0), 2),
    round(o.opening_paid + coalesce(l.net_paid, 0), 2),
    round(o.total - o.opening_paid - coalesce(l.net_paid, 0), 2),
    coalesce(l.payment_count, 0)
  from public.orders o
  left join ledger l on l.order_id = o.id
  order by o.ordered_at desc, o.id desc;
$$;

comment on function public.list_order_payment_summaries() is
  'Per-order derived money (paid/due) for the caller''s business only. SECURITY INVOKER so RLS applies to orders and payments. A function rather than a view because caller-RLS views need Postgres 15 security_invoker and a view would be exposed next to the tables.';

-- ===========================================================================
-- SECTION 8 — Function grants
-- ===========================================================================
-- Same reasoning as the table grants: EXECUTE is checked against the calling
-- role, so the GRANT list here is the real boundary.
--
-- authenticated may call ONLY:
--   create_supplier_bill, update_supplier_bill, delete_supplier_bill,
--   record_payment, reverse_payment,
--   get_order_payment_summary, list_order_payment_summaries
-- All of these resolve business_id from auth.uid(); none of them has a
-- business_id parameter.
--
-- service_role additionally may call:
--   record_payment_for_business, reverse_payment_for_business
-- These are the ONLY functions in this migration that accept a caller-supplied
-- business_id, and they are not executable by any user role at all — they are
-- called from server code (approved WhatsApp actions) that already knows which
-- business it is acting for.

revoke all on function public.create_supplier_bill(jsonb) from public, anon;
revoke all on function public.update_supplier_bill(uuid, jsonb) from public, anon;
revoke all on function public.delete_supplier_bill(uuid) from public, anon;
revoke all on function public.record_payment(jsonb) from public, anon;
revoke all on function public.reverse_payment(uuid, text, text) from public, anon;
revoke all on function public.get_order_payment_summary(uuid) from public, anon;
revoke all on function public.list_order_payment_summaries() from public, anon;
grant execute on function public.create_supplier_bill(jsonb) to authenticated;
grant execute on function public.update_supplier_bill(uuid, jsonb) to authenticated;
grant execute on function public.delete_supplier_bill(uuid) to authenticated;
grant execute on function public.record_payment(jsonb) to authenticated;
grant execute on function public.reverse_payment(uuid, text, text) to authenticated;
grant execute on function public.get_order_payment_summary(uuid) to authenticated;
grant execute on function public.list_order_payment_summaries() to authenticated;

-- Internal money writers: service_role only. Revoked from authenticated, anon
-- AND public, so no browser session and no PostgREST role can name a business
-- and have money appear in it.
revoke all on function public.record_payment_for_business(uuid, uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.reverse_payment_for_business(uuid, uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.record_payment_for_business(uuid, uuid, jsonb)
  to service_role;
grant execute on function public.reverse_payment_for_business(uuid, uuid, uuid, text, text)
  to service_role;

-- Trigger function: nobody may call it directly (it can only fire as a
-- trigger), and it is not an entry point of any kind.
revoke all on function public.block_payment_mutation() from public, anon, authenticated;
revoke all on function public.block_payment_truncate() from public, anon, authenticated;
revoke all on function public.guard_orders_opening_paid_update() from public, anon, authenticated;
revoke all on function public.guard_orders_opening_paid_insert() from public, anon, authenticated;

-- Done. Nothing in this migration touches orders.status logic, stock
-- quantities, or any existing function definition.
