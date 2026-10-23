-- Comments (CMT-1): who can read, start, reply, resolve and delete.
-- Run with `supabase test db`.
begin;
create extension if not exists pgtap with schema extensions;
select plan(31);

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.com', '{}'),
  ('22222222-2222-2222-2222-222222222222', 'bob@example.com', '{}'),
  ('33333333-3333-3333-3333-333333333333', 'carol@example.com', '{}');

-- Alice owns a board with an edit link; Bob joins; Bob owns a board of his own.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
insert into public.boards (id, title) values ('aaaaaaaa-0000-0000-0000-000000000001', 'Team map');
insert into public.board_edit_links (board_id, token)
  values ('aaaaaaaa-0000-0000-0000-000000000001', 'EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE');

select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
select public.join_board('EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE');
insert into public.boards (id, title) values ('bbbbbbbb-0000-0000-0000-000000000002', 'Bob''s notes');

-- Starting threads and replying ------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
select isnt(
  public.start_comment_thread('aaaaaaaa-0000-0000-0000-000000000001', 'shape-1', 10, 20, 'Is this right?'),
  null, 'the owner starts a thread on a shape');
select is((select count(*) from public.comments)::int, 1, 'a new thread comes with its first comment');
select is((select created_by from public.comment_threads), '11111111-1111-1111-1111-111111111111'::uuid,
  'the thread is started in my name');

select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
select lives_ok(
  $$ insert into public.comments (thread_id, board_id, body)
     select id, board_id, 'Looks good' from public.comment_threads where element_id = 'shape-1' $$,
  'an editor replies');
select isnt(
  public.start_comment_thread('aaaaaaaa-0000-0000-0000-000000000001', null, 300, 400, 'Pin here'),
  null, 'an editor starts a thread on a spot');
select is((select count(*) from public.board_comments('aaaaaaaa-0000-0000-0000-000000000001'))::int, 3,
  'an editor reads every comment on the board');
select is(
  (select author_name from public.board_comments('aaaaaaaa-0000-0000-0000-000000000001') where body = 'Looks good'),
  'bob', 'comments come with their author''s name');
select results_eq(
  $$ select body from public.board_comments('aaaaaaaa-0000-0000-0000-000000000001') $$,
  $$ values ('Is this right?'), ('Looks good'), ('Pin here') $$,
  'comments come thread by thread, oldest first');

-- What nobody may do ------------------------------------------------------------------
select throws_ok(
  $$ insert into public.comments (thread_id, board_id, author_id, body)
     select id, board_id, '11111111-1111-1111-1111-111111111111', 'Fake'
       from public.comment_threads where element_id = 'shape-1' $$,
  '42501', null, 'nobody comments in someone else''s name');
select throws_ok(
  $$ insert into public.comments (thread_id, board_id, body)
     select id, board_id, '   ' from public.comment_threads where element_id = 'shape-1' $$,
  '23514', null, 'a blank comment is refused');
select throws_ok(
  $$ insert into public.comments (thread_id, board_id, body)
     select id, 'bbbbbbbb-0000-0000-0000-000000000002', 'Wrong board'
       from public.comment_threads where element_id = 'shape-1' $$,
  '23503', null, 'a reply always lands on its thread''s board');
select throws_ok(
  $$ select public.start_comment_thread('aaaaaaaa-0000-0000-0000-000000000001', null, 'NaN', 0, 'Nowhere') $$,
  '23514', null, 'a pin needs a real position');
select throws_ok(
  $$ update public.comment_threads set x = 0 $$,
  '42501', null, 'pins don''t move');
select throws_ok(
  $$ update public.comments set body = 'Changed' $$,
  '42501', null, 'comments aren''t edited');

-- Resolving -----------------------------------------------------------------------------
select lives_ok(
  $$ update public.comment_threads set resolved_at = now(), resolved_by = '22222222-2222-2222-2222-222222222222'
      where element_id = 'shape-1' $$,
  'an editor resolves someone else''s thread');
select is((select resolved_by from public.comment_threads where element_id = 'shape-1'),
  '22222222-2222-2222-2222-222222222222'::uuid, 'and it says who resolved it');
select throws_ok(
  $$ update public.comment_threads set resolved_by = '11111111-1111-1111-1111-111111111111'
      where element_id = 'shape-1' $$,
  '42501', null, 'nobody resolves in someone else''s name');
select lives_ok(
  $$ update public.comment_threads set resolved_at = null, resolved_by = null where element_id = 'shape-1' $$,
  'an editor reopens a thread');

-- Deleting -----------------------------------------------------------------------------
select is_empty(
  $$ delete from public.comments where body = 'Is this right?' returning 1 $$,
  'an editor can''t delete someone else''s comment');
select isnt_empty(
  $$ delete from public.comments where body = 'Looks good' returning 1 $$,
  'an editor deletes their own reply');
select is_empty(
  $$ delete from public.comment_threads where element_id = 'shape-1' returning 1 $$,
  'an editor can''t delete a thread someone else started');

select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
select isnt_empty(
  $$ delete from public.comment_threads where element_id is null returning 1 $$,
  'the owner deletes any thread');
select is((select count(*) from public.comments where body = 'Pin here')::int, 0,
  'deleting a thread deletes its comments');

-- Outsiders -----------------------------------------------------------------------------
select set_config('test.thread', (select id::text from public.comment_threads where element_id = 'shape-1'), true);
select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
select is_empty($$ select * from public.board_comments('aaaaaaaa-0000-0000-0000-000000000001') $$,
  'an outsider reads no comments');
select is((select count(*) from public.comment_threads)::int, 0, 'an outsider sees no threads');
select throws_ok(
  $$ select public.start_comment_thread('aaaaaaaa-0000-0000-0000-000000000001', null, 0, 0, 'Hi') $$,
  '42501', null, 'an outsider can''t start a thread');
select throws_ok(
  $$ insert into public.comments (thread_id, board_id, body)
     values (current_setting('test.thread')::uuid, 'aaaaaaaa-0000-0000-0000-000000000001', 'Hi') $$,
  '42501', null, 'an outsider can''t reply, even knowing the thread');

-- Bob is removed from the board: he no longer sees its comments.
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
delete from public.board_members where user_id = '22222222-2222-2222-2222-222222222222';
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
select is_empty($$ select * from public.board_comments('aaaaaaaa-0000-0000-0000-000000000001') $$,
  'a removed editor reads no comments');

-- Signed out: nothing at all.
set local role anon;
select throws_ok(
  $$ select * from public.board_comments('aaaaaaaa-0000-0000-0000-000000000001') $$,
  '42501', null, 'signed-out visitors can''t read comments');

-- Deleting the board deletes its comments.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
delete from public.boards where id = 'aaaaaaaa-0000-0000-0000-000000000001';
reset role;
select is((select count(*) from public.comment_threads
             where board_id = 'aaaaaaaa-0000-0000-0000-000000000001')::int, 0,
  'deleting a board deletes its threads');
select is((select count(*) from public.comments
             where board_id = 'aaaaaaaa-0000-0000-0000-000000000001')::int, 0,
  'and their comments');

select * from finish();
rollback;
