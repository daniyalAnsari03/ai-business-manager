-- Privilege grants for public.orders / public.order_items and the
-- order-number sequence.
--
-- Same reasoning as the other grants migrations: Postgres checks table
-- privileges before RLS, so the API roles need explicit GRANTs. DELETE on
-- orders is granted because deletion is part of this phase — but only ever
-- reachable for orders that were never completed (enforced inside the
-- delete_business_order function), keeping financial history protected.
--
-- The order-number sequence needs USAGE because its nextval() runs with the
-- inserting role's privileges (table default expression).

grant select, insert, update, delete on public.orders to anon;
grant select, insert, update, delete on public.orders to authenticated;
grant select, insert, update, delete on public.orders to service_role;

grant select, insert, update, delete on public.order_items to anon;
grant select, insert, update, delete on public.order_items to authenticated;
grant select, insert, update, delete on public.order_items to service_role;

grant usage on sequence public.orders_order_number_seq to anon;
grant usage on sequence public.orders_order_number_seq to authenticated;
grant usage on sequence public.orders_order_number_seq to service_role;
