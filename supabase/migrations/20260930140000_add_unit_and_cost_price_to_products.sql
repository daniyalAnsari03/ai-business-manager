-- Unit label + cost price for products (docs/p1.txt — File 3 / Phase 2).
--
-- products gains two columns:
--   - unit        the selling/measuring label shown next to a quantity
--                 ("2 Meter", "1 Piece", "1 Carton"). LABEL ONLY: stock
--                 quantities stay whole numbers and no quantity column or
--                 quantity arithmetic changes here.
--   - cost_price  the price the business paid for the product, used later for
--                 profit reporting.
--
-- Design notes:
--   - unit is TEXT, not an enum, because FILE 3 allows predefined options
--     PLUS a custom value the owner types themselves. The list of suggested
--     values lives in the pure module lib/business/product-units.ts; the
--     database only enforces the shape.
--   - NOT NULL with default 'Piece' means every existing row is valid right
--     away and no application read path has to handle NULL. In Postgres 11+ a
--     constant default is a metadata-only change, so existing rows are backfilled
--     by the storage layer and every row reads 'Piece'.
--   - cost_price is NULLABLE with NO default on purpose. A cost price is real
--     business data we do not have; NULL means "unknown / not recorded yet".
--     A fabricated 0 would silently turn every profit report into a lie, so
--     existing rows keep NULL until the owner actually enters a value.
--   - Numeric style matches the existing price column exactly
--     (numeric(12, 2), see 20260821020000_create_products.sql) so money in
--     products keeps a single precision and scale.
--
-- RLS and GRANTS are intentionally UNCHANGED. Column-level additions inherit
-- the existing table-level policies and grants:
--   - policies (20260821020000_create_products.sql) are row-scoped, not
--     column-scoped: "Owners can view/create/update/delete their business's
--     products", each gated on
--     exists (select 1 from public.businesses b
--             where b.id = business_id and b.owner_id = (select auth.uid()));
--   - grants (20260821030000_grant_products_table_privileges.sql) are
--     `grant select, insert, update, delete on public.products` to anon,
--     authenticated and service_role.
-- Adding a column therefore grants nothing new: it can only be read or written
-- by a role that could already read or write the rest of the same row.

alter table public.products
  add column unit text not null default 'Piece';

-- Never blank and never longer than 30 characters once trimmed. The cap also
-- bounds any custom value the owner types in the app.
alter table public.products
  add constraint products_unit_length check (
    char_length(btrim(unit)) between 1 and 30
  );

alter table public.products
  add column cost_price numeric(12, 2);

-- Same non-negative rule as products_price_non_negative, but NULL is allowed:
-- an unknown cost price is honest data, a negative one never is.
alter table public.products
  add constraint products_cost_price_non_negative check (
    cost_price is null or cost_price >= 0
  );

comment on column public.products.unit is
  'Measuring/label unit for this product, e.g. Piece, Meter, Yard, Set, Dozen or a custom value. Predefined options live in lib/business/product-units.ts (custom values are allowed). Label only — stock quantities stay whole numbers.';

comment on column public.products.cost_price is
  'Price the business paid for one unit of this product, used for profit reporting. Null means unknown / not recorded yet; it is never guessed or defaulted to 0.';
