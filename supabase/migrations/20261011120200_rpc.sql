-- RPC API used by the web and Android clients. Every SECURITY DEFINER function checks the caller explicitly.

-- ---------- profile ----------

create function public.complete_profile(p_nickname text, p_consent boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  jwt jsonb := coalesce(auth.jwt(), '{}'::jsonb);
  prov text;
  nick text := btrim(coalesce(p_nickname, ''));
begin
  if uid is null then perform public.kgp_raise('KGP_AUTH', 'Требуется вход'); end if;
  if char_length(nick) < 3 or char_length(nick) > 24 or nick !~ '^[0-9A-Za-zА-Яа-яЁё_.\- ]+$' then
    perform public.kgp_raise('KGP_NICKNAME', 'Никнейм — от 3 до 24 символов: буквы, цифры, пробел, _ . -');
  end if;
  if exists (select 1 from public.profiles where public.kgp_nick_key(nickname) = public.kgp_nick_key(nick) and id <> uid) then
    perform public.kgp_raise('KGP_NICK_TAKEN', 'Этот никнейм уже занят');
  end if;

  if exists (select 1 from public.profiles where id = uid) then
    update public.profiles set nickname = nick where id = uid;
  else
    if not coalesce(p_consent, false) then
      perform public.kgp_raise('KGP_CONSENT', 'Нужно согласие на обработку персональных данных');
    end if;
    prov := case
      when coalesce((jwt ->> 'is_anonymous')::boolean, false) then 'demo'
      when jwt -> 'app_metadata' ->> 'kgp_provider' in ('yandex', 'vk') then jwt -> 'app_metadata' ->> 'kgp_provider'
      else 'demo'
    end;
    insert into public.profiles (id, nickname, provider, external_id, pd_consent_at)
      values (uid, nick, prov, jwt -> 'app_metadata' ->> 'kgp_external_id', now());
  end if;
  return public.my_profile();
end
$$;

create function public.my_profile()
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when p.id is null then null else jsonb_build_object(
    'id', p.id, 'nickname', p.nickname, 'provider', p.provider, 'role', p.role,
    'is_blocked', p.is_blocked, 'notify_enabled', p.notify_enabled,
    'pd_consent_at', p.pd_consent_at, 'created_at', p.created_at,
    'complaints', (select count(*) from public.complaints c where c.author_id = p.id),
    'solved', (select count(*) from public.complaints c where c.author_id = p.id and c.status in ('resolved', 'resolved_wait')),
    'supported', (select count(*) from public.supports s where s.user_id = p.id)
  ) end
  from (select auth.uid() as uid) u left join public.profiles p on p.id = u.uid
$$;

create function public.update_my_settings(p_notify_enabled boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  update public.profiles set notify_enabled = p_notify_enabled where id = auth.uid();
  return public.my_profile();
end
$$;

-- ---------- complaints ----------

-- Idempotent: the client generates p_id, uploads photos to photos/<uid>/<p_id>/..., then calls this.
-- A retried offline draft with the same id returns the existing complaint instead of creating a copy.
create function public.create_complaint(
  p_id uuid, p_category text, p_title text, p_description text,
  p_lat double precision, p_lng double precision, p_address text, p_district text, p_photos text[]
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  path text;
  i integer := 0;
begin
  if uid is null then perform public.kgp_raise('KGP_AUTH', 'Требуется вход'); end if;
  if not public.kgp_is_active_user() then
    perform public.kgp_raise('KGP_NOT_ALLOWED', 'Учётная запись не завершила регистрацию или заблокирована');
  end if;
  if exists (select 1 from public.complaints where id = p_id) then
    if exists (select 1 from public.complaints where id = p_id and author_id = uid) then return p_id; end if;
    perform public.kgp_raise('KGP_CONFLICT', 'Идентификатор уже занят');
  end if;
  if coalesce(array_length(p_photos, 1), 0) not between 1 and 3 then
    perform public.kgp_raise('KGP_PHOTO_COUNT', 'Нужно от 1 до 3 фото');
  end if;
  foreach path in array p_photos loop
    if path not like uid::text || '/' || p_id::text || '/%' then
      perform public.kgp_raise('KGP_PHOTO_PATH', 'Неверный путь к фото');
    end if;
    if not exists (select 1 from storage.objects o where o.bucket_id = 'photos' and o.name = path) then
      perform public.kgp_raise('KGP_PHOTO_MISSING', 'Фото не загружено');
    end if;
  end loop;

  insert into public.complaints (id, author_id, category_id, title, description, lat, lng, address, district)
    values (p_id, uid, p_category, coalesce(p_title, ''), coalesce(p_description, ''), p_lat, p_lng,
            coalesce(nullif(btrim(p_address), ''), 'Точка на карте (адрес не определён)'), coalesce(p_district, ''));

  foreach path in array p_photos loop
    i := i + 1;
    insert into public.complaint_photos (complaint_id, storage_path, kind, size_bytes, created_at)
      select p_id, path, 'before', (o.metadata ->> 'size')::integer, now() + make_interval(secs => i * 0.001)
      from storage.objects o where o.bucket_id = 'photos' and o.name = path;
  end loop;
  return p_id;
end
$$;

create function public.set_support(p_id uuid, p_on boolean)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  c public.complaints%rowtype;
begin
  if auth.uid() is null then perform public.kgp_raise('KGP_AUTH', 'Требуется вход'); end if;
  if not public.kgp_is_active_user() then
    perform public.kgp_raise('KGP_NOT_ALLOWED', 'Учётная запись не завершила регистрацию или заблокирована');
  end if;
  select * into c from public.complaints where id = p_id;
  if not found then perform public.kgp_raise('KGP_NOT_FOUND', 'Обращение не найдено'); end if;
  if p_on then
    if c.author_id = auth.uid() then perform public.kgp_raise('KGP_OWN', 'Нельзя поддержать своё обращение'); end if;
    if c.status <> all (public.kgp_open_statuses()) then
      perform public.kgp_raise('KGP_STATUS', 'Поддержать можно только актуальное обращение');
    end if;
    insert into public.supports (user_id, complaint_id) values (auth.uid(), p_id) on conflict do nothing;
  else
    delete from public.supports where user_id = auth.uid() and complaint_id = p_id;
  end if;
  return (select supports_count from public.complaints where id = p_id);
end
$$;

-- "Решено" (p_resolved = true) or "Не решено" (false) from any signed-in resident.
create function public.confirm_resolution(p_id uuid, p_resolved boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  st public.complaint_status;
  nick text;
begin
  if auth.uid() is null then perform public.kgp_raise('KGP_AUTH', 'Требуется вход'); end if;
  if not public.kgp_is_active_user() then
    perform public.kgp_raise('KGP_NOT_ALLOWED', 'Учётная запись не завершила регистрацию или заблокирована');
  end if;
  select status into st from public.complaints where id = p_id for update;
  if not found then perform public.kgp_raise('KGP_NOT_FOUND', 'Обращение не найдено'); end if;
  select nickname into nick from public.profiles where id = auth.uid();

  if p_resolved then
    if st <> all (public.kgp_open_statuses()) then
      perform public.kgp_raise('KGP_STATUS', 'Подтвердить можно только актуальное обращение');
    end if;
    if st <> 'resolved_wait' then
      perform public.kgp_apply_status(p_id, 'resolved_wait', nick, 'Житель сообщил, что проблема решена');
    end if;
    insert into public.confirmations (user_id, complaint_id, value) values (auth.uid(), p_id, true)
      on conflict (user_id, complaint_id) do update set value = true, created_at = now();
  else
    if st <> 'resolved_wait' then
      perform public.kgp_raise('KGP_STATUS', '«Не решено» можно отметить только для обращения, ждущего подтверждения');
    end if;
    delete from public.confirmations where complaint_id = p_id;
    update public.complaints set confirms_count = 0 where id = p_id;
    insert into public.confirmations (user_id, complaint_id, value) values (auth.uid(), p_id, false);
    perform public.kgp_apply_status(p_id, 'published', nick, 'Житель сообщил, что проблема не решена');
  end if;
  return (select jsonb_build_object('status', status, 'confirms_count', confirms_count)
          from public.complaints where id = p_id);
end
$$;

-- The author filed the official appeal on pos.gosuslugi.ru.
create function public.author_mark_sent(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  c public.complaints%rowtype;
  nick text;
begin
  select * into c from public.complaints where id = p_id;
  if not found or c.author_id is distinct from auth.uid() then
    perform public.kgp_raise('KGP_NOT_ALLOWED', 'Отметить «Передано» может только автор');
  end if;
  if c.status <> 'published' then
    perform public.kgp_raise('KGP_STATUS', 'Отметить «Передано» можно только опубликованное обращение');
  end if;
  select nickname into nick from public.profiles where id = auth.uid();
  perform public.kgp_apply_status(p_id, 'sent', nick, 'Автор подал официальное обращение через «Решаем вместе»');
end
$$;

create function public.add_after_photo(p_id uuid, p_path text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.complaints where id = p_id and author_id = auth.uid()) then
    perform public.kgp_raise('KGP_NOT_ALLOWED', 'Фото «после» может добавить только автор');
  end if;
  if p_path not like auth.uid()::text || '/' || p_id::text || '/%' then
    perform public.kgp_raise('KGP_PHOTO_PATH', 'Неверный путь к фото');
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'photos' and o.name = p_path) then
    perform public.kgp_raise('KGP_PHOTO_MISSING', 'Фото не загружено');
  end if;
  insert into public.complaint_photos (complaint_id, storage_path, kind, size_bytes)
    select p_id, p_path, 'after', (o.metadata ->> 'size')::integer
    from storage.objects o where o.bucket_id = 'photos' and o.name = p_path;
end
$$;

create function public.report_complaint(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then perform public.kgp_raise('KGP_AUTH', 'Требуется вход'); end if;
  if not public.kgp_is_active_user() then
    perform public.kgp_raise('KGP_NOT_ALLOWED', 'Учётная запись не завершила регистрацию или заблокирована');
  end if;
  if not exists (select 1 from public.complaints where id = p_id) then
    perform public.kgp_raise('KGP_NOT_FOUND', 'Обращение не найдено');
  end if;
  insert into public.reports (complaint_id, user_id, reason) values (p_id, auth.uid(), btrim(p_reason))
    on conflict (complaint_id, user_id) do update
      set reason = excluded.reason, created_at = now(), resolution = null, resolved_by = null, resolved_at = null;
end
$$;

create function public.mark_notifications_read(p_ids uuid[] default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  update public.notifications set read_at = now()
    where user_id = auth.uid() and read_at is null and (p_ids is null or id = any (p_ids));
  get diagnostics n = row_count;
  return n;
end
$$;

-- ---------- spatial and statistics ----------

-- Open (and own on-moderation) complaints of the same category within radius, nearest first.
-- SECURITY INVOKER: RLS decides what the caller may see.
create function public.nearby_duplicates(
  p_lat double precision, p_lng double precision, p_category text, p_radius_m double precision default 30
) returns table (id uuid, title text, status public.complaint_status, supports_count integer, address text, distance_m double precision)
language sql stable set search_path = '' as $$
  select c.id, c.title, c.status, c.supports_count, c.address,
         extensions.st_distance(c.location, extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography) as distance_m
  from public.complaints c
  where c.category_id = p_category
    and c.status in ('moderation', 'published', 'sent', 'work', 'resolved_wait')
    and extensions.st_dwithin(c.location, extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography,
                              least(greatest(coalesce(p_radius_m, 30), 1), 500))
  order by distance_m
  limit 10
$$;

-- Aggregates for the statistics screen; anonymous by construction (no ids, no authors).
create function public.stats_summary(p_days integer default 21)
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
    'by_day', (select jsonb_agg(jsonb_build_object('day', d.day,
                 'n', (select count(*) from base b where (b.created_at at time zone 'Asia/Krasnoyarsk')::date = d.day))
               order by d.day) from days d),
    'by_category', (select coalesce(jsonb_agg(jsonb_build_object('category_id', x.category_id, 'n', x.n) order by x.n desc, x.category_id), '[]'::jsonb)
               from (select category_id, count(*) as n from base group by category_id) x),
    'by_status', (select coalesce(jsonb_agg(jsonb_build_object('status', x.status, 'n', x.n) order by x.status), '[]'::jsonb)
               from (select status, count(*) as n from base group by status) x),
    'by_district', (select coalesce(jsonb_agg(jsonb_build_object('district', x.district, 'n', x.n) order by x.n desc), '[]'::jsonb)
               from (select coalesce(nullif(district, ''), 'Район не определён') as district, count(*) as n from base group by 1) x),
    'median_moderation_hours', (select round(percentile_cont(0.5) within group (order by hours)::numeric, 1) from moderation),
    'median_resolution_days', (select round(percentile_cont(0.5) within group (order by days)::numeric, 1) from resolution)
  )
$$;

-- ---------- moderation (Ф-16, Ф-17) ----------

create function public.moderate_set_status(p_id uuid, p_status public.complaint_status, p_comment text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  org text;
begin
  if not public.kgp_is_moderator() then perform public.kgp_raise('KGP_FORBIDDEN', 'Нужны права модератора'); end if;
  if p_status = 'duplicate' then
    perform public.kgp_raise('KGP_STATUS', 'Для дубликата используйте объединение');
  end if;
  select cat.org_hint into org from public.complaints c join public.categories cat on cat.id = c.category_id where c.id = p_id;
  if not found then perform public.kgp_raise('KGP_NOT_FOUND', 'Обращение не найдено'); end if;
  perform public.kgp_apply_status(p_id, p_status, 'Модератор', coalesce(nullif(btrim(p_comment), ''),
    case p_status
      when 'published' then 'Проверено модератором и опубликовано'
      when 'rejected' then 'Нарушены правила публикации'
      when 'sent' then 'Обращение направлено: ' || org
      when 'work' then 'Организация сообщила о начале работ'
      when 'resolved_wait' then 'Отмечено как решённое, ждём подтверждения жителей'
      when 'resolved' then 'Решение подтверждено модератором'
      else ''
    end));
end
$$;

-- Ф-16: merge a duplicate into the original; its author becomes a supporter of the original (TZ, table 4).
create function public.moderate_mark_duplicate(p_id uuid, p_original uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  dup public.complaints%rowtype;
  orig public.complaints%rowtype;
begin
  if not public.kgp_is_moderator() then perform public.kgp_raise('KGP_FORBIDDEN', 'Нужны права модератора'); end if;
  select * into dup from public.complaints where id = p_id;
  select * into orig from public.complaints where id = p_original;
  if dup.id is null or orig.id is null or p_id = p_original then
    perform public.kgp_raise('KGP_NOT_FOUND', 'Обращение не найдено');
  end if;
  if orig.status = 'duplicate' then
    perform public.kgp_raise('KGP_STATUS', 'Исходное обращение само является дубликатом');
  end if;
  perform set_config('kgp.actor_label', 'Модератор', true);
  perform set_config('kgp.status_comment', format('Объединено с обращением «%s»', orig.title), true);
  update public.complaints set status = 'duplicate', duplicate_of = p_original where id = p_id;
  perform set_config('kgp.actor_label', '', true);
  perform set_config('kgp.status_comment', '', true);
  if dup.author_id is not null and dup.author_id is distinct from orig.author_id then
    insert into public.supports (user_id, complaint_id) values (dup.author_id, p_original) on conflict do nothing;
  end if;
end
$$;

create function public.moderate_review_after_photo(p_photo uuid, p_approve boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.kgp_is_moderator() then perform public.kgp_raise('KGP_FORBIDDEN', 'Нужны права модератора'); end if;
  if p_approve then
    update public.complaint_photos set approved = true where id = p_photo and kind = 'after';
  else
    delete from public.complaint_photos where id = p_photo and kind = 'after' and not approved;
  end if;
end
$$;

create function public.moderate_resolve_report(p_report uuid, p_resolution text, p_hide boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare
  cid uuid;
begin
  if not public.kgp_is_moderator() then perform public.kgp_raise('KGP_FORBIDDEN', 'Нужны права модератора'); end if;
  update public.reports set resolution = coalesce(nullif(btrim(p_resolution), ''), case when p_hide then 'Обращение скрыто' else 'Нарушений не найдено' end),
         resolved_by = auth.uid(), resolved_at = now()
    where id = p_report returning complaint_id into cid;
  if cid is null then perform public.kgp_raise('KGP_NOT_FOUND', 'Жалоба не найдена'); end if;
  if p_hide then
    perform public.kgp_apply_status(cid, 'rejected', 'Модератор', coalesce(nullif(btrim(p_resolution), ''), 'Скрыто по жалобе пользователя'));
  end if;
end
$$;

-- ---------- administration (Ф-19, Ф-20) ----------

create function public.admin_list_users(p_search text default null)
returns table (id uuid, nickname text, provider text, role public.user_role, is_blocked boolean,
               created_at timestamptz, complaints bigint, reports_against bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.kgp_is_moderator() then perform public.kgp_raise('KGP_FORBIDDEN', 'Нужны права модератора'); end if;
  return query
    select p.id, p.nickname, p.provider, p.role, p.is_blocked, p.created_at,
           (select count(*) from public.complaints c where c.author_id = p.id),
           (select count(*) from public.reports r join public.complaints c on c.id = r.complaint_id where c.author_id = p.id)
    from public.profiles p
    where p_search is null or p.nickname ilike '%' || p_search || '%'
    order by p.created_at desc
    limit 200;
end
$$;

create function public.admin_set_blocked(p_user uuid, p_blocked boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.kgp_is_admin() then perform public.kgp_raise('KGP_FORBIDDEN', 'Нужны права администратора'); end if;
  if p_user = auth.uid() then perform public.kgp_raise('KGP_NOT_ALLOWED', 'Нельзя заблокировать себя'); end if;
  update public.profiles set is_blocked = p_blocked where id = p_user;
end
$$;

create function public.admin_set_role(p_user uuid, p_role public.user_role)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.kgp_is_admin() then perform public.kgp_raise('KGP_FORBIDDEN', 'Нужны права администратора'); end if;
  if p_user = auth.uid() and p_role <> 'admin' then
    perform public.kgp_raise('KGP_NOT_ALLOWED', 'Нельзя снять с себя роль администратора');
  end if;
  update public.profiles set role = p_role where id = p_user;
end
$$;
