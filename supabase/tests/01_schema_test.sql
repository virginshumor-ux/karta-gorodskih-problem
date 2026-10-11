-- Schema, reference data, seed and platform settings.
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

select is(
  (select count(*)::int from pg_tables where schemaname = 'public'
     and tablename in ('profiles', 'categories', 'districts', 'complaints', 'complaint_photos',
                       'status_history', 'supports', 'confirmations', 'notifications', 'reports')),
  10, 'all 10 tables exist');

select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity),
  0, 'RLS is enabled on every table in public');

select is((select count(*)::int from public.categories), 9, '9 categories as in the prototype');
select results_eq(
  'select id from public.categories order by sort',
  $$values ('road'), ('light'), ('trash'), ('snow'), ('ice'), ('yard'), ('green'), ('transit'), ('other')$$,
  'category ids and order match the prototype');
select is((select color from public.categories where id = 'snow'), '#2f7fb5', 'category colors come from the prototype');
select is((select count(*)::int from public.districts), 7, '7 districts of Krasnoyarsk');

select col_type_is('public', 'complaints', 'location', 'extensions.geography(Point,4326)', 'location is geography(Point, 4326)');
select has_index('public', 'complaints', 'complaints_location_gix', 'spatial index on complaints.location');
select enum_has_labels('public', 'complaint_status',
  array['moderation', 'published', 'sent', 'work', 'resolved_wait', 'resolved', 'rejected', 'duplicate'], 'status enum');

select is((select count(*)::int from public.complaints where is_demo), 15, '15 demo complaints are seeded');
select ok((select bool_and(demo_author is not null) from public.complaints where is_demo), 'demo complaints have a demo author');
select ok(
  (select count(*) from public.status_history h join public.complaints c on c.id = h.complaint_id where c.is_demo) >= 15,
  'demo complaints have status history');

select is((select public from storage.buckets where id = 'photos'), false, 'photos bucket is private (signed URLs)');
select is((select file_size_limit from storage.buckets where id = 'photos'), 2097152::bigint, 'photos are limited to 2 MB');
select is((select allowed_mime_types from storage.buckets where id = 'photos'),
  array['image/jpeg', 'image/png', 'image/webp'], 'only jpeg/png/webp are accepted');

select ok(exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
                  and schemaname = 'public' and tablename = 'notifications'), 'notifications are published to realtime');

select * from finish();
rollback;
