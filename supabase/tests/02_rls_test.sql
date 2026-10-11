-- Row level security: guest, author, another user, moderator; storage policies.
begin;
create extension if not exists pgtap with schema extensions;
select plan(27);

insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'author@test.invalid'),
  ('22222222-2222-4222-8222-222222222222', 'other@test.invalid'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'moderator@test.invalid');
insert into public.profiles (id, nickname, pd_consent_at, role) values
  ('11111111-1111-4111-8111-111111111111', 'автор_теста', now(), 'user'),
  ('22222222-2222-4222-8222-222222222222', 'сосед', now(), 'user'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'модератор', now(), 'moderator');
insert into public.complaints (id, author_id, category_id, title, lat, lng, address)
  values ('c0000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111',
          'road', 'Яма у первого подъезда', 56.0, 92.8, 'улица Тестовая, 1');
insert into storage.objects (bucket_id, name, owner) values
  ('photos', '11111111-1111-4111-8111-111111111111/c0000000-0000-4000-8000-000000000001/1.jpg', '11111111-1111-4111-8111-111111111111');
insert into public.complaint_photos (complaint_id, storage_path)
  values ('c0000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111/c0000000-0000-4000-8000-000000000001/1.jpg');

-- ---------- guest ----------
set local role anon;
set local "request.jwt.claims" to '{"role": "anon"}';

select is((select count(*)::int from public.complaints where is_demo), 14, 'guest sees published demo complaints (not the one on moderation)');
select is((select count(*)::int from public.complaints where id = 'c0000000-0000-4000-8000-000000000001'), 0, 'guest does not see a complaint on moderation');
select ok((select count(*) from public.complaint_feed) >= 14, 'guest can read complaint_feed');
select is((select count(*)::int from public.complaint_feed where supported_by_me or is_mine), 0, 'guest has no own or supported complaints');
select lives_ok('select nickname from public.profiles limit 1', 'guest can read nicknames');
select throws_ok('select pd_consent_at from public.profiles limit 1', '42501', null, 'guest cannot read other profile columns');
select throws_ok($$update public.complaints set status = 'resolved'$$, '42501', null, 'guest cannot update complaints');
select throws_ok($$select public.create_complaint(gen_random_uuid(), 'road', 'Заголовок теста', '', 56.0, 92.8, 'адрес', '', array['x'])$$,
  '42501', null, 'guest cannot call create_complaint');
select is((select count(*)::int from storage.objects where bucket_id = 'photos'), 0, 'guest cannot read photos of a complaint on moderation');
select lives_ok('select public.stats_summary()', 'guest can read statistics');

-- ---------- author ----------
reset role;
set local role authenticated;
set local "request.jwt.claims" to '{"sub": "11111111-1111-4111-8111-111111111111", "role": "authenticated"}';

select is((select count(*)::int from public.complaints where id = 'c0000000-0000-4000-8000-000000000001'), 1, 'author sees own complaint on moderation');
select ok((select is_mine from public.complaint_feed where id = 'c0000000-0000-4000-8000-000000000001'), 'feed marks it as mine');
select is((select count(*)::int from public.notifications), 1, 'author got the "sent to moderation" notification');
select is((select count(*)::int from storage.objects where bucket_id = 'photos'), 1, 'author reads own photo');
update public.complaints set status = 'published' where id = 'c0000000-0000-4000-8000-000000000001';
select throws_ok(
  $$insert into storage.objects (bucket_id, name) values ('photos', '22222222-2222-4222-8222-222222222222/x/1.jpg')$$,
  '42501', null, 'author cannot upload into another user''s folder');

reset role;
select is((select status::text from public.complaints where id = 'c0000000-0000-4000-8000-000000000001'),
  'moderation', 'author cannot change status directly');

-- ---------- another user ----------
set local role authenticated;
set local "request.jwt.claims" to '{"sub": "22222222-2222-4222-8222-222222222222", "role": "authenticated"}';

select is((select count(*)::int from public.complaints where id = 'c0000000-0000-4000-8000-000000000001'), 0, 'other user does not see it');
select is((select count(*)::int from public.notifications), 0, 'other user does not see author notifications');
update public.notifications set read_at = now();
select throws_ok(
  $$insert into public.supports (user_id, complaint_id) values ('22222222-2222-4222-8222-222222222222', 'c0000000-0000-4000-8000-000000000001')$$,
  '42501', null, 'cannot support a complaint on moderation');
select throws_ok(
  $$insert into public.supports (user_id, complaint_id) values ('11111111-1111-4111-8111-111111111111', '00000000-0000-4000-8000-000000000002')$$,
  '42501', null, 'cannot add a support on behalf of someone else');
select lives_ok(
  $$insert into public.supports (user_id, complaint_id) values ('22222222-2222-4222-8222-222222222222', '00000000-0000-4000-8000-000000000002')$$,
  'can support a published complaint');
select throws_ok($$select public.moderate_set_status('c0000000-0000-4000-8000-000000000001', 'published')$$,
  'P0001', null, 'regular user cannot moderate');

reset role;
select is((select count(*)::int from public.notifications where read_at is not null), 0, 'other user cannot mark author notifications as read');

-- ---------- moderator ----------
set local role authenticated;
set local "request.jwt.claims" to '{"sub": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "role": "authenticated"}';

select is((select count(*)::int from public.complaints where id = 'c0000000-0000-4000-8000-000000000001'), 1, 'moderator sees the moderation queue');
select is((select count(*)::int from storage.objects where bucket_id = 'photos'), 1, 'moderator sees photos on moderation');
select lives_ok($$select public.moderate_set_status('c0000000-0000-4000-8000-000000000001', 'published')$$, 'moderator publishes');

reset role;
select is((select actor_label || ' / ' || new_status from public.status_history
           where complaint_id = 'c0000000-0000-4000-8000-000000000001' order by id desc limit 1),
  'Модератор / published', 'history records the moderator action');

select * from finish();
rollback;
