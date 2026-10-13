-- Collaboration (COLLAB-1…3): edit links, editor rights, and what stays
-- owner-only. Run with `supabase test db`.
begin;
create extension if not exists pgtap with schema extensions;
select plan(44);

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.com', '{}'),
  ('22222222-2222-2222-2222-222222222222', 'bob@example.com', '{}'),
  ('33333333-3333-3333-3333-333333333333', 'carol@example.com', '{}');

-- Alice: a board with a file, a thumbnail and an edit link -----------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);

insert into public.boards (id, title, thumbnail_path) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Team map',
   '11111111-1111-1111-1111-111111111111/aaaaaaaa-0000-0000-0000-000000000001.webp');
insert into public.board_files (board_id, file_id, storage_path, mime_type, size_bytes)
  values ('aaaaaaaa-0000-0000-0000-000000000001', 'file-1',
          '11111111-1111-1111-1111-111111111111/aaaaaaaa-0000-0000-0000-000000000001/file-1', 'image/png', 100);
insert into storage.objects (bucket_id, name) values
  ('board-files', '11111111-1111-1111-1111-111111111111/aaaaaaaa-0000-0000-0000-000000000001/file-1'),
  ('board-files', '11111111-1111-1111-1111-111111111111/other/private.png'),
  ('thumbnails', '11111111-1111-1111-1111-111111111111/aaaaaaaa-0000-0000-0000-000000000001.webp');
insert into public.board_edit_links (board_id, token)
  values ('aaaaaaaa-0000-0000-0000-000000000001', 'EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE');

select is(public.join_board('EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE'),
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid, 'the owner opening her own edit link just gets the board');
select is((select count(*) from public.board_members)::int, 0, 'the owner is not added as a member');

-- Carol: no link, no access ---------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
select is((select count(*) from public.boards)::int, 0, 'an outsider cannot read the board');
select is((select count(*) from public.board_edit_links)::int, 0, 'an outsider cannot read edit links');
select is(public.join_board('ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ'), null, 'an unknown token joins nothing');
select is(public.join_board('short'), null, 'a malformed token joins nothing');
select is_empty($$ select * from public.board_people('aaaaaaaa-0000-0000-0000-000000000001') $$,
  'an outsider cannot list the people on a board');
select is(public.can_edit_board('aaaaaaaa-0000-0000-0000-000000000001'), false, 'an outsider cannot edit');

-- Bob joins with the link -------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
select is(public.join_board('EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE'),
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid, 'the edit link returns the board');
select is(public.join_board('EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE'),
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid, 'joining twice is fine');
select is((select count(*) from public.board_members)::int, 1, 'bob is a member once');
select is((select role from public.board_members), 'editor', 'members are editors');

