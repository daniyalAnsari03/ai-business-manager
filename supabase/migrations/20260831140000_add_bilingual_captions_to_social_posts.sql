-- Phase 2.5: Bilingual captions + per-draft language toggle + regenerate.
--
-- Adds caption_ur (Roman Urdu), caption_en (English) and selected_language
-- columns to social_posts so both language versions of a caption are stored.
--
-- The existing `caption` column is KEPT as a "currently selected" copy — it
-- stays in sync with whichever language is selected.  This means all existing
-- queries that read `caption` continue to work unchanged; no service layer
-- reads need to be rewritten for this phase.  `caption` is the value that
-- will eventually be published (Phase 4) and is the fallback for any code
-- that has not yet been updated to understand the two-column model.

ALTER TABLE public.social_posts
  ADD COLUMN IF NOT EXISTS caption_ur text,
  ADD COLUMN IF NOT EXISTS caption_en text,
  ADD COLUMN IF NOT EXISTS selected_language text not null default 'en';

-- Constraints: enforce valid language value and caption lengths.
ALTER TABLE public.social_posts
  ADD CONSTRAINT social_posts_selected_language_allowed
    check (selected_language in ('en', 'ur'));

ALTER TABLE public.social_posts
  ADD CONSTRAINT social_posts_caption_ur_length
    check (caption_ur is null or char_length(caption_ur) <= 2200);

ALTER TABLE public.social_posts
  ADD CONSTRAINT social_posts_caption_en_length
    check (caption_en is null or char_length(caption_en) <= 2200);

COMMENT ON COLUMN public.social_posts.caption_ur IS
  'Roman Urdu version of the AI-generated caption (Phase 2.5).';

COMMENT ON COLUMN public.social_posts.caption_en IS
  'English version of the AI-generated caption (Phase 2.5).';

COMMENT ON COLUMN public.social_posts.selected_language IS
  'Which language variant is currently selected for this post. The caption column mirrors this selection. Phase 2.5.';

-- Backfill: for existing rows that have a caption but no caption_ur/caption_en,
-- copy the existing caption into the column that matches selected_language.
-- Most existing drafts were generated in the business's language; this is a
-- best-effort migration that preserves the old caption text.
UPDATE public.social_posts
SET
  caption_en = caption,
  selected_language = 'en'
WHERE caption IS NOT NULL
  AND caption_en IS NULL
  AND caption_ur IS NULL
  AND selected_language = 'en';

UPDATE public.social_posts
SET
  caption_ur = caption,
  selected_language = 'ur'
WHERE caption IS NOT NULL
  AND caption_en IS NULL
  AND caption_ur IS NULL
  AND selected_language = 'ur';

-- Index for the new column used in regenerate lookups.
CREATE INDEX IF NOT EXISTS social_posts_business_product_idx
  ON public.social_posts (business_id, product_id);
