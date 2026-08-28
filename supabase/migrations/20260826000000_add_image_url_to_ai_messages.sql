-- Add image_url column to ai_messages so user-attached images survive page
-- reloads and conversation history navigation. Previously, only ephemeral
-- blob: preview URLs were stored client-side and lost on reload.

alter table public.ai_messages
  add column if not exists image_url text;

comment on column public.ai_messages.image_url is
  'Optional permanent image URL (Supabase Storage) attached to a user message. Set once on send, never changes.';
