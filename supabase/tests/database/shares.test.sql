-- Share links: one active link per board, rotation in one step (SHARE-1, SHARE-3).
begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.com', '{}');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);

insert into public.boards (id) values ('aaaaaaaa-0000-0000-0000-000000000001');
insert into public.board_shares (board_id, token)
  values ('aaaaaaaa-0000-0000-0000-000000000001', 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');

select throws_ok(
  $$ insert into public.board_shares (board_id, token)
     values ('aaaaaaaa-0000-0000-0000-000000000001', 'CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC') $$,
  '23505', null, 'only one active link per board');
select throws_ok(
  $$ insert into public.board_shares (board_id, token)
     values ('aaaaaaaa-0000-0000-0000-000000000001', 'too-short') $$,
  '23514', null, 'tokens must be 43 base64url characters');

select is(
  (select token from public.rotate_board_share('aaaaaaaa-0000-0000-0000-000000000001',
                                               'DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD')),
  'DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD', 'rotate returns the new link');
select ok(
  (select revoked_at is not null from public.board_shares where token = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'),
  'rotate revokes the old link');
select is(
  (select count(*) from public.board_shares where revoked_at is null)::int,
  1, 'exactly one active link after rotating');
select is(
  (select created_by from public.board_shares where token = 'DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD'),
  '11111111-1111-1111-1111-111111111111'::uuid, 'created_by defaults to the caller');

update public.board_shares set revoked_at = now() where board_id = 'aaaaaaaa-0000-0000-0000-000000000001' and revoked_at is null;
select is((select count(*) from public.board_shares where revoked_at is null)::int, 0, 'stop sharing revokes the link');
select lives_ok(
  $$ insert into public.board_shares (board_id, token)
     values ('aaaaaaaa-0000-0000-0000-000000000001', 'EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE') $$,
  'a new link can be created after revoking');

select * from finish();
rollback;
