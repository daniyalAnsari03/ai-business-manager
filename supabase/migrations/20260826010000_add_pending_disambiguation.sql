-- Cross-turn disambiguation context for the AI Business Manager.
-- When a tool returns ambiguous candidates (status: needs_clarification), we
-- stash the candidate list (WITH their real ids) on the conversation so the
-- agent can reference those ids on the user's NEXT turn — e.g. when the user
-- replies "pehla" / "first" / "clothing wala", the agent maps that back to the
-- exact candidate id instead of re-running a name search that hits the same
-- ambiguity again. See docs/fix.txt.

alter table public.ai_conversations
  add column pending_disambiguation jsonb not null default '[]'::jsonb;

comment on column public.ai_conversations.pending_disambiguation is
  'Stashed ambiguous-candidate list (with ids) so the agent can resolve a user''s next-turn positional/attribute selection to the exact record.';
