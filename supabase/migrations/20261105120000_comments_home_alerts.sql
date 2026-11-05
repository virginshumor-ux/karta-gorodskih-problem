-- v1.1: comments (Ф-13), alerts about new complaints near the user's home, district rating in statistics.

-- ---------- comments ----------

alter table public.complaints add column comments_count integer not null default 0 check (comments_count >= 0);

create table public.complaint_comments (
  id uuid primary key default gen_random_uuid(),
  complaint_id uuid not null references public.complaints (id) on delete cascade,
  author_id uuid not null references auth.users (id) on delete cascade,
  text text not null check (char_length(text) between 1 and 1000),
  is_hidden boolean not null default false,
  created_at timestamptz not null default now()
);
create index complaint_comments_complaint_idx on public.complaint_comments (complaint_id, created_at);
create index complaint_comments_author_idx on public.complaint_comments (author_id, created_at desc);

alter table public.complaint_comments enable row level security;

-- Comments follow the visibility of their complaint; hidden ones stay visible to the author and moderators.
create policy complaint_comments_read on public.complaint_comments for select using (
  exists (select 1 from public.complaints c where c.id = complaint_comments.complaint_id)
  and (not complaint_comments.is_hidden or complaint_comments.author_id = auth.uid() or public.kgp_is_moderator())
);
grant select on public.complaint_comments to anon, authenticated;
grant all on public.complaint_comments to service_role;

create function public.comments_counter()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  cid uuid := coalesce(new.complaint_id, old.complaint_id);
begin
  update public.complaints
    set comments_count = (select count(*) from public.complaint_comments x where x.complaint_id = cid and not x.is_hidden)
    where id = cid;
  return null;
end
$$;

create trigger comments_counter
  after insert or delete or update of is_hidden on public.complaint_comments
  for each row execute function public.comments_counter();

