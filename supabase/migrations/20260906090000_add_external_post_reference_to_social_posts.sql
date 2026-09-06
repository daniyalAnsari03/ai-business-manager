-- AI Marketing Manager — Facebook real publishing.
--
-- social_posts gains a nullable external_post_reference column that stores the
-- real Facebook post ID (or Instagram media ID) returned by the platform after
-- a live publish. Keeping it generic lets both platform publishers store their
-- post reference without a new column per platform. Null while unpublished;
-- never exposed in a way that requires client trust (RLS unchanged).
--
-- No weakening of existing constraints; the new column is nullable.

alter table public.social_posts
  add column external_post_reference text;

alter table public.social_posts
  add constraint social_posts_external_post_reference_length check (
    external_post_reference is null or char_length(external_post_reference) <= 120
  );

comment on column public.social_posts.external_post_reference is
  'Real platform post reference (Facebook post id or Instagram media id) after a live publish. Null while unpublished.';