-- Moderation, duplicates, "after" photos, reports, profile onboarding, nearby duplicates and statistics.
begin;
create extension if not exists pgtap with schema extensions;
select plan(27);

insert into auth.users (id, email, is_anonymous) values
  ('11111111-1111-4111-8111-111111111111', 'author@test.invalid', false),
  ('22222222-2222-4222-8222-222222222222', 'u2@test.invalid', false),
  ('66666666-6666-4666-8666-666666666666', null, true),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'moderator@test.invalid', false),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'admin@test.invalid', false);
insert into public.profiles (id, nickname, pd_consent_at, role) values
  ('11111111-1111-4111-8111-111111111111', 'автор_теста', now(), 'user'),
  ('22222222-2222-4222-8222-222222222222', 'сосед', now(), 'user'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'модератор', now(), 'moderator'),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'админ', now(), 'admin');
insert into public.complaints (id, author_id, category_id, title, lat, lng, address, status) values
  ('c0000000-0000-4000-8000-000000000010', '11111111-1111-4111-8111-111111111111', 'road', 'Опубликованная яма', 56.01, 92.81, 'адрес 10', 'published'),
  ('c0000000-0000-4000-8000-000000000011', '11111111-1111-4111-8111-111111111111', 'road', 'Та же яма ещё раз', 56.0102, 92.8130, 'адрес 11', 'moderation');
insert into storage.objects (bucket_id, name, owner) values
  ('photos', '11111111-1111-4111-8111-111111111111/c0000000-0000-4000-8000-000000000010/after-1.jpg', '11111111-1111-4111-8111-111111111111');

set local role authenticated;

-- ---------- author marks "Передано" ----------
set local "request.jwt.claims" to '{"sub": "22222222-2222-4222-8222-222222222222", "role": "authenticated"}';
select throws_like($$select public.author_mark_sent('c0000000-0000-4000-8000-000000000010')$$, 'KGP_NOT_ALLOWED%', 'only the author can mark "Передано"');
set local "request.jwt.claims" to '{"sub": "11111111-1111-4111-8111-111111111111", "role": "authenticated"}';
select lives_ok($$select public.author_mark_sent('c0000000-0000-4000-8000-000000000010')$$, 'author marks the complaint as sent');
select is((select status::text from public.complaints where id = 'c0000000-0000-4000-8000-000000000010'), 'sent', 'status is sent');

-- ---------- "after" photo ----------
select lives_ok($$select public.add_after_photo('c0000000-0000-4000-8000-000000000010',
  '11111111-1111-4111-8111-111111111111/c0000000-0000-4000-8000-000000000010/after-1.jpg')$$, 'author adds an "after" photo');
select is((select status::text from public.complaints where id = 'c0000000-0000-4000-8000-000000000010'), 'resolved_wait', '"after" photo moves to resolved_wait');

set local "request.jwt.claims" to '{"role": "anon"}';
set local role anon;
select is((select count(*)::int from public.complaint_photos where kind = 'after'), 0, 'unapproved "after" photo is not public');

set local role authenticated;
set local "request.jwt.claims" to '{"sub": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "role": "authenticated"}';
select lives_ok($$select public.moderate_review_after_photo(
  (select id from public.complaint_photos where kind = 'after' and complaint_id = 'c0000000-0000-4000-8000-000000000010'), true)$$,
  'moderator approves the "after" photo');
select is((select status::text from public.complaints where id = 'c0000000-0000-4000-8000-000000000010'), 'resolved', 'approved "after" photo resolves the complaint');

-- ---------- duplicates ----------
select throws_like($$select public.moderate_set_status('c0000000-0000-4000-8000-000000000011', 'duplicate')$$, 'KGP_STATUS%',
  'duplicate status is set only by merging');
select lives_ok($$select public.moderate_mark_duplicate('c0000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000009')$$,
  'moderator merges a duplicate');
select results_eq(
  $$select status::text, duplicate_of from public.complaints where id = 'c0000000-0000-4000-8000-000000000011'$$,
  $$values ('duplicate', '00000000-0000-4000-8000-000000000009'::uuid)$$, 'duplicate is linked to the original');
select is((select count(*)::int from public.supports where complaint_id = '00000000-0000-4000-8000-000000000009'
           and user_id = '11111111-1111-4111-8111-111111111111'), 1, 'author of the duplicate becomes a supporter of the original');
select is((select supports_count from public.complaints where id = '00000000-0000-4000-8000-000000000009'), 64, 'original support counter grows');

-- ---------- reports ----------
set local "request.jwt.claims" to '{"sub": "22222222-2222-4222-8222-222222222222", "role": "authenticated"}';
select lives_ok($$select public.report_complaint('00000000-0000-4000-8000-000000000008', 'Недостоверная информация')$$, 'user reports a complaint');
select is((select count(*)::int from public.report_feed), 1, 'reporter sees own report');
set local "request.jwt.claims" to '{"sub": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "role": "authenticated"}';
select lives_ok($$select public.moderate_resolve_report((select id from public.reports limit 1), 'Фото не соответствует', true)$$,
  'moderator hides the complaint by report');
select is((select status::text from public.complaints where id = '00000000-0000-4000-8000-000000000008'), 'rejected', 'hidden complaint is rejected');

-- ---------- administration ----------
select throws_like($$select public.admin_set_blocked('22222222-2222-4222-8222-222222222222', true)$$, 'KGP_FORBIDDEN%',
  'moderator is not an admin');
set local "request.jwt.claims" to '{"sub": "dddddddd-dddd-4ddd-8ddd-dddddddddddd", "role": "authenticated"}';
select lives_ok($$select public.admin_set_blocked('22222222-2222-4222-8222-222222222222', true)$$, 'admin blocks a user');
select is((select count(*)::int from public.admin_list_users('сосед') where is_blocked), 1, 'admin list shows the block');

-- ---------- onboarding: nickname and separate PD consent ----------
set local "request.jwt.claims" to '{"sub": "66666666-6666-4666-8666-666666666666", "role": "authenticated", "is_anonymous": true}';
select is(public.my_profile(), null, 'no profile before onboarding');
select throws_like($$select public.complete_profile('новичок', false)$$, 'KGP_CONSENT%', 'consent is required');
select throws_like($$select public.complete_profile('СОСЕД', true)$$, 'KGP_NICK_TAKEN%', 'nickname is unique case-insensitively');
select is(public.complete_profile('новичок', true) ->> 'provider', 'demo', 'anonymous sign-in becomes a demo profile');

-- ---------- nearby duplicates and statistics ----------
select is((select count(*)::int from public.nearby_duplicates(56.0042 + 0.00018, 92.7735, 'snow')), 1, 'complaint 20 m away is found');
select is((select count(*)::int from public.nearby_duplicates(56.0042 + 0.00036, 92.7735, 'snow')), 0, 'complaint 40 m away is not');

select is(jsonb_array_length(public.stats_summary() -> 'by_day'), 21, 'stats_summary returns 21 days');

select * from finish();
rollback;
