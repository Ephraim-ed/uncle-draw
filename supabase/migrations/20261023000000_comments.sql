-- Comments (FEATURES.md CMT-1, TECHNICAL_REQUIREMENTS.md §15): threads pinned
-- to a spot or a shape on a board, with replies. The owner and editors read
-- and write them; nobody else does (view-only share links don't show them).

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.comment_threads (
  id          uuid primary key default gen_random_uuid(),
  board_id    uuid not null references public.boards(id) on delete cascade,
  -- The shape or text it's on (an Excalidraw element id); null for a spot.
  element_id  text check (element_id is null or char_length(element_id) between 1 and 64),
  -- Where the pin goes, in scene coordinates: the spot, or where the shape
  -- was, for when it's gone. Finite numbers only (NaN fails `between`).
  x           double precision not null check (x between -1e9 and 1e9),
  y           double precision not null check (y between -1e9 and 1e9),
  created_by  uuid default auth.uid() references auth.users(id) on delete set null,
  -- clock_timestamp(), not now(): a thread and its first comment are written
  -- in one transaction, and order follows these times.
  created_at  timestamptz not null default clock_timestamp(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id) on delete set null,
  check (resolved_by is null or resolved_at is not null),
  -- Replies point at (thread, board), so they're always on the thread's board.
  unique (id, board_id)
);
create index comment_threads_board_idx on public.comment_threads (board_id);
create index comment_threads_created_by_idx on public.comment_threads (created_by);
create index comment_threads_resolved_by_idx on public.comment_threads (resolved_by);

-- The first comment starts the thread; the rest are replies.
create table public.comments (
  id         uuid primary key default gen_random_uuid(),
  thread_id  uuid not null,
  board_id   uuid not null,
  author_id  uuid not null default auth.uid() references auth.users(id) on delete cascade,
  body       text not null check (char_length(body) <= 4000 and btrim(body) <> ''),
  created_at timestamptz not null default clock_timestamp(),
  foreign key (thread_id, board_id)
    references public.comment_threads (id, board_id) on delete cascade
);
create index comments_thread_idx on public.comments (thread_id, created_at);
create index comments_board_idx on public.comments (board_id);
create index comments_author_idx on public.comments (author_id);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.comment_threads enable row level security;
alter table public.comments        enable row level security;

create policy "collaborators can read" on public.comment_threads
  for select to authenticated
  using (public.can_edit_board(board_id));

create policy "collaborators can start" on public.comment_threads
  for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and resolved_at is null
    and resolved_by is null
    and public.can_edit_board(board_id)
  );

-- Any collaborator resolves or reopens a thread (the only columns anyone may
-- update, see the grants below), and only in their own name.
create policy "collaborators can resolve" on public.comment_threads
  for update to authenticated
  using (public.can_edit_board(board_id))
  with check (
    public.can_edit_board(board_id)
    and (resolved_by is null or resolved_by = (select auth.uid()))
  );

create policy "starter or owner can delete" on public.comment_threads
  for delete to authenticated
  using (
    public.can_edit_board(board_id)
    and (created_by = (select auth.uid()) or public.is_board_owner(board_id))
  );

create policy "collaborators can read" on public.comments
  for select to authenticated
  using (public.can_edit_board(board_id));

create policy "collaborators can reply" on public.comments
  for insert to authenticated
  with check (author_id = (select auth.uid()) and public.can_edit_board(board_id));

create policy "author or owner can delete" on public.comments
  for delete to authenticated
  using (
    public.can_edit_board(board_id)
    and (author_id = (select auth.uid()) or public.is_board_owner(board_id))
  );

-- Comments aren't edited; threads only change by resolving.
revoke update on public.comment_threads from anon, authenticated;
grant update (resolved_at, resolved_by) on public.comment_threads to authenticated;
revoke update on public.comments from anon, authenticated;

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------

-- A new thread with its first comment, in one transaction. RLS applies.
create function public.start_comment_thread(
  p_board_id uuid, p_element_id text, p_x double precision, p_y double precision, p_body text
) returns uuid
language plpgsql security invoker
set search_path = ''
as $$
declare
  v_thread uuid;
begin
  insert into public.comment_threads (board_id, element_id, x, y)
  values (p_board_id, p_element_id, p_x, p_y)
  returning id into v_thread;

  insert into public.comments (thread_id, board_id, body)
  values (v_thread, p_board_id, p_body);

  return v_thread;
end;
$$;

revoke execute on function public.start_comment_thread(uuid, text, double precision, double precision, text)
  from public, anon;
grant execute on function public.start_comment_thread(uuid, text, double precision, double precision, text)
  to authenticated;

-- Every comment on a board, oldest first, with its thread and its author's
-- name and avatar. Security definer so collaborators see each other's names
-- without opening up profiles (like board_people).
create function public.board_comments(p_board_id uuid)
returns table (
  thread_id uuid, element_id text, x double precision, y double precision,
  thread_created_by uuid, thread_created_at timestamptz,
  resolved_at timestamptz, resolved_by uuid,
  comment_id uuid, author_id uuid, author_name text, author_avatar_url text,
  body text, created_at timestamptz
)
language sql stable security definer
set search_path = ''
as $$
  select t.id, t.element_id, t.x, t.y,
         t.created_by, t.created_at,
         t.resolved_at, t.resolved_by,
         c.id, c.author_id, p.display_name, p.avatar_url,
         c.body, c.created_at
    from public.comment_threads t
    join public.comments c on c.thread_id = t.id
    left join public.profiles p on p.id = c.author_id
   where t.board_id = p_board_id
     and public.can_edit_board(p_board_id)
   order by t.created_at, t.id, c.created_at, c.id;
$$;

revoke execute on function public.board_comments(uuid) from public, anon;
grant execute on function public.board_comments(uuid) to authenticated;
