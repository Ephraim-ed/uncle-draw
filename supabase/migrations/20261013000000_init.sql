-- Uncle Draw v1 schema (docs/TECHNICAL_REQUIREMENTS.md §5–6).
-- Every table has RLS; a table without policies is unreachable.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- Profiles: one row per user, created by trigger on auth.users insert.
create table public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text check (display_name is null or char_length(display_name) <= 80),
  avatar_url   text,                      -- from GitHub, if available
  created_at   timestamptz not null default now()
);

-- Boards: one Excalidraw scene each.
create table public.boards (
  id                   uuid primary key default gen_random_uuid(),
  owner_id             uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title                text not null default 'Untitled board'
                         check (char_length(title) between 1 and 200),
  scene                jsonb not null default '{"elements":[]}'::jsonb,
  app_state            jsonb not null default '{}'::jsonb,
  scene_schema_version int  not null default 1,
  version              int  not null default 1,   -- optimistic concurrency, bumped only by save_board()
  thumbnail_path       text,                      -- path in the thumbnails bucket
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  deleted_at           timestamptz                -- soft delete (trash)
);
create index boards_owner_updated_idx
  on public.boards (owner_id, updated_at desc) where deleted_at is null;

-- Image files referenced by image elements (element.fileId).
create table public.board_files (
  board_id     uuid not null references public.boards(id) on delete cascade,
  file_id      text not null,                     -- Excalidraw FileId
  owner_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  storage_path text not null,                     -- {owner_id}/{board_id}/{file_id}
  mime_type    text not null,
  size_bytes   int  not null check (size_bytes <= 5 * 1024 * 1024),
  created_at   timestamptz not null default now(),
  primary key (board_id, file_id)
);
create index board_files_owner_idx on public.board_files (owner_id);

-- Read-only share links.
create table public.board_shares (
  id          uuid primary key default gen_random_uuid(),
  board_id    uuid not null references public.boards(id) on delete cascade,
  token       text not null unique
                check (token ~ '^[A-Za-z0-9_-]{43}$'),  -- 32 random bytes, base64url (43 chars)
  role        text not null default 'viewer' check (role in ('viewer')),
  created_by  uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz,                        -- null = never
  revoked_at  timestamptz                         -- null = active
);
-- At most one active link per board (SHARE-1).
create unique index board_shares_one_active_idx
  on public.board_shares (board_id) where revoked_at is null;
create index board_shares_created_by_idx on public.board_shares (created_by);

-- Personal Excalidraw library (v1.1).
create table public.user_libraries (
  user_id    uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  items      jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

-- Keeps updated_at current on every update (renames and thumbnails included).
create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger boards_set_updated_at
  before update on public.boards
  for each row execute function public.set_updated_at();

create trigger user_libraries_set_updated_at
  before update on public.user_libraries
  for each row execute function public.set_updated_at();

-- Creates the profile: name and avatar from GitHub metadata, or the part of
-- the email before the "@" (AUTH-5).
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    left(coalesce(
      nullif(new.raw_user_meta_data ->> 'full_name', ''),
      nullif(new.raw_user_meta_data ->> 'name', ''),
      nullif(new.raw_user_meta_data ->> 'user_name', ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), '')
    ), 80),
    nullif(new.raw_user_meta_data ->> 'avatar_url', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- A magic-link user who later signs in with GitHub (same verified email) gets
-- the GitHub avatar if they don't have one yet.
create function public.handle_user_metadata_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles
     set avatar_url = nullif(new.raw_user_meta_data ->> 'avatar_url', '')
   where id = new.id
     and avatar_url is null
     and nullif(new.raw_user_meta_data ->> 'avatar_url', '') is not null;
  return new;
end;
$$;

create trigger on_auth_user_metadata_updated
  after update of raw_user_meta_data on auth.users
  for each row execute function public.handle_user_metadata_update();

revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.handle_user_metadata_update() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------

-- The editor saves only through this function, so the version check is atomic.
create function public.save_board(
  p_board_id uuid, p_expected_version int, p_scene jsonb, p_app_state jsonb
) returns int                      -- new version, or null on conflict / not found
language sql security invoker      -- RLS still applies
set search_path = ''
as $$
  update public.boards
     set scene = p_scene, app_state = p_app_state,
         version = version + 1, updated_at = now()
   where id = p_board_id
     and version = p_expected_version
     and deleted_at is null
  returning version;
$$;

revoke execute on function public.save_board(uuid, int, jsonb, jsonb) from public, anon;
grant execute on function public.save_board(uuid, int, jsonb, jsonb) to authenticated;

-- "Get a new link": revoke the active link and create a new one in one
-- transaction (SHARE-3). RLS applies.
create function public.rotate_board_share(p_board_id uuid, p_token text)
returns public.board_shares
language plpgsql security invoker
set search_path = ''
as $$
declare
  v_share public.board_shares;
begin
  update public.board_shares
     set revoked_at = now()
   where board_id = p_board_id
     and revoked_at is null;

  insert into public.board_shares (board_id, token)
  values (p_board_id, p_token)
  returning * into v_share;

  return v_share;
end;
$$;

revoke execute on function public.rotate_board_share(uuid, text) from public, anon;
grant execute on function public.rotate_board_share(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security (tech §6)
-- ---------------------------------------------------------------------------

alter table public.profiles       enable row level security;
alter table public.boards         enable row level security;
alter table public.board_files    enable row level security;
alter table public.board_shares   enable row level security;
alter table public.user_libraries enable row level security;

-- Profiles: read and update my own row only.
create policy "own profile: read" on public.profiles
  for select to authenticated
  using (id = (select auth.uid()));

create policy "own profile: update" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- Boards: owner only.
create policy "owner can do everything" on public.boards
  for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

-- Files: owner only, and only on boards the owner owns.
create policy "owner can do everything" on public.board_files
  for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (
    owner_id = (select auth.uid())
    and exists (
      select 1 from public.boards b
       where b.id = board_id and b.owner_id = (select auth.uid())
    )
  );

-- Shares: created by me AND on a board I own.
create policy "owner can do everything" on public.board_shares
  for all to authenticated
  using (
    created_by = (select auth.uid())
    and exists (
      select 1 from public.boards b
       where b.id = board_id and b.owner_id = (select auth.uid())
    )
  )
  with check (
    created_by = (select auth.uid())
    and exists (
      select 1 from public.boards b
       where b.id = board_id and b.owner_id = (select auth.uid())
    )
  );

-- Library: my own row only.
create policy "owner can do everything" on public.user_libraries
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Storage (tech §5, §6.3)
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('board-files', 'board-files', false, 5242880,
     array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml']),
  -- Thumbnails are WebP; browsers that can't encode WebP fall back to PNG.
  ('thumbnails', 'thumbnails', false, 2097152,
     array['image/webp', 'image/png'])
on conflict (id) do nothing;

-- Objects live under the owner's folder: {user_id}/...
create policy "own folder" on storage.objects
  for all to authenticated
  using (bucket_id in ('board-files', 'thumbnails')
         and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id in ('board-files', 'thumbnails')
         and (storage.foldername(name))[1] = (select auth.uid())::text);
