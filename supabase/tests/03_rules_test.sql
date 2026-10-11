-- Server rules: creation and validation, hourly limit, supports, confirmations, notifications.
begin;
create extension if not exists pgtap with schema extensions;
select plan(33);

insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'author@test.invalid'),
  ('22222222-2222-4222-8222-222222222222', 'u2@test.invalid'),
  ('33333333-3333-4333-8333-333333333333', 'u3@test.invalid'),
  ('44444444-4444-4444-8444-444444444444', 'u4@test.invalid'),
  ('55555555-5555-4555-8555-555555555555', 'u5@test.invalid'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'moderator@test.invalid'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'blocked@test.invalid');
insert into public.profiles (id, nickname, pd_consent_at, role, is_blocked) values
  ('11111111-1111-4111-8111-111111111111', 'автор_теста', now(), 'user', false),
  ('22222222-2222-4222-8222-222222222222', 'житель_2', now(), 'user', false),
  ('33333333-3333-4333-8333-333333333333', 'житель_3', now(), 'user', false),
  ('44444444-4444-4444-8444-444444444444', 'житель_4', now(), 'user', false),
  ('55555555-5555-4555-8555-555555555555', 'житель_5', now(), 'user', false),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'модератор', now(), 'moderator', false),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'нарушитель', now(), 'user', true);
insert into storage.objects (bucket_id, name, owner, metadata)
select 'photos', '11111111-1111-4111-8111-111111111111/c0000000-0000-4000-8000-0000000000' || n || '/1.jpg',
       '11111111-1111-4111-8111-111111111111', '{"size": 120000}'
from unnest(array['01', '02', '03', '10', '11', '12', '13', '14']) as n;
insert into storage.objects (bucket_id, name, owner)
  values ('photos', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/c0000000-0000-4000-8000-000000000099/1.jpg', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');

-- ---------- creation by the author ----------
set local role authenticated;
set local "request.jwt.claims" to '{"sub": "11111111-1111-4111-8111-111111111111", "role": "authenticated"}';

select is(
  public.create_complaint('c0000000-0000-4000-8000-000000000001', 'road', '  Яма   на въезде во двор  ', 'Глубокая',
    56.0060, 92.8050, 'Сопочная улица, 54А', 'Октябрьский район',
    array['11111111-1111-4111-8111-111111111111/c0000000-0000-4000-8000-000000000001/1.jpg']),
  'c0000000-0000-4000-8000-000000000001'::uuid, 'create_complaint returns the client-generated id');
select results_eq(
  $$select status::text, supports_count, title, author_id from public.complaints where id = 'c0000000-0000-4000-8000-000000000001'$$,
  $$values ('moderation', 0, 'Яма на въезде во двор', '11111111-1111-4111-8111-111111111111'::uuid)$$,
  'new complaint is on moderation, title normalized, author set by the server');
select is((select count(*)::int from public.complaint_photos where complaint_id = 'c0000000-0000-4000-8000-000000000001'), 1, 'photo row registered');
select is((select size_bytes from public.complaint_photos where complaint_id = 'c0000000-0000-4000-8000-000000000001'), 120000, 'photo size taken from storage metadata');
select is((select comment from public.status_history where complaint_id = 'c0000000-0000-4000-8000-000000000001'), 'Обращение создано', 'history starts with creation');
select is(
  public.create_complaint('c0000000-0000-4000-8000-000000000001', 'road', 'Яма на въезде во двор', '', 56.0060, 92.8050, 'адрес', '',
    array['11111111-1111-4111-8111-111111111111/c0000000-0000-4000-8000-000000000001/1.jpg']),
  'c0000000-0000-4000-8000-000000000001'::uuid, 'retrying an offline draft is idempotent');
select is((select count(*)::int from public.complaints where author_id = '11111111-1111-4111-8111-111111111111'), 1, 'no duplicate row after retry');

select throws_like(
  $$select public.create_complaint('c0000000-0000-4000-8000-000000000002', 'road', 'Яма за городом', '', 55.50, 92.80, 'трасса', '',
      array['11111111-1111-4111-8111-111111111111/c0000000-0000-4000-8000-000000000002/1.jpg'])$$,
  'KGP_OUT_OF_CITY%', 'point outside the Krasnoyarsk bbox is rejected');
select throws_like(
  $$select public.create_complaint('c0000000-0000-4000-8000-000000000003', 'road', 'Яма', '', 56.0, 92.8, 'адрес', '',
      array['11111111-1111-4111-8111-111111111111/c0000000-0000-4000-8000-000000000003/1.jpg'])$$,
  'KGP_TITLE_LENGTH%', 'title shorter than 5 characters is rejected');
select throws_like(
  $$select public.create_complaint('c0000000-0000-4000-8000-000000000003', 'road', 'Заголовок нормальный', repeat('я', 501), 56.0, 92.8, 'адрес', '',
      array['11111111-1111-4111-8111-111111111111/c0000000-0000-4000-8000-000000000003/1.jpg'])$$,
  'KGP_DESCRIPTION_LENGTH%', 'description longer than 500 characters is rejected');
select throws_like(
  $$select public.create_complaint('c0000000-0000-4000-8000-000000000004', 'road', 'Без фотографии', '', 56.0, 92.8, 'адрес', '', array[]::text[])$$,
  'KGP_PHOTO_COUNT%', 'at least one photo is required');
select throws_like(
  $$select public.create_complaint('c0000000-0000-4000-8000-000000000005', 'road', 'Чужое фото тут', '', 56.0, 92.8, 'адрес', '',
      array['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/c0000000-0000-4000-8000-000000000099/1.jpg'])$$,
  'KGP_PHOTO_PATH%', 'photo of another user cannot be attached');

