-- Privileges, row level security, storage, read views and realtime.
-- Privileges are granted explicitly so the schema does not depend on platform defaults.

-- ---------- privileges ----------

revoke all on all tables in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

grant select on public.categories, public.districts to anon, authenticated;
grant insert, update, delete on public.categories, public.districts to authenticated;

-- Only the nickname of a user is public; everything else is returned by my_profile() / admin RPCs.
grant select (id, nickname) on public.profiles to anon, authenticated;

grant select on public.complaints, public.complaint_photos to anon, authenticated;
grant update on public.complaints to authenticated;
grant select (id, complaint_id, old_status, new_status, actor_label, comment, created_at)
  on public.status_history to anon, authenticated;
grant select, insert, delete on public.supports to authenticated;
grant select on public.confirmations to authenticated;
-- complaint_feed (security invoker) checks supported_by_me / confirmed_by_me for guests as well;
-- the policies below are "to authenticated", so guests get no rows.
grant select on public.supports, public.confirmations to anon;
grant select, delete on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
grant select on public.reports to authenticated;
grant update (resolution, resolved_by, resolved_at) on public.reports to authenticated;

-- Helpers used inside RLS policies run with the caller's privileges.
grant execute on function
  public.kgp_status_name(public.complaint_status), public.kgp_status_phrase(public.complaint_status),
  public.kgp_nick_key(text), public.kgp_is_moderator(), public.kgp_is_admin(),
  public.kgp_is_active_user(), public.kgp_public_statuses(), public.kgp_open_statuses(), public.kgp_raise(text, text)
  to anon, authenticated;

grant execute on function
  public.nearby_duplicates(double precision, double precision, text, double precision),
  public.stats_summary(integer),
  public.my_profile()
  to anon, authenticated;

grant execute on function
  public.complete_profile(text, boolean),
  public.update_my_settings(boolean),
  public.create_complaint(uuid, text, text, text, double precision, double precision, text, text, text[]),
  public.set_support(uuid, boolean),
  public.confirm_resolution(uuid, boolean),
  public.author_mark_sent(uuid),
  public.add_after_photo(uuid, text),
  public.report_complaint(uuid, text),
  public.mark_notifications_read(uuid[]),
  public.moderate_set_status(uuid, public.complaint_status, text),
  public.moderate_mark_duplicate(uuid, uuid),
  public.moderate_review_after_photo(uuid, boolean),
  public.moderate_resolve_report(uuid, text, boolean),
  public.admin_list_users(text),
  public.admin_set_blocked(uuid, boolean),
  public.admin_set_role(uuid, public.user_role)
  to authenticated;

-- ---------- row level security ----------

alter table public.categories enable row level security;
alter table public.districts enable row level security;
alter table public.profiles enable row level security;
alter table public.complaints enable row level security;
alter table public.complaint_photos enable row level security;
alter table public.status_history enable row level security;
alter table public.supports enable row level security;
alter table public.confirmations enable row level security;
alter table public.notifications enable row level security;
alter table public.reports enable row level security;

create policy categories_read on public.categories for select using (true);
create policy categories_admin_insert on public.categories for insert to authenticated with check (public.kgp_is_admin());
create policy categories_admin_update on public.categories for update to authenticated using (public.kgp_is_admin()) with check (public.kgp_is_admin());
create policy categories_admin_delete on public.categories for delete to authenticated using (public.kgp_is_admin());

create policy districts_read on public.districts for select using (true);
create policy districts_admin_insert on public.districts for insert to authenticated with check (public.kgp_is_admin());
create policy districts_admin_update on public.districts for update to authenticated using (public.kgp_is_admin()) with check (public.kgp_is_admin());
create policy districts_admin_delete on public.districts for delete to authenticated using (public.kgp_is_admin());

create policy profiles_read_nickname on public.profiles for select using (true);

-- Published complaints are public (anonymous too); on-moderation and rejected ones are visible to the author and moderators.
create policy complaints_read on public.complaints for select using (
  status = any (public.kgp_public_statuses()) or author_id = auth.uid() or public.kgp_is_moderator()
);
create policy complaints_moderator_update on public.complaints for update to authenticated
  using (public.kgp_is_moderator()) with check (public.kgp_is_moderator());

-- Photo rows follow the visibility of their complaint (the subquery is itself filtered by RLS).
create policy complaint_photos_read on public.complaint_photos for select using (
  exists (select 1 from public.complaints c where c.id = complaint_photos.complaint_id
          and (complaint_photos.kind = 'before' or complaint_photos.approved
               or c.author_id = auth.uid() or public.kgp_is_moderator()))
);

create policy status_history_read on public.status_history for select using (
  exists (select 1 from public.complaints c where c.id = complaint_id)
);

create policy supports_read_own on public.supports for select to authenticated
  using (user_id = auth.uid() or public.kgp_is_moderator());
create policy supports_insert_own on public.supports for insert to authenticated with check (
  user_id = auth.uid() and public.kgp_is_active_user() and exists (
    select 1 from public.complaints c where c.id = complaint_id
      and c.status = any (public.kgp_open_statuses()) and c.author_id is distinct from auth.uid())
);
create policy supports_delete_own on public.supports for delete to authenticated using (user_id = auth.uid());

create policy confirmations_read_own on public.confirmations for select to authenticated
  using (user_id = auth.uid() or public.kgp_is_moderator());

create policy notifications_read_own on public.notifications for select to authenticated using (user_id = auth.uid());
create policy notifications_update_own on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy notifications_delete_own on public.notifications for delete to authenticated using (user_id = auth.uid());

create policy reports_read on public.reports for select to authenticated
  using (user_id = auth.uid() or public.kgp_is_moderator());
