-- Orders RLS delete policy.
--
-- The sanctioned hard-delete path (delete_business_order function) was
-- documented to allow deleting orders that were NEVER completed, but it
-- silently did nothing: the `orders` table defined select/insert/update
-- policies but NO delete policy, so RLS denied even the security-invoker
-- function's internal DELETE (0 rows) while the function still returned
-- { ok: true }. This made order hard-deletion falsely report success.
--
-- This policy restores the documented behavior: an owner may delete their own
-- business's orders as long as they were never completed, preserving financial
-- records exactly as designed (completed orders remain undeletable, enforced
-- by the function AND now by RLS).
drop policy if exists "Owners can delete their business's non-completed orders"
  on public.orders;

create policy "Owners can delete their business's non-completed orders"
  on public.orders for delete
  using (
    status <> 'completed'
    and exists (
      select 1 from public.businesses b
      where b.id = business_id and b.owner_id = (select auth.uid())
    )
  );