-- four more complaints reach the limit of 5 per hour
select lives_ok($$select public.create_complaint(('c0000000-0000-4000-8000-0000000000' || n)::uuid, 'trash', 'Свалка номер ' || n, '', 56.0 + n::int / 1000.0, 92.8, 'адрес', '',
    array['11111111-1111-4111-8111-111111111111/c0000000-0000-4000-8000-0000000000' || n || '/1.jpg'])
  from unnest(array['10', '11', '12', '13']) as n$$, 'five complaints within an hour are accepted');
select throws_like(
  $$select public.create_complaint('c0000000-0000-4000-8000-000000000014', 'trash', 'Шестая за час', '', 56.0, 92.8, 'адрес', '',
      array['11111111-1111-4111-8111-111111111111/c0000000-0000-4000-8000-000000000014/1.jpg'])$$,
  'KGP_RATE_LIMIT%', 'the sixth complaint within an hour is rejected');

-- ---------- blocked user ----------
set local "request.jwt.claims" to '{"sub": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "role": "authenticated"}';
select throws_like(
  $$select public.create_complaint('c0000000-0000-4000-8000-000000000099', 'road', 'Заблокированный автор', '', 56.0, 92.8, 'адрес', '',
      array['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/c0000000-0000-4000-8000-000000000099/1.jpg'])$$,
  'KGP_NOT_ALLOWED%', 'blocked user cannot create complaints');

-- ---------- moderator publishes ----------
set local "request.jwt.claims" to '{"sub": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "role": "authenticated"}';
do $$ begin perform public.moderate_set_status('c0000000-0000-4000-8000-000000000001', 'published'); end $$;

-- ---------- supports ----------
set local "request.jwt.claims" to '{"sub": "22222222-2222-4222-8222-222222222222", "role": "authenticated"}';
select is(public.set_support('c0000000-0000-4000-8000-000000000001', true), 1, 'support increments the counter');
select is(public.set_support('c0000000-0000-4000-8000-000000000001', true), 1, 'second support by the same user is ignored');
select is(public.set_support('c0000000-0000-4000-8000-000000000001', false), 0, 'support can be withdrawn');
select is(public.set_support('c0000000-0000-4000-8000-000000000001', true), 1, 'and given again');
select ok((select supported_by_me from public.complaint_feed where id = 'c0000000-0000-4000-8000-000000000001'), 'feed shows supported_by_me');

set local "request.jwt.claims" to '{"sub": "11111111-1111-4111-8111-111111111111", "role": "authenticated"}';
select throws_like($$select public.set_support('c0000000-0000-4000-8000-000000000001', true)$$, 'KGP_OWN%', 'author cannot support own complaint');
select ok((select count(*) from public.notifications where text like '%опубликовано на карте%') = 1, 'author is notified about publication');

-- ---------- status change notifies author and supporters ----------
set local "request.jwt.claims" to '{"sub": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "role": "authenticated"}';
do $$ begin perform public.moderate_set_status('c0000000-0000-4000-8000-000000000001', 'work'); end $$;
set local "request.jwt.claims" to '{"sub": "22222222-2222-4222-8222-222222222222", "role": "authenticated"}';
select is((select text from public.notifications order by created_at desc limit 1),
  'Поддержанное вами обращение «Яма на въезде во двор»: в работе', 'supporter is notified about the status change');

-- ---------- three confirmations resolve ----------
select is((public.confirm_resolution('c0000000-0000-4000-8000-000000000001', true) ->> 'status'), 'resolved_wait',
  'first "Решено" moves the complaint to resolved_wait');
set local "request.jwt.claims" to '{"sub": "33333333-3333-4333-8333-333333333333", "role": "authenticated"}';
select is((public.confirm_resolution('c0000000-0000-4000-8000-000000000001', true) ->> 'confirms_count'), '2', 'second confirmation');
set local "request.jwt.claims" to '{"sub": "44444444-4444-4444-8444-444444444444", "role": "authenticated"}';
select is((public.confirm_resolution('c0000000-0000-4000-8000-000000000001', true) ->> 'status'), 'resolved',
  'third confirmation resolves the complaint');
select ok((select confirmed_by_me from public.complaint_feed where id = 'c0000000-0000-4000-8000-000000000001'), 'feed shows confirmed_by_me');

reset role;
select is((select actor_label from public.status_history where complaint_id = 'c0000000-0000-4000-8000-000000000001'
           and new_status = 'resolved'), 'Жители', 'resolution is attributed to residents');
select ok((select resolved_at is not null from public.complaints where id = 'c0000000-0000-4000-8000-000000000001'), 'resolved_at is set');

-- ---------- "Не решено" ----------
set local role authenticated;
set local "request.jwt.claims" to '{"sub": "55555555-5555-4555-8555-555555555555", "role": "authenticated"}';
select throws_like($$select public.confirm_resolution('00000000-0000-4000-8000-000000000001', false)$$, 'KGP_STATUS%',
  '"Не решено" is only allowed for resolved_wait');
select is(public.confirm_resolution('00000000-0000-4000-8000-000000000004', false),
  '{"status": "published", "confirms_count": 0}'::jsonb, '"Не решено" returns the complaint to published and resets confirmations');
select is(public.confirm_resolution('00000000-0000-4000-8000-000000000004', true) ->> 'confirms_count', '1',
  'confirmations start over after "Не решено"');
select throws_like($$select public.confirm_resolution('00000000-0000-4000-8000-000000000005', true)$$, 'KGP_STATUS%',
  'an already resolved complaint cannot be confirmed again');

select * from finish();
rollback;