create function public.add_comment(p_complaint uuid, p_text text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  t text := btrim(regexp_replace(coalesce(p_text, ''), '\s+', ' ', 'g'));
  c public.complaints%rowtype;
  rec public.complaint_comments%rowtype;
  nick text;
begin
  if uid is null then perform public.kgp_raise('KGP_AUTH', 'Требуется вход'); end if;
  if not public.kgp_is_active_user() then
    perform public.kgp_raise('KGP_NOT_ALLOWED', 'Учётная запись не завершила регистрацию или заблокирована');
  end if;
  if char_length(t) < 1 or char_length(t) > 1000 then
    perform public.kgp_raise('KGP_COMMENT_LENGTH', 'Комментарий — от 1 до 1000 символов');
  end if;
  select * into c from public.complaints where id = p_complaint;
  if not found or (c.status <> all (public.kgp_public_statuses()) and c.author_id is distinct from uid and not public.kgp_is_moderator()) then
    perform public.kgp_raise('KGP_NOT_FOUND', 'Обращение не найдено');
  end if;
  if (select count(*) from public.complaint_comments x where x.author_id = uid and x.created_at > now() - interval '1 hour') >= 20 then
    perform public.kgp_raise('KGP_RATE_LIMIT', 'Не более 20 комментариев в час');
  end if;
  insert into public.complaint_comments (complaint_id, author_id, text) values (p_complaint, uid, t) returning * into rec;
  if c.author_id is distinct from uid then
    select nickname into nick from public.profiles where id = uid;
    perform public.kgp_notify(c.author_id, c.id, format('%s прокомментировал ваше обращение «%s»', coalesce(nick, 'Житель'), c.title));
  end if;
  return jsonb_build_object('id', rec.id, 'created_at', rec.created_at);
end
$$;

-- The author removes own comment; a moderator hides any comment (kept for the record).
create function public.delete_comment(p_comment uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if public.kgp_is_moderator() then
    update public.complaint_comments set is_hidden = true where id = p_comment;
  else
    delete from public.complaint_comments where id = p_comment and author_id = auth.uid();
    if not found then perform public.kgp_raise('KGP_NOT_ALLOWED', 'Удалить можно только свой комментарий'); end if;
  end if;
end
$$;

create view public.comment_feed with (security_invoker = true) as
select x.id, x.complaint_id, x.text, x.is_hidden, x.created_at,
       coalesce(p.nickname, 'житель') as author_nickname,
       coalesce(x.author_id = auth.uid(), false) as is_mine
from public.complaint_comments x
left join public.profiles p on p.id = x.author_id;

grant select on public.comment_feed to anon, authenticated;

-- ---------- home area alerts ----------

alter table public.profiles
  add column home_lat double precision,
  add column home_lng double precision,
  add column home_radius_m integer,
  add constraint profiles_home_area check (
    (home_lat is null and home_lng is null and home_radius_m is null)
    or (home_lat > 55.90 and home_lat < 56.14 and home_lng > 92.60 and home_lng < 93.20 and home_radius_m between 100 and 3000)
  );
-- Home coordinates are personal data: column privileges keep them out of public reads (only id, nickname are granted).

create function public.set_home_area(p_lat double precision, p_lng double precision, p_radius_m integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then perform public.kgp_raise('KGP_AUTH', 'Требуется вход'); end if;
  if p_lat is null then
    update public.profiles set home_lat = null, home_lng = null, home_radius_m = null where id = auth.uid();
  else
    if not (p_lat > 55.90 and p_lat < 56.14 and p_lng > 92.60 and p_lng < 93.20) then
      perform public.kgp_raise('KGP_OUT_OF_CITY', 'Точка за пределами Красноярска');
    end if;
    update public.profiles set home_lat = p_lat, home_lng = p_lng, home_radius_m = least(greatest(coalesce(p_radius_m, 500), 100), 3000)
      where id = auth.uid();
  end if;
  return public.my_profile();
end
$$;

create or replace function public.my_profile()
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when p.id is null then null else jsonb_build_object(
    'id', p.id, 'nickname', p.nickname, 'provider', p.provider, 'role', p.role,
    'is_blocked', p.is_blocked, 'notify_enabled', p.notify_enabled,
    'pd_consent_at', p.pd_consent_at, 'created_at', p.created_at,
    'home_lat', p.home_lat, 'home_lng', p.home_lng, 'home_radius_m', p.home_radius_m,
    'complaints', (select count(*) from public.complaints c where c.author_id = p.id),
    'solved', (select count(*) from public.complaints c where c.author_id = p.id and c.status in ('resolved', 'resolved_wait')),
    'supported', (select count(*) from public.supports s where s.user_id = p.id),
    'confirmed', (select count(*) from public.confirmations f where f.user_id = p.id and f.value),
    'comments', (select count(*) from public.complaint_comments x where x.author_id = p.id and not x.is_hidden)
  ) end
  from (select auth.uid() as uid) u left join public.profiles p on p.id = u.uid
$$;

-- Status changes notify the author and supporters (as before) and, on first publication, residents nearby.
create or replace function public.complaints_after_status()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  actor text := nullif(current_setting('kgp.actor_label', true), '');
  note text := coalesce(current_setting('kgp.status_comment', true), '');
  sname text := public.kgp_status_phrase(new.status);
  r record;
begin
  if actor is null then
    if public.kgp_is_moderator() then actor := 'Модератор';
    else select p.nickname into actor from public.profiles p where p.id = auth.uid();
    end if;
  end if;

  insert into public.status_history (complaint_id, old_status, new_status, changed_by, actor_label, comment)
    values (new.id, old.status, new.status, auth.uid(), coalesce(actor, 'Система'), note);

  if new.author_id is distinct from auth.uid() then
    perform public.kgp_notify(new.author_id, new.id,
      case new.status
        when 'published' then format('Обращение «%s» опубликовано на карте', new.title)
        when 'rejected' then format('Обращение «%s» отклонено: %s', new.title, coalesce(nullif(note, ''), 'нарушены правила публикации'))
        when 'resolved_wait' then format('Обращение «%s» отмечено как решённое. Подтвердите, если это так', new.title)
        else format('Обращение «%s»: %s', new.title, sname)
      end);
  end if;
  for r in
    select s.user_id from public.supports s
    where s.complaint_id = new.id and s.user_id is distinct from auth.uid() and s.user_id is distinct from new.author_id
  loop
    perform public.kgp_notify(r.user_id, new.id,
      case new.status
        when 'resolved_wait' then format('Поддержанное вами обращение «%s» отмечено как решённое. Подтвердите, если это так', new.title)
        else format('Поддержанное вами обращение «%s»: %s', new.title, sname)
      end);
  end loop;

  if old.status = 'moderation' and new.status = 'published' then
    for r in
      select p.id from public.profiles p
      where p.home_lat is not null and not p.is_blocked
        and p.id is distinct from new.author_id and p.id is distinct from auth.uid()
        and extensions.st_dwithin(
          extensions.st_setsrid(extensions.st_makepoint(p.home_lng, p.home_lat), 4326)::extensions.geography,
          new.location, p.home_radius_m)
    loop
      perform public.kgp_notify(r.id, new.id, format('Рядом с вашим домом новое обращение: «%s»', new.title));
    end loop;
  end if;
  return null;
end
$$;

-- ---------- statistics: district rating ----------

create or replace function public.stats_summary(p_days integer default 21)
returns jsonb language sql stable security definer set search_path = '' as $$
  with base as (
    select * from public.complaints where status not in ('duplicate', 'rejected')
  ), days as (
    select generate_series((now() at time zone 'Asia/Krasnoyarsk')::date - (least(greatest(p_days, 7), 90) - 1),
                           (now() at time zone 'Asia/Krasnoyarsk')::date, interval '1 day')::date as day
  ), moderation as (
    select extract(epoch from (h.created_at - c.created_at)) / 3600.0 as hours
    from public.status_history h join public.complaints c on c.id = h.complaint_id
    where h.old_status = 'moderation' and h.new_status = 'published'
  ), resolution as (
    select extract(epoch from (c.resolved_at - c.created_at)) / 86400.0 as days
    from public.complaints c where c.status = 'resolved' and c.resolved_at is not null
  )
  select jsonb_build_object(
    'total', (select count(*) from base),
    'open', (select count(*) from base where status in ('published', 'sent', 'work', 'resolved_wait')),
    'resolved', (select count(*) from base where status = 'resolved'),
    'supports', (select coalesce(sum(supports_count), 0) from base),
    'comments', (select coalesce(sum(comments_count), 0) from base),
    'by_day', (select jsonb_agg(jsonb_build_object('day', d.day,
                 'n', (select count(*) from base b where (b.created_at at time zone 'Asia/Krasnoyarsk')::date = d.day))
               order by d.day) from days d),
    'by_category', (select coalesce(jsonb_agg(jsonb_build_object('category_id', x.category_id, 'n', x.n) order by x.n desc, x.category_id), '[]'::jsonb)
               from (select category_id, count(*) as n from base group by category_id) x),
    'by_status', (select coalesce(jsonb_agg(jsonb_build_object('status', x.status, 'n', x.n) order by x.status), '[]'::jsonb)
               from (select status, count(*) as n from base group by status) x),
    'by_district', (select coalesce(jsonb_agg(jsonb_build_object('district', x.district, 'n', x.n, 'resolved', x.resolved) order by x.n desc), '[]'::jsonb)
               from (select coalesce(nullif(district, ''), 'Район не определён') as district, count(*) as n,
                            count(*) filter (where status = 'resolved') as resolved
                     from base group by 1) x),
    'median_moderation_hours', (select round(percentile_cont(0.5) within group (order by hours)::numeric, 1) from moderation),
    'median_resolution_days', (select round(percentile_cont(0.5) within group (order by days)::numeric, 1) from resolution)
  )
$$;

-- ---------- feed: comments count (appended column keeps the view replaceable) ----------

create or replace view public.complaint_feed with (security_invoker = true) as
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
  ), '[]'::jsonb) as photos,
  c.comments_count
from public.complaints c
left join public.profiles p on p.id = c.author_id;

-- ---------- privileges ----------

revoke all on function public.comments_counter() from public, anon, authenticated;
revoke all on function public.add_comment(uuid, text), public.delete_comment(uuid),
  public.set_home_area(double precision, double precision, integer) from public, anon;
grant execute on function public.add_comment(uuid, text), public.delete_comment(uuid),
  public.set_home_area(double precision, double precision, integer) to authenticated;
grant execute on function public.add_comment(uuid, text), public.delete_comment(uuid),
  public.set_home_area(double precision, double precision, integer), public.comments_counter() to service_role;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.complaint_comments;
  end if;
end
$$;
