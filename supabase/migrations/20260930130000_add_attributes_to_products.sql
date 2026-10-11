-- Business-type-specific product attributes (docs/fix.txt — File 3 / Step 2b).
--
-- products gains a generic `attributes` jsonb bag so a business type can hold
-- its own per-product facts without a new column (and a new migration) per
-- domain. Step 2b only stores the container; today the only writer is the
-- pure validator lib/business/product-attributes.ts for clothing_fashion
-- (`fabric_attributes` capability). For every other business type the value
-- stays '{}'.
--
-- Design notes:
--   - NOT NULL with an explicit '{}' default, so every existing row is valid
--     immediately and no application read path has to handle NULL.
--   - The default is deliberately '{}' and never '{}' plus invented keys:
--     missing attributes stay missing (see normalizeProductAttributes).
--   - Shape is enforced by CHECK constraints, not by application code alone, so
--     a direct SQL write, a buggy service, or a rogue client still cannot put
--     an array/scalar/null into the column, nor an unbounded document.
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
  add column attributes jsonb not null default '{}'::jsonb;

-- The container is always a JSON object, never an array, scalar or null.
alter table public.products
  add constraint products_attributes_is_object check (
    jsonb_typeof(attributes) = 'object'
  );

-- Size cap. `length(attributes::text)` is the serialised jsonb text, which is
-- what actually costs storage; pg_column_size() is not used because it counts
-- the on-disk datum and would under-report for small documents. 4000 chars is
-- far above the ceiling of five optional string attributes capped at 60 chars
-- each (see lib/business/product-attributes.ts), so it only ever trips on
-- hand-written or malformed SQL.
alter table public.products
  add constraint products_attributes_size check (
    length(attributes::text) <= 4000
  );

comment on column public.products.attributes is
  'Business-type-specific product attributes as a JSON object, always {}. Clothing businesses use { product_type, fabric, color, design, size } (all optional strings). Never null, never a JSON array. Validated server-side by lib/business/product-attributes.ts.';
