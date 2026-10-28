-- Board snapshots (FEATURES.md AI-5): the Claude connector saves the scene
-- before it tidies, deletes or restores, so "put it back" works. The owner
-- and editors read and save them; only the newest 20 per board are kept.

create table public.board_snapshots (
  id         uuid primary key default gen_random_uuid(),
  board_id   uuid not null references public.boards(id) on delete cascade,
  created_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
  reason     text not null check (char_length(reason) between 1 and 200),
  scene      jsonb not null,
  app_state  jsonb not null default '{}'::jsonb,
  -- clock_timestamp(), not now(): several snapshots in one transaction still
  -- get an order, and the trim keeps the newest.
  created_at timestamptz not null default clock_timestamp()
);
create index board_snapshots_board_created_idx on public.board_snapshots (board_id, created_at desc);
create index board_snapshots_created_by_idx on public.board_snapshots (created_by);

alter table public.board_snapshots enable row level security;

create policy "collaborators can read" on public.board_snapshots
  for select to authenticated
  using (public.can_edit_board(board_id));

create policy "collaborators can save" on public.board_snapshots
  for insert to authenticated
  with check (created_by = (select auth.uid()) and public.can_edit_board(board_id));

-- Snapshots are a record: nobody edits or deletes them by hand.
revoke update, delete on public.board_snapshots from anon, authenticated;

-- Keeps the newest 20 per board.
create function public.trim_board_snapshots()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.board_snapshots
   where board_id = new.board_id
     and id not in (
       select id from public.board_snapshots
        where board_id = new.board_id
        order by created_at desc, id desc
        limit 20
     );
  return null;
end;
$$;

revoke execute on function public.trim_board_snapshots() from public, anon, authenticated;

create trigger board_snapshots_trim
  after insert on public.board_snapshots
  for each row execute function public.trim_board_snapshots();
