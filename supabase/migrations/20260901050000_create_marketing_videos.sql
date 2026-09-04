-- AI Marketing Manager — Phase 4: Marketing Videos.
--
-- `marketing_videos` records a business's uploaded video for AI caption /
-- hashtag / suggested-posting-time generation. The video binary itself lives
-- in Supabase Storage (bucket `marketing-videos`); this table stores the
-- metadata + the AI-generated content + the publish/approval linkage so the
-- exact same automation/approval engine that governs social posts also governs
-- video publishing.
--
-- `status` distinguishes the honest states: a freshly-uploaded video is
-- `uploaded`, then AI produces content (`ai_generated`), the owner may edit
-- (still `ai_generated`), and publishing goes through approval_actions before
-- the post is created/published elsewhere. We never claim to have analyzed
-- the visual content of the video — only the metadata/context we were given.

create table public.marketing_videos (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  storage_path text not null,
  file_name text,
  mime_type text,
  file_size_bytes bigint,
  duration_seconds numeric(10, 2),

  caption_en text,
  caption_ur text,
  caption text,
  hashtags text,
  suggested_post_time timestamptz,

  status text not null default 'uploaded',
  review_decision text,
  approval_action_id uuid references public.approval_actions (id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint marketing_videos_status_allowed check (
    status in ('uploaded', 'ai_generated', 'reviewing', 'approved', 'rejected')
  ),
  constraint marketing_videos_review_decision_allowed check (
    review_decision is null or review_decision in ('approved', 'rejected')
  ),
  constraint marketing_videos_storage_path_length check (
    char_length(storage_path) <= 500
  )
);

comment on table public.marketing_videos is
  'Business-owned video for AI caption/hashtag/timing generation. Owner-scoped via RLS. Storage binary lives in Supabase Storage.';

create index marketing_videos_business_id_idx on public.marketing_videos (business_id);
create index marketing_videos_business_created_idx on public.marketing_videos (business_id, created_at desc);

create trigger marketing_videos_set_updated_at
  before update on public.marketing_videos
  for each row
  execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Storage bucket — private per-business video files.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'marketing-videos',
  'marketing-videos',
  false,
  52428800,
  array['video/mp4', 'video/webm', 'video/quicktime']
)
on conflict (id) do nothing;

-- Videos are private; only the owning business may read/metadata them.
create policy "Owners can read their business's marketing videos"
  on storage.objects for select
  using (
    bucket_id = 'marketing-videos'
    and exists (
      select 1 from public.businesses b
      where b.owner_id = (select auth.uid())
        and (storage.foldername(name))[1]::uuid = b.id
    )
  );

create policy "Owners can upload marketing videos for their business"
  on storage.objects for insert
  with check (
    bucket_id = 'marketing-videos'
    and exists (
      select 1 from public.businesses b
      where b.owner_id = (select auth.uid())
        and (storage.foldername(name))[1]::uuid = b.id
    )
  );

-- ---------------------------------------------------------------------------
-- Row Level Security — ownership chain.
-- ---------------------------------------------------------------------------

alter table public.marketing_videos enable row level security;

create policy "Owners can view their marketing videos"
  on public.marketing_videos for select
  using (
    exists (
      select 1 from public.businesses b
      where b.id = business_id and b.owner_id = (select auth.uid())
    )
  );

create policy "Owners can create marketing videos for their business"
  on public.marketing_videos for insert
  with check (
    exists (
      select 1 from public.businesses b
      where b.id = business_id and b.owner_id = (select auth.uid())
    )
  );

create policy "Owners can update their marketing videos"
  on public.marketing_videos for update
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

create policy "Owners can delete their marketing videos"
  on public.marketing_videos for delete
  using (
    exists (
      select 1 from public.businesses b
      where b.id = business_id and b.owner_id = (select auth.uid())
    )
  );
