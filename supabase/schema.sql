-- Run this once in the Supabase SQL editor for your project.
-- This replaces the earlier single "integrations" table with the
-- normalized structure requested: profiles, connected_accounts,
-- integration_tokens, integration_sync_logs, chats, messages,
-- documents, ai_memory.

-- ============================================================
-- PROFILES — one row per user, auto-created on signup
-- ============================================================
create table if not exists public.profiles (
  id uuid references auth.users(id) on delete cascade primary key,
  full_name text,
  avatar_url text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.profiles enable row level security;

create policy "Users manage their own profile"
  on public.profiles for all
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Auto-create a profile row the moment someone signs up, so the app
-- never has to handle "no profile exists yet" as a special case.
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, new.raw_user_meta_data->>'full_name')
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ============================================================
-- CONNECTED_ACCOUNTS — safe-to-display metadata only, no secrets.
-- Frontend reads this directly for "Connected / Not Connected" UI.
-- ============================================================
create table if not exists public.connected_accounts (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  service text not null check (service in ('canvas','gmail','microsoft','slack','github','notion','canva')),
  status text not null default 'not_connected' check (status in ('connected','not_connected','error')),
  account_label text,           -- e.g. email address or Canvas domain — safe to show
  connected_at timestamptz,
  last_sync_at timestamptz,
  last_sync_status text,
  unique (user_id, service)
);

alter table public.connected_accounts enable row level security;

create policy "Users manage their own connected accounts"
  on public.connected_accounts for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ============================================================
-- INTEGRATION_TOKENS — actual secrets. Deliberately has NO policy
-- for the authenticated/anon role, so RLS blocks the browser (using
-- the anon key) from reading or writing this table at all, even its
-- own rows. Only Netlify Functions (service_role, which bypasses
-- RLS) can touch it. This is a hardening change from the earlier
-- version, which let the browser read back its own refresh tokens.
-- ============================================================
create table if not exists public.integration_tokens (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  service text not null check (service in ('canvas','gmail','microsoft','slack','github','notion','canva')),
  access_token text,
  refresh_token text,
  extra jsonb default '{}'::jsonb,  -- e.g. { "canvas_domain": "school.instructure.com" }
  updated_at timestamptz default now(),
  unique (user_id, service)
);

alter table public.integration_tokens enable row level security;
-- No policies created on purpose — see comment above.

-- ============================================================
-- INTEGRATION_SYNC_LOGS — one row per sync/test attempt, powers
-- "last synced" and status in the dashboard.
-- ============================================================
create table if not exists public.integration_sync_logs (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  service text not null,
  status text not null check (status in ('success','error')),
  message text,
  created_at timestamptz default now()
);

alter table public.integration_sync_logs enable row level security;

create policy "Users view their own sync logs"
  on public.integration_sync_logs for select
  using (auth.uid() = user_id);

create policy "Users insert their own sync logs"
  on public.integration_sync_logs for insert
  with check (auth.uid() = user_id);

-- ============================================================
-- CHATS / MESSAGES — unchanged from before
-- ============================================================
create table if not exists public.chats (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  title text default 'New Chat',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.chats enable row level security;

create policy "Users manage their own chats"
  on public.chats for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create table if not exists public.messages (
  id uuid default gen_random_uuid() primary key,
  chat_id uuid references public.chats(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  role text not null check (role in ('user','assistant')),
  content text not null,
  created_at timestamptz default now()
);

alter table public.messages enable row level security;

create policy "Users manage their own messages"
  on public.messages for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ============================================================
-- DOCUMENTS — metadata for files in Supabase Storage (bucket setup
-- is separate, in the Supabase dashboard — see README).
-- ============================================================
create table if not exists public.documents (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  title text,
  storage_path text not null,
  source text,  -- e.g. 'upload', 'gmail-attachment'
  created_at timestamptz default now()
);

alter table public.documents enable row level security;

create policy "Users manage their own documents"
  on public.documents for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ============================================================
-- AI_MEMORY — durable facts the assistant can recall across chats,
-- separate from per-chat message history. Table is scaffolded and
-- RLS-ready; the extraction/write pipeline is not built yet — see
-- README's "Recommended future enhancements".
-- ============================================================
create table if not exists public.ai_memory (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  fact text not null,
  created_at timestamptz default now()
);

alter table public.ai_memory enable row level security;

create policy "Users manage their own ai_memory"
  on public.ai_memory for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ============================================================
-- FILE UPLOADS — metadata for files stored in Supabase Storage
-- (bucket "uploads"). Actual bytes live in Storage, not here.
-- ============================================================
create table if not exists public.uploaded_files (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  storage_path text not null,
  filename text not null,
  mime_type text,
  size_bytes bigint,
  kind text not null check (kind in ('image','zip','text','other')),
  extracted_summary text, -- zip file listing, text preview, or image analysis result
  created_at timestamptz default now()
);

alter table public.uploaded_files enable row level security;

create policy "Users manage their own uploaded_files"
  on public.uploaded_files for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Run once in Supabase dashboard (Storage → New bucket) or via SQL:
-- insert into storage.buckets (id, name, public) values ('uploads', 'uploads', false)
--   on conflict (id) do nothing;
-- Then add a storage policy so users can only touch their own folder
-- (files are stored at "<user_id>/<timestamp>-<filename>"):
-- create policy "Users manage their own upload files"
--   on storage.objects for all
--   using (bucket_id = 'uploads' and (storage.foldername(name))[1] = auth.uid()::text)
--   with check (bucket_id = 'uploads' and (storage.foldername(name))[1] = auth.uid()::text);

-- ============================================================
-- MIGRATING FROM THE OLD SCHEMA (single "integrations" table)?
-- Run this after creating the tables above, then drop the old table.
-- ============================================================
-- insert into public.integration_tokens (user_id, service, access_token, extra)
--   select user_id, 'canvas', canvas_token, jsonb_build_object('canvas_domain', canvas_domain)
--   from public.integrations where canvas_token is not null;
-- insert into public.integration_tokens (user_id, service, access_token)
--   select user_id, 'slack', slack_user_token
--   from public.integrations where slack_user_token is not null;
-- insert into public.integration_tokens (user_id, service, refresh_token, extra)
--   select user_id, 'gmail', gmail_refresh_token, jsonb_build_object('email', gmail_email)
--   from public.integrations where gmail_refresh_token is not null;
-- drop table public.integrations;