select is((select title from public.boards where id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  'Team map', 'an editor can read the board');
select is(public.can_edit_board('aaaaaaaa-0000-0000-0000-000000000001'), true, 'an editor can edit');
select is(
  public.save_board('aaaaaaaa-0000-0000-0000-000000000001', 1,
                    '{"elements":[{"id":"b1","type":"ellipse"}]}', '{}'),
  2, 'an editor can save the drawing');

-- Owner-only things
select is_empty(
  $$ update public.boards set title = 'hijacked'
      where id = 'aaaaaaaa-0000-0000-0000-000000000001' returning 1 $$,
  'an editor cannot rename');
select is_empty(
  $$ update public.boards set deleted_at = now()
      where id = 'aaaaaaaa-0000-0000-0000-000000000001' returning 1 $$,
  'an editor cannot trash');
select is_empty(
  $$ update public.boards set owner_id = '22222222-2222-2222-2222-222222222222'
      where id = 'aaaaaaaa-0000-0000-0000-000000000001' returning 1 $$,
  'an editor cannot take ownership');
select is_empty(
  $$ delete from public.boards where id = 'aaaaaaaa-0000-0000-0000-000000000001' returning 1 $$,
  'an editor cannot delete');
select is((select count(*) from public.board_edit_links)::int, 0, 'an editor cannot read the edit link');
select throws_ok(
  $$ insert into public.board_shares (board_id, token)
     values ('aaaaaaaa-0000-0000-0000-000000000001', 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB') $$,
  '42501', null, 'an editor cannot create view links');
select throws_ok(
  $$ insert into public.board_edit_links (board_id, token)
     values ('aaaaaaaa-0000-0000-0000-000000000001', 'CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC') $$,
  '42501', null, 'an editor cannot create edit links');

-- Files and thumbnails
select is((select count(*) from public.board_files)::int, 1, 'an editor sees the board''s files');
select is(
  (select count(*) from storage.objects where bucket_id = 'board-files')::int, 1,
  'an editor can read the board''s images, and only those');
select is(
  (select count(*) from storage.objects where bucket_id = 'thumbnails')::int, 1,
  'an editor can read the board''s thumbnail');
select lives_ok(
  $$ insert into public.board_files (board_id, file_id, storage_path, mime_type, size_bytes)
     values ('aaaaaaaa-0000-0000-0000-000000000001', 'file-2',
             '22222222-2222-2222-2222-222222222222/aaaaaaaa-0000-0000-0000-000000000001/file-2', 'image/png', 1) $$,
  'an editor can add images');
select throws_ok(
  $$ insert into public.board_files (board_id, file_id, owner_id, storage_path, mime_type, size_bytes)
     values ('aaaaaaaa-0000-0000-0000-000000000001', 'file-3', '11111111-1111-1111-1111-111111111111',
             '11111111-1111-1111-1111-111111111111/x/file-3', 'image/png', 1) $$,
  '42501', null, 'an editor cannot add files in the owner''s name');
select lives_ok(
  $$ select public.set_board_thumbnail('aaaaaaaa-0000-0000-0000-000000000001',
       '11111111-1111-1111-1111-111111111111/elsewhere.webp') $$,
  'a thumbnail path outside my folder is ignored');
select is((select thumbnail_path from public.boards where id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  '11111111-1111-1111-1111-111111111111/aaaaaaaa-0000-0000-0000-000000000001.webp',
  '…and leaves the thumbnail unchanged');
select public.set_board_thumbnail('aaaaaaaa-0000-0000-0000-000000000001',
  '22222222-2222-2222-2222-222222222222/aaaaaaaa-0000-0000-0000-000000000001.webp');
select is((select thumbnail_path from public.boards where id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  '22222222-2222-2222-2222-222222222222/aaaaaaaa-0000-0000-0000-000000000001.webp',
  'an editor can set a thumbnail from their own folder');

-- People list
select is(
  (select array_agg(role) from public.board_people('aaaaaaaa-0000-0000-0000-000000000001')),
  array['owner', 'editor'], 'the people list shows the owner first, then editors');
select is(
  (select display_name from public.board_people('aaaaaaaa-0000-0000-0000-000000000001') where role = 'owner'),
  'alice', 'the people list includes display names');

-- Realtime channel topic
select is(public.board_id_from_topic('board:aaaaaaaa-0000-0000-0000-000000000001'),
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid, 'board topics map to their board');
select is(public.board_id_from_topic('board:nope'), null, 'other topics map to nothing');
select ok(
  (select count(*) from pg_policies
    where schemaname = 'realtime' and tablename = 'messages'
      and policyname in ('board collaborators can listen', 'board collaborators can send')) = 2,
  'realtime channel policies exist');

-- Bob leaves ------------------------------------------------------------------------
delete from public.board_members where user_id = '22222222-2222-2222-2222-222222222222';
select is((select count(*) from public.boards)::int, 0, 'after leaving, the board is gone for bob');
select is(
  public.save_board('aaaaaaaa-0000-0000-0000-000000000001', 2, '{"elements":[]}', '{}'),
  null, 'after leaving, bob cannot save');

-- Alice manages the link and removes people ----------------------------------------------
select public.join_board('EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE'); -- bob rejoins
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
select is((select count(*) from public.board_members)::int, 1, 'the owner sees her board''s members');
select is_empty(
  $$ delete from public.board_members where user_id = '33333333-3333-3333-3333-333333333333' returning 1 $$,
  'removing someone who is not a member does nothing');
delete from public.board_members where user_id = '22222222-2222-2222-2222-222222222222';
select is((select count(*) from public.board_members)::int, 0, 'the owner can remove an editor');

select is(
  (select token from public.rotate_board_edit_link('aaaaaaaa-0000-0000-0000-000000000001',
                                                   'FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF')),
  'FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF', 'the owner can get a new edit link');
select is((select count(*) from public.board_edit_links where revoked_at is null)::int, 1,
  'only the new edit link is active');

-- Carol tries the old link, then the new one on a trashed board
select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
select is(public.join_board('EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE'), null, 'a replaced link no longer works');

select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
update public.boards set deleted_at = now() where id = 'aaaaaaaa-0000-0000-0000-000000000001';
select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
select is(public.join_board('FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF'), null, 'a trashed board cannot be joined');

select * from finish();
rollback;
