-- save_board: optimistic concurrency (SAVE-4) and the rules in tech §5.
begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.com', '{}');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);

insert into public.boards (id) values ('aaaaaaaa-0000-0000-0000-000000000001');

select is(
  (select title from public.boards where id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  'Untitled board', 'new boards are titled "Untitled board"');
select is(
  (select version from public.boards where id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  1, 'new boards start at version 1');

select is(
  public.save_board('aaaaaaaa-0000-0000-0000-000000000001', 1,
                    '{"elements":[{"id":"r1","type":"rectangle"}]}', '{"viewBackgroundColor":"#ffffff"}'),
  2, 'saving with the expected version returns the new version');
select is(
  (select scene -> 'elements' -> 0 ->> 'id' from public.boards where id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  'r1', 'the scene is stored');
select is(
  public.save_board('aaaaaaaa-0000-0000-0000-000000000001', 1, '{"elements":[]}', '{}'),
  null, 'a stale version is a conflict (null)');
select is(
  (select scene -> 'elements' -> 0 ->> 'id' from public.boards where id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  'r1', 'a conflicting save changes nothing');
select is(
  public.save_board('bbbbbbbb-0000-0000-0000-000000000009', 1, '{"elements":[]}', '{}'),
  null, 'an unknown board returns null');

-- Renames, thumbnails and soft delete never bump version (DASH-3).
update public.boards set title = 'Sprint map' where id = 'aaaaaaaa-0000-0000-0000-000000000001';
update public.boards set thumbnail_path = '11111111-1111-1111-1111-111111111111/aaaaaaaa-0000-0000-0000-000000000001.webp'
  where id = 'aaaaaaaa-0000-0000-0000-000000000001';
select is(
  (select version from public.boards where id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  2, 'renames and thumbnail updates do not bump version');
select is(
  public.save_board('aaaaaaaa-0000-0000-0000-000000000001', 2, '{"elements":[]}', '{}'),
  3, 'so a save after a rename is not a conflict');

select throws_ok(
  $$ update public.boards set title = '' where id = 'aaaaaaaa-0000-0000-0000-000000000001' $$,
  '23514', null, 'titles must be at least 1 character');
select throws_ok(
  $$ update public.boards set title = repeat('x', 201) where id = 'aaaaaaaa-0000-0000-0000-000000000001' $$,
  '23514', null, 'titles are at most 200 characters');

-- Trashed boards can't be saved (DASH-4).
update public.boards set deleted_at = now() where id = 'aaaaaaaa-0000-0000-0000-000000000001';
select is(
  public.save_board('aaaaaaaa-0000-0000-0000-000000000001', 3, '{"elements":[]}', '{}'),
  null, 'a trashed board cannot be saved');
select is(
  (select version from public.boards where id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  3, 'trashing does not bump version');

select * from finish();
rollback;
