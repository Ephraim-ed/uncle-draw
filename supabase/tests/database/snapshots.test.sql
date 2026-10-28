-- Board snapshots (AI-5): saved before the Claude connector tidies, deletes
-- or restores, so a board can be put back. Run with `supabase test db`.
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.com', '{}'),
  ('22222222-2222-2222-2222-222222222222', 'bob@example.com', '{}'),
  ('33333333-3333-3333-3333-333333333333', 'carol@example.com', '{}');

-- Alice owns a board with an edit link; Bob joins it; Carol is a stranger.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
insert into public.boards (id, title) values ('aaaaaaaa-0000-0000-0000-000000000001', 'Team map');
insert into public.board_edit_links (board_id, token)
  values ('aaaaaaaa-0000-0000-0000-000000000001', 'EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE');
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
select public.join_board('EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE');

-- The owner -------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
select lives_ok(
  $$ insert into public.board_snapshots (board_id, reason, scene)
     values ('aaaaaaaa-0000-0000-0000-000000000001', 'Before tidying', '{"elements":[]}') $$,
  'the owner can save a snapshot');
select is((select count(*) from public.board_snapshots)::int, 1, 'the owner can read it');
select is((select created_by from public.board_snapshots), '11111111-1111-1111-1111-111111111111'::uuid,
  'it is saved in her name');
select is((select app_state from public.board_snapshots), '{}'::jsonb, 'app_state defaults to empty');

-- An editor -------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
select lives_ok(
  $$ insert into public.board_snapshots (board_id, reason, scene)
     values ('aaaaaaaa-0000-0000-0000-000000000001', 'Before deleting', '{"elements":[]}') $$,
  'an editor can save a snapshot');
select is((select count(*) from public.board_snapshots)::int, 2, 'an editor can read the board''s snapshots');
select throws_ok(
  $$ insert into public.board_snapshots (board_id, reason, scene, created_by)
     values ('aaaaaaaa-0000-0000-0000-000000000001', 'Spoofed', '{"elements":[]}',
             '11111111-1111-1111-1111-111111111111') $$,
  '42501', null, 'created_by cannot be spoofed');
select throws_ok(
  $$ update public.board_snapshots set reason = 'changed' $$,
  '42501', null, 'snapshots cannot be edited');
select throws_ok(
  $$ delete from public.board_snapshots $$,
  '42501', null, 'snapshots cannot be deleted by hand');

-- A stranger ------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
select is((select count(*) from public.board_snapshots)::int, 0, 'a stranger sees no snapshots');
select throws_ok(
  $$ insert into public.board_snapshots (board_id, reason, scene)
     values ('aaaaaaaa-0000-0000-0000-000000000001', 'Sneaky', '{"elements":[]}') $$,
  '42501', null, 'a stranger cannot save a snapshot');

-- Only the newest 20 are kept -------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
insert into public.board_snapshots (board_id, reason, scene)
  select 'aaaaaaaa-0000-0000-0000-000000000001', 'Snapshot ' || n, '{"elements":[]}'
    from generate_series(1, 19) as n;
select is((select count(*) from public.board_snapshots)::int, 20, '21 snapshots in, 20 kept');
select is_empty(
  $$ select 1 from public.board_snapshots where reason = 'Before tidying' $$,
  'the oldest one is gone');
select isnt_empty(
  $$ select 1 from public.board_snapshots where reason = 'Snapshot 19' $$,
  'the newest one is kept');

select * from finish();
rollback;
