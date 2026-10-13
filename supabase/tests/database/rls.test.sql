-- RLS: one user can't read or modify another user's boards, files, shares or
-- storage objects (FEATURES.md §12). Run with `supabase test db`.
begin;
create extension if not exists pgtap with schema extensions;
select plan(31);

-- Users -----------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.com', '{}'),
  ('22222222-2222-2222-2222-222222222222', 'bob@example.com', '{}'),
  ('33333333-3333-3333-3333-333333333333', 'octo@example.com',
     '{"user_name":"octocat","name":"The Octocat","avatar_url":"https://avatars.example/octo.png"}');

-- Profiles (AUTH-5) --------------------------------------------------------------
select is(
  (select display_name from public.profiles where id = '11111111-1111-1111-1111-111111111111'),
  'alice', 'magic-link profile uses the part of the email before @');
select is(
  (select display_name from public.profiles where id = '33333333-3333-3333-3333-333333333333'),
  'The Octocat', 'GitHub profile uses the GitHub name');
select is(
  (select avatar_url from public.profiles where id = '33333333-3333-3333-3333-333333333333'),
  'https://avatars.example/octo.png', 'GitHub profile keeps the avatar');

-- Alice creates a board, a file row, a share link and storage objects ----------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);

insert into public.boards (id, title) values ('aaaaaaaa-0000-0000-0000-000000000001', 'Sprint map');
insert into public.board_files (board_id, file_id, storage_path, mime_type, size_bytes)
  values ('aaaaaaaa-0000-0000-0000-000000000001', 'file-1',
          '11111111-1111-1111-1111-111111111111/aaaaaaaa-0000-0000-0000-000000000001/file-1', 'image/png', 100);
insert into public.board_shares (board_id, token)
  values ('aaaaaaaa-0000-0000-0000-000000000001', 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
insert into storage.objects (bucket_id, name)
  values ('board-files', '11111111-1111-1111-1111-111111111111/aaaaaaaa-0000-0000-0000-000000000001/file-1');

select is((select count(*) from public.boards)::int, 1, 'alice sees her board');
select is(
  (select owner_id from public.boards where id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  '11111111-1111-1111-1111-111111111111'::uuid, 'owner_id defaults to the caller');
select is((select count(*) from public.profiles)::int, 1, 'alice sees only her own profile');

-- Bob ------------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);

select is((select count(*) from public.boards)::int, 0, 'bob cannot read alice''s boards');
select is((select count(*) from public.board_files)::int, 0, 'bob cannot read alice''s files');
select is((select count(*) from public.board_shares)::int, 0, 'bob cannot read alice''s shares');
select is((select count(*) from storage.objects where bucket_id = 'board-files')::int, 0,
  'bob cannot list alice''s storage objects');
select is((select count(*) from public.profiles where id = '11111111-1111-1111-1111-111111111111')::int, 0,
  'bob cannot read alice''s profile');

select is_empty(
  $$ update public.boards set title = 'hacked'
      where id = 'aaaaaaaa-0000-0000-0000-000000000001' returning 1 $$,
  'bob cannot rename alice''s board');
select is_empty(
  $$ delete from public.boards where id = 'aaaaaaaa-0000-0000-0000-000000000001' returning 1 $$,
  'bob cannot delete alice''s board');
select is_empty(
  $$ update public.boards set deleted_at = now()
      where id = 'aaaaaaaa-0000-0000-0000-000000000001' returning 1 $$,
  'bob cannot trash alice''s board');
select is(
  public.save_board('aaaaaaaa-0000-0000-0000-000000000001', 1, '{"elements":[]}', '{}'),
  null, 'bob cannot save over alice''s board');
select is_empty(
  $$ update public.board_shares set revoked_at = now() returning 1 $$,
  'bob cannot revoke alice''s share');

select throws_ok(
  $$ insert into public.boards (owner_id, title)
     values ('11111111-1111-1111-1111-111111111111', 'planted') $$,
  '42501', null, 'bob cannot create a board owned by alice');
select throws_ok(
  $$ insert into public.board_files (board_id, file_id, storage_path, mime_type, size_bytes)
     values ('aaaaaaaa-0000-0000-0000-000000000001', 'evil',
             '22222222-2222-2222-2222-222222222222/x/evil', 'image/png', 1) $$,
  '42501', null, 'bob cannot attach files to alice''s board');
select throws_ok(
  $$ insert into public.board_shares (board_id, token)
     values ('aaaaaaaa-0000-0000-0000-000000000001', 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB') $$,
  '42501', null, 'bob cannot share alice''s board');
select throws_ok(
  $$ insert into storage.objects (bucket_id, name)
     values ('board-files', '11111111-1111-1111-1111-111111111111/planted.png') $$,
  '42501', null, 'bob cannot write into alice''s storage folder');
select throws_ok(
  $$ insert into storage.objects (bucket_id, name)
     values ('thumbnails', '11111111-1111-1111-1111-111111111111/aaaaaaaa-0000-0000-0000-000000000001.webp') $$,
  '42501', null, 'bob cannot overwrite alice''s thumbnail');
select lives_ok(
  $$ insert into storage.objects (bucket_id, name)
     values ('thumbnails', '22222222-2222-2222-2222-222222222222/mine.webp') $$,
  'bob can write into his own folder');

-- Anonymous visitors -------------------------------------------------------------
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

select is((select count(*) from public.boards)::int, 0, 'anon cannot read boards');
select is((select count(*) from public.board_shares)::int, 0, 'anon cannot read share tokens');
select is((select count(*) from public.board_files)::int, 0, 'anon cannot read files');
select is((select count(*) from public.profiles)::int, 0, 'anon cannot read profiles');
select is((select count(*) from storage.objects where bucket_id in ('board-files', 'thumbnails'))::int, 0,
  'anon cannot list private storage');
select throws_ok(
  $$ insert into public.boards (title) values ('anon board') $$,
  '42501', null, 'anon cannot create boards');
select throws_ok(
  $$ select public.save_board('aaaaaaaa-0000-0000-0000-000000000001', 1, '{"elements":[]}', '{}') $$,
  '42501', null, 'anon cannot call save_board');

-- Back as alice: nothing of hers was touched ----------------------------------------
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
select is(
  (select title from public.boards where id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  'Sprint map', 'alice''s board is unchanged');
select is((select count(*) from public.board_shares where revoked_at is null)::int, 1,
  'alice''s share is still active');

select * from finish();
rollback;
