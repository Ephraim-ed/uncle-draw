-- v2 collaboration (FEATURES.md §9 COLLAB-1…4, TECHNICAL_REQUIREMENTS.md §15).
-- People join a board through its edit link and become editors. Editors can
-- change the drawing; the owner keeps the title, trash, links and membership.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.board_members (
  board_id   uuid not null references public.boards(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text not null default 'editor' check (role in ('editor')),
  created_at timestamptz not null default now(),
  primary key (board_id, user_id)
);
create index board_members_user_idx on public.board_members (user_id);

-- "Anyone with this link can edit after signing in" (COLLAB-1).
create table public.board_edit_links (
  id          uuid primary key default gen_random_uuid(),
  board_id    uuid not null references public.boards(id) on delete cascade,
  token       text not null unique
                check (token ~ '^[A-Za-z0-9_-]{43}$'),  -- 32 random bytes, base64url
  created_by  uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  revoked_at  timestamptz                         -- null = active
);
create unique index board_edit_links_one_active_idx
  on public.board_edit_links (board_id) where revoked_at is null;
create index board_edit_links_created_by_idx on public.board_edit_links (created_by);

-- Storage read policies look files and thumbnails up by path.
create index board_files_storage_path_idx on public.board_files (storage_path);
create index boards_thumbnail_path_idx on public.boards (thumbnail_path) where thumbnail_path is not null;

-- ---------------------------------------------------------------------------
-- Access helpers. Security definer so policies on boards and board_members can
-- use them without recursing into each other's RLS.
-- ---------------------------------------------------------------------------

create function public.is_board_owner(p_board_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.boards
     where id = p_board_id and owner_id = (select auth.uid())
  );
$$;

create function public.is_board_member(p_board_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.board_members
     where board_id = p_board_id and user_id = (select auth.uid())
  );
$$;

-- Owner or editor: may change the drawing and join the board's live channel.
create function public.can_edit_board(p_board_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select public.is_board_owner(p_board_id) or public.is_board_member(p_board_id);
$$;

-- "board:<uuid>" → uuid; anything else → null (and so no access).
create function public.board_id_from_topic(p_topic text)
returns uuid
language sql immutable
set search_path = ''
as $$
  select case
    when p_topic ~ '^board:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then substr(p_topic, 7)::uuid
  end;
$$;

revoke execute on function public.is_board_owner(uuid) from public, anon;
revoke execute on function public.is_board_member(uuid) from public, anon;
revoke execute on function public.can_edit_board(uuid) from public, anon;
grant execute on function public.is_board_owner(uuid) to authenticated;
grant execute on function public.is_board_member(uuid) to authenticated;
grant execute on function public.can_edit_board(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------

-- Editors save too, so save_board checks access itself instead of relying on
-- an update policy (which would also let editors rename, trash or re-own).
create or replace function public.save_board(
  p_board_id uuid, p_expected_version int, p_scene jsonb, p_app_state jsonb
) returns int                      -- new version, or null on conflict / no access
language sql security definer
set search_path = ''
as $$
  update public.boards
     set scene = p_scene, app_state = p_app_state,
         version = version + 1, updated_at = now()
   where id = p_board_id
     and version = p_expected_version
     and deleted_at is null
     and public.can_edit_board(p_board_id)
  returning version;
$$;

revoke execute on function public.save_board(uuid, int, jsonb, jsonb) from public, anon;
grant execute on function public.save_board(uuid, int, jsonb, jsonb) to authenticated;

-- Whoever renders the preview stores it in their own folder:
-- thumbnails/{their user id}/{board id}.webp. No path (null) clears it.
create function public.set_board_thumbnail(p_board_id uuid, p_path text default null)
returns void
language sql security definer
set search_path = ''
as $$
  update public.boards
     set thumbnail_path = p_path
   where id = p_board_id
     and deleted_at is null
     and public.can_edit_board(p_board_id)
     and (p_path is null
          or p_path = (select auth.uid())::text || '/' || p_board_id::text || '.webp');
$$;

revoke execute on function public.set_board_thumbnail(uuid, text) from public, anon;
grant execute on function public.set_board_thumbnail(uuid, text) to authenticated;

-- Opening an edit link: the caller becomes an editor and gets the board id.
-- Null when the link is unknown, revoked, or its board is in the trash.
create function public.join_board(p_token text)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid   uuid := (select auth.uid());
  v_board uuid;
  v_owner uuid;
begin
  if v_uid is null or p_token !~ '^[A-Za-z0-9_-]{43}$' then
    return null;
  end if;

  select l.board_id, b.owner_id into v_board, v_owner
    from public.board_edit_links l
    join public.boards b on b.id = l.board_id
   where l.token = p_token
     and l.revoked_at is null
     and b.deleted_at is null;

  if v_board is null then
    return null;
  end if;

  if v_owner <> v_uid then
    if (select count(*) from public.board_members where board_id = v_board) >= 50 then
      raise exception 'This board already has the maximum number of editors.'
        using errcode = 'P0001', hint = 'board_full';
    end if;
    insert into public.board_members (board_id, user_id)
    values (v_board, v_uid)
    on conflict do nothing;
  end if;

  return v_board;
end;
$$;

revoke execute on function public.join_board(text) from public, anon;
grant execute on function public.join_board(text) to authenticated;

-- Everyone with access, owner first, for the share dialog (COLLAB-1).
-- Profiles stay private otherwise.
create function public.board_people(p_board_id uuid)
returns table (user_id uuid, display_name text, avatar_url text, role text, joined_at timestamptz)
language sql stable security definer
set search_path = ''
as $$
  select * from (
    select b.owner_id, p.display_name, p.avatar_url, 'owner'::text, b.created_at
      from public.boards b
      left join public.profiles p on p.id = b.owner_id
     where b.id = p_board_id
    union all
    select m.user_id, p.display_name, p.avatar_url, m.role, m.created_at
      from public.board_members m
      left join public.profiles p on p.id = m.user_id
     where m.board_id = p_board_id
  ) people (user_id, display_name, avatar_url, role, joined_at)
  where public.can_edit_board(p_board_id)
  order by role = 'owner' desc, joined_at;
$$;

revoke execute on function public.board_people(uuid) from public, anon;
grant execute on function public.board_people(uuid) to authenticated;

-- "Get a new link" for the edit link, in one transaction. RLS applies.
create function public.rotate_board_edit_link(p_board_id uuid, p_token text)
returns public.board_edit_links
language plpgsql security invoker
set search_path = ''
as $$
declare
  v_link public.board_edit_links;
begin
  update public.board_edit_links
     set revoked_at = now()
   where board_id = p_board_id
     and revoked_at is null;

  insert into public.board_edit_links (board_id, token)
  values (p_board_id, p_token)
  returning * into v_link;

  return v_link;
end;
$$;

revoke execute on function public.rotate_board_edit_link(uuid, text) from public, anon;
grant execute on function public.rotate_board_edit_link(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.board_members    enable row level security;
alter table public.board_edit_links enable row level security;

-- Boards: editors can read (and save through save_board). Changing anything
-- else stays with the owner's existing policy.
create policy "members can read" on public.boards
  for select to authenticated
  using (public.is_board_member(id));

-- Files: editors read every file on the board and add their own.
create policy "collaborators can read" on public.board_files
  for select to authenticated
  using (public.can_edit_board(board_id));

create policy "collaborators can add" on public.board_files
  for insert to authenticated
  with check (owner_id = (select auth.uid()) and public.can_edit_board(board_id));

-- Members: I see my own memberships; the owner sees and removes everyone.
-- Rows are only created by join_board().
create policy "member or owner can read" on public.board_members
  for select to authenticated
  using (user_id = (select auth.uid()) or public.is_board_owner(board_id));

create policy "member can leave, owner can remove" on public.board_members
  for delete to authenticated
  using (user_id = (select auth.uid()) or public.is_board_owner(board_id));

-- Edit links: created by me AND on a board I own (same rule as share links).
create policy "owner can do everything" on public.board_edit_links
  for all to authenticated
  using (created_by = (select auth.uid()) and public.is_board_owner(board_id))
  with check (created_by = (select auth.uid()) and public.is_board_owner(board_id));

-- ---------------------------------------------------------------------------
-- Storage: collaborators read each other's uploads for boards they share.
-- Writes stay in the uploader's own folder (the "own folder" policy).
-- ---------------------------------------------------------------------------

create policy "board files: collaborators read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'board-files'
    and exists (
      select 1 from public.board_files f
       where f.storage_path = objects.name
         and public.can_edit_board(f.board_id)
    )
  );

create policy "thumbnails: collaborators read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'thumbnails'
    and exists (
      select 1 from public.boards b
       where b.thumbnail_path = objects.name
         and public.can_edit_board(b.id)
    )
  );

-- ---------------------------------------------------------------------------
-- Realtime: the private channel "board:{id}" carries live edits, cursors and
-- presence (tech §15). Only the owner and editors may join, listen or send.
-- ---------------------------------------------------------------------------

create policy "board collaborators can listen" on realtime.messages
  for select to authenticated
  using (
    realtime.messages.extension in ('broadcast', 'presence')
    and public.can_edit_board(public.board_id_from_topic((select realtime.topic())))
  );

create policy "board collaborators can send" on realtime.messages
  for insert to authenticated
  with check (
    realtime.messages.extension in ('broadcast', 'presence')
    and public.can_edit_board(public.board_id_from_topic((select realtime.topic())))
  );
