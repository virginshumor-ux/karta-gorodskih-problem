-- v1.1: comments, alerts near home, district rating.
begin;
create extension if not exists pgtap with schema extensions;
select plan(18);

insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'author@test.invalid'),
  ('22222222-2222-4222-8222-222222222222', 'u2@test.invalid'),
  ('33333333-3333-4333-8333-333333333333', 'neighbour@test.invalid'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'moderator@test.invalid');
insert into public.profiles (id, nickname, pd_consent_at, role) values
  ('11111111-1111-4111-8111-111111111111', 'автор_теста', now(), 'user'),
  ('22222222-2222-4222-8222-222222222222', 'сосед', now(), 'user'),
  ('33333333-3333-4333-8333-333333333333', 'живу_рядом', now(), 'user'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'модератор', now(), 'moderator');
insert into public.complaints (id, author_id, category_id, title, lat, lng, address) values
  ('c0000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'road', 'Яма рядом с домом', 56.0100, 92.8700, 'адрес 1');

set local role authenticated;

-- ---------- home area ----------
set local "request.jwt.claims" to '{"sub": "33333333-3333-4333-8333-333333333333", "role": "authenticated"}';
select throws_like($$select public.set_home_area(55.5, 92.8, 500)$$, 'KGP_OUT_OF_CITY%', 'home outside the city is rejected');
select is((public.set_home_area(56.0105, 92.8705, 50) ->> 'home_radius_m')::int, 100, 'radius is clamped to 100..3000 m');
select is((public.set_home_area(56.0105, 92.8705, 500) ->> 'home_lat')::numeric, 56.0105, 'home area is saved in my_profile');
set local role anon;
set local "request.jwt.claims" to '{"role": "anon"}';
select throws_ok('select home_lat from public.profiles limit 1', '42501', null, 'home coordinates are not publicly readable');

-- publication notifies the neighbour
set local role authenticated;
set local "request.jwt.claims" to '{"sub": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "role": "authenticated"}';
do $$ begin perform public.moderate_set_status('c0000000-0000-4000-8000-000000000001', 'published'); end $$;
set local "request.jwt.claims" to '{"sub": "33333333-3333-4333-8333-333333333333", "role": "authenticated"}';
select is((select count(*)::int from public.notifications where text like 'Рядом с вашим домом%'), 1, 'neighbour is notified about a new complaint nearby');
set local "request.jwt.claims" to '{"sub": "22222222-2222-4222-8222-222222222222", "role": "authenticated"}';
select is((select count(*)::int from public.notifications where text like 'Рядом с вашим домом%'), 0, 'users without a home area are not notified');

-- ---------- comments ----------
select throws_like($$select public.add_comment('c0000000-0000-4000-8000-000000000001', '   ')$$, 'KGP_COMMENT_LENGTH%', 'empty comment is rejected');
select lives_ok($$select public.add_comment('c0000000-0000-4000-8000-000000000001', 'Видел   сегодня, яма   стала больше')$$, 'user comments a published complaint');
select is((select text from public.comment_feed where complaint_id = 'c0000000-0000-4000-8000-000000000001'), 'Видел сегодня, яма стала больше', 'whitespace is normalized');
select ok((select is_mine from public.comment_feed limit 1), 'feed marks own comment');
select is((select comments_count from public.complaint_feed where id = 'c0000000-0000-4000-8000-000000000001'), 1, 'comments_count is maintained');
select throws_ok($$insert into public.complaint_comments (complaint_id, author_id, text) values ('c0000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'x')$$,
  '42501', null, 'direct insert is not allowed (RPC only)');

set local "request.jwt.claims" to '{"sub": "11111111-1111-4111-8111-111111111111", "role": "authenticated"}';
select is((select count(*)::int from public.notifications where text like 'сосед прокомментировал%'), 1, 'author is notified about the comment');
select throws_like($$select public.delete_comment((select id from public.complaint_comments limit 1))$$, 'KGP_NOT_ALLOWED%', 'cannot delete someone else''s comment');

set local role anon;
set local "request.jwt.claims" to '{"role": "anon"}';
select is((select count(*)::int from public.comment_feed), 1, 'guests read comments of published complaints');

set local role authenticated;
set local "request.jwt.claims" to '{"sub": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "role": "authenticated"}';
do $$ begin perform public.delete_comment((select id from public.complaint_comments limit 1)); end $$;
set local role anon;
set local "request.jwt.claims" to '{"role": "anon"}';
select is((select count(*)::int from public.comment_feed), 0, 'moderator hides a comment for everyone');
select is((select comments_count from public.complaint_feed where id = 'c0000000-0000-4000-8000-000000000001'), 0, 'hidden comments are not counted');

-- ---------- district rating ----------
select ok((public.stats_summary() -> 'by_district' -> 0) ? 'resolved', 'stats_summary has resolved per district');

select * from finish();
rollback;