create policy reports_moderator_update on public.reports for update to authenticated
  using (public.kgp_is_moderator()) with check (public.kgp_is_moderator());

-- ---------- storage: bucket "photos" ----------
-- Path layout: <user id>/<complaint id>/<n>.jpg. The bucket is private; clients read through signed URLs,
-- which storage only issues when the select policy below allows the object.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', false, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create function public.kgp_photo_visible(p_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.complaint_photos p join public.complaints c on c.id = p.complaint_id
    where p.storage_path = p_name and (
      public.kgp_is_moderator()
      or (c.status = any (public.kgp_public_statuses()) and (p.kind = 'before' or p.approved))
    )
  )
$$;
grant execute on function public.kgp_photo_visible(text) to anon, authenticated;

create policy kgp_photos_read on storage.objects for select to anon, authenticated using (
  bucket_id = 'photos' and ((storage.foldername(name))[1] = auth.uid()::text or public.kgp_photo_visible(name))
);
create policy kgp_photos_insert_own on storage.objects for insert to authenticated with check (
  bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text and public.kgp_is_active_user()
);
create policy kgp_photos_update_own on storage.objects for update to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy kgp_photos_delete_own on storage.objects for delete to authenticated using (
  bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text
);

-- ---------- read views (SECURITY INVOKER: RLS of the caller applies) ----------

create view public.complaint_feed with (security_invoker = true) as
select
  c.id, c.category_id, c.title, c.description, c.lat, c.lng, c.address, c.district, c.status,
  c.duplicate_of, c.supports_count, c.confirms_count, c.is_demo, c.created_at, c.updated_at,
  coalesce(p.nickname, c.demo_author, 'житель') as author_nickname,
  coalesce(c.author_id = auth.uid(), false) as is_mine,
  exists (select 1 from public.supports s where s.complaint_id = c.id and s.user_id = auth.uid()) as supported_by_me,
  exists (select 1 from public.confirmations f where f.complaint_id = c.id and f.user_id = auth.uid() and f.value) as confirmed_by_me,
  coalesce((
    select jsonb_agg(jsonb_build_object('id', ph.id, 'path', ph.storage_path, 'kind', ph.kind, 'approved', ph.approved)
                     order by ph.kind, ph.created_at)
    from public.complaint_photos ph where ph.complaint_id = c.id
  ), '[]'::jsonb) as photos
from public.complaints c
left join public.profiles p on p.id = c.author_id;

create view public.report_feed with (security_invoker = true) as
select r.id, r.complaint_id, c.title as complaint_title, c.status as complaint_status, r.reason,
       rp.nickname as reporter_nickname, r.created_at, r.resolution, r.resolved_at
from public.reports r
join public.complaints c on c.id = r.complaint_id
left join public.profiles rp on rp.id = r.user_id;

grant select on public.complaint_feed to anon, authenticated;
grant select on public.report_feed to authenticated;

-- ---------- analytics views for Yandex DataLens (anonymous: no ids of people) ----------

create view public.analytics_by_category with (security_invoker = true) as
select cat.id as category_id, cat.name as category,
       count(c.id) as total,
       count(c.id) filter (where c.status in ('published', 'sent', 'work', 'resolved_wait')) as open,
       count(c.id) filter (where c.status = 'resolved') as resolved,
       round(100.0 * count(c.id) filter (where c.status = 'resolved') / nullif(count(c.id), 0), 1) as resolved_pct
from public.categories cat
left join public.complaints c on c.category_id = cat.id and c.status not in ('duplicate', 'rejected', 'moderation')
group by cat.id, cat.name, cat.sort
order by cat.sort;

create view public.analytics_by_district with (security_invoker = true) as
select coalesce(nullif(c.district, ''), 'Район не определён') as district,
       count(*) as total,
       count(*) filter (where c.status = 'resolved') as resolved,
       sum(c.supports_count) as supports
from public.complaints c
where c.status not in ('duplicate', 'rejected', 'moderation')
group by 1
order by total desc;

create view public.analytics_by_week with (security_invoker = true) as
select date_trunc('week', c.created_at at time zone 'Asia/Krasnoyarsk')::date as week_start,
       c.category_id, count(*) as total
from public.complaints c
where c.status not in ('duplicate', 'rejected', 'moderation')
group by 1, 2
order by 1, 2;

create view public.analytics_timing with (security_invoker = true) as
select
  (select round((percentile_cont(0.5) within group (order by extract(epoch from h.created_at - c.created_at) / 3600.0))::numeric, 1)
     from public.status_history h join public.complaints c on c.id = h.complaint_id
     where h.old_status = 'moderation' and h.new_status = 'published') as median_hours_to_moderation,
  (select round((percentile_cont(0.5) within group (order by extract(epoch from c.resolved_at - c.created_at) / 86400.0))::numeric, 1)
     from public.complaints c where c.status = 'resolved' and c.resolved_at is not null) as median_days_to_resolution;

-- Ф-22: row-level export, coordinates rounded to ~100 m, no authors.
create view public.analytics_export with (security_invoker = true) as
select c.id, c.category_id, cat.name as category, coalesce(nullif(c.district, ''), 'Район не определён') as district,
       c.status, c.created_at, c.published_at, c.resolved_at, c.supports_count, c.confirms_count,
       round(c.lat::numeric, 3) as lat, round(c.lng::numeric, 3) as lng, c.is_demo
from public.complaints c join public.categories cat on cat.id = c.category_id
where c.status not in ('moderation', 'rejected');

grant select on public.analytics_by_category, public.analytics_by_district, public.analytics_by_week,
  public.analytics_timing, public.analytics_export to anon, authenticated;

-- ---------- realtime ----------

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.notifications, public.complaints;
  end if;
end
$$;
