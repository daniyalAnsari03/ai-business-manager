-- Phase: application-level user profile.
-- One row per authenticated user, mirroring the Supabase Auth identity
-- (email, display name, avatar) plus the preferred language. Credentials
-- stay exclusively inside Supabase Auth — this table never stores secrets.

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  display_name text,
  avatar_url text,
  preferred_language text not null default 'en' check (preferred_language in ('en', 'ur')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is
  'Application profile for an authenticated Supabase user. Identity data is mirrored from auth.users; the row is provisioned automatically at signup and lazily backfilled for legacy accounts.';

-- ---------------------------------------------------------------------------
-- updated_at maintenance (set_updated_at is created by the businesses migration)
-- ---------------------------------------------------------------------------

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row
  execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security — a user may only see and edit their own profile.
-- No public policies; every policy is bound to the authenticated user.
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;

create policy "Users can view their own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users can insert their own profile"
  on public.profiles for insert
  with check (auth.uid() = id);

create policy "Users can update their own profile"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- No DELETE policy on purpose: profiles are removed automatically when the
-- auth user is deleted (ON DELETE CASCADE), never through the client API.

-- ---------------------------------------------------------------------------
-- Auto-provision a profile when any user is created (email or Google).
-- Runs as security definer so the auth flow can insert despite RLS.
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, display_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(
      nullif(new.raw_user_meta_data ->> 'full_name', ''),
      nullif(new.raw_user_meta_data ->> 'name', '')
    ),
    coalesce(
      nullif(new.raw_user_meta_data ->> 'avatar_url', ''),
      nullif(new.raw_user_meta_data ->> 'picture', '')
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Backfill profiles for users that signed up before this migration existed.
-- ---------------------------------------------------------------------------

insert into public.profiles (id, email, display_name, avatar_url)
select
  u.id,
  u.email,
  coalesce(
    nullif(u.raw_user_meta_data ->> 'full_name', ''),
    nullif(u.raw_user_meta_data ->> 'name', '')
  ),
  coalesce(
    nullif(u.raw_user_meta_data ->> 'avatar_url', ''),
    nullif(u.raw_user_meta_data ->> 'picture', '')
  )
from auth.users u
on conflict (id) do nothing;
