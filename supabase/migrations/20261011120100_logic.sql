-- Server-side business rules: validation, rate limit, counters, status history and notifications.
-- Clients never write counters or history; triggers and SECURITY DEFINER RPCs do.

-- ---------- helpers ----------

create function public.kgp_status_name(s public.complaint_status)
returns text language sql immutable set search_path = '' as $$
  select case s
    when 'moderation' then 'На модерации'
    when 'published' then 'Опубликовано'
    when 'sent' then 'Передано в организацию'
    when 'work' then 'В работе'
    when 'resolved_wait' then 'Решено — ждёт подтверждения'
    when 'resolved' then 'Решено'
    when 'rejected' then 'Отклонено'
    when 'duplicate' then 'Дубликат'
  end
$$;

-- Lower-case form for use inside sentences ("Обращение «…»: в работе").
create function public.kgp_status_phrase(s public.complaint_status)
returns text language sql immutable set search_path = '' as $$
  select case s
    when 'moderation' then 'на модерации'
    when 'published' then 'опубликовано'
    when 'sent' then 'передано в организацию'
    when 'work' then 'в работе'
    when 'resolved_wait' then 'решено — ждёт подтверждения'
    when 'resolved' then 'решено'
    when 'rejected' then 'отклонено'
    when 'duplicate' then 'объединено с похожим обращением'
  end
$$;

create function public.kgp_is_moderator()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('moderator', 'admin') and not p.is_blocked
  )
$$;

create function public.kgp_is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin' and not p.is_blocked
  )
$$;

-- A signed-in user who finished onboarding (nickname + PD consent) and is not blocked.
create function public.kgp_is_active_user()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and not p.is_blocked)
$$;

create function public.kgp_public_statuses()
returns public.complaint_status[] language sql immutable set search_path = '' as $$
  select array['published', 'sent', 'work', 'resolved_wait', 'resolved', 'duplicate']::public.complaint_status[]
$$;

create function public.kgp_open_statuses()
returns public.complaint_status[] language sql immutable set search_path = '' as $$
  select array['published', 'sent', 'work', 'resolved_wait']::public.complaint_status[]
$$;

create function public.kgp_raise(code text, msg text)
returns void language plpgsql volatile set search_path = '' as $$
begin
  -- Clients map the stable code before the colon to a localized message.
  raise exception using errcode = 'P0001', message = code || ': ' || msg;
end
$$;

-- Internal: change status with an actor label and comment that the history trigger picks up.
create function public.kgp_apply_status(
  p_id uuid, p_status public.complaint_status, p_actor text, p_comment text
) returns void language plpgsql security definer set search_path = '' as $$
begin
  perform set_config('kgp.actor_label', coalesce(p_actor, ''), true);
  perform set_config('kgp.status_comment', coalesce(p_comment, ''), true);
  update public.complaints set status = p_status where id = p_id and status is distinct from p_status;
  perform set_config('kgp.actor_label', '', true);
  perform set_config('kgp.status_comment', '', true);
end
$$;

create function public.kgp_notify(p_user uuid, p_complaint uuid, p_text text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_user is null then return; end if;
  if exists (select 1 from public.profiles where id = p_user and not notify_enabled) then return; end if;
  insert into public.notifications (user_id, complaint_id, text) values (p_user, p_complaint, p_text);
end
$$;

-- ---------- complaints: validation ----------

create function public.complaints_before_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  recent integer;
  d text;
begin
  -- Rows written by signed-in clients cannot forge authorship, status or counters.
  if auth.uid() is not null and not public.kgp_is_moderator() then
    new.author_id := auth.uid();
    new.status := 'moderation';
    new.duplicate_of := null;
    new.supports_count := 0;
    new.confirms_count := 0;
    new.is_demo := false;
    new.demo_author := null;
  end if;

  new.title := btrim(regexp_replace(new.title, '\s+', ' ', 'g'));
  new.description := btrim(coalesce(new.description, ''));
  new.address := btrim(new.address);

  if char_length(new.title) < 5 or char_length(new.title) > 80 then
    perform public.kgp_raise('KGP_TITLE_LENGTH', 'Заголовок — от 5 до 80 символов');
  end if;
  if char_length(new.description) > 500 then
    perform public.kgp_raise('KGP_DESCRIPTION_LENGTH', 'Описание — не более 500 символов');
  end if;
  if not (new.lat > 55.90 and new.lat < 56.14 and new.lng > 92.60 and new.lng < 93.20) then
    perform public.kgp_raise('KGP_OUT_OF_CITY', 'Точка за пределами Красноярска');
  end if;
  if not exists (select 1 from public.categories c where c.id = new.category_id and c.is_active) then
    perform public.kgp_raise('KGP_CATEGORY', 'Неизвестная категория');
  end if;

  if new.author_id is not null and not new.is_demo then
    if not exists (select 1 from public.profiles p where p.id = new.author_id and not p.is_blocked) then
      perform public.kgp_raise('KGP_NOT_ALLOWED', 'Учётная запись не завершила регистрацию или заблокирована');
    end if;
    -- Serialize per author so parallel inserts cannot bypass the hourly limit.
    perform pg_advisory_xact_lock(hashtextextended(new.author_id::text, 0));
    select count(*) into recent from public.complaints c
      where c.author_id = new.author_id and c.created_at > now() - interval '1 hour';
    if recent >= 5 then
      perform public.kgp_raise('KGP_RATE_LIMIT', 'Можно отправить не более 5 обращений в час');
    end if;
  end if;

  -- District by polygon when boundaries are loaded; otherwise keep the geocoder text.
  select dd.name into d from public.districts dd
    where dd.boundary is not null
      and extensions.st_covers(
        dd.boundary,
        extensions.st_setsrid(extensions.st_makepoint(new.lng, new.lat), 4326)::extensions.geography)
    limit 1;
  if d is not null then new.district := d; end if;

  if new.status = 'published' and new.published_at is null then new.published_at := new.created_at; end if;
  if new.status = 'resolved' and new.resolved_at is null then new.resolved_at := new.created_at; end if;
  return new;
end
$$;

create trigger complaints_before_insert
  before insert on public.complaints
  for each row execute function public.complaints_before_insert();

create function public.complaints_before_update()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  if new.status is distinct from old.status then
    if new.status = 'published' and new.published_at is null then new.published_at := now(); end if;
    if new.status = 'resolved' then new.resolved_at := now(); end if;
    if new.status <> 'resolved' then new.resolved_at := null; end if;
    if new.status <> 'duplicate' then new.duplicate_of := null; end if;
  end if;
  if new.title is distinct from old.title and (char_length(new.title) < 5 or char_length(new.title) > 80) then
    perform public.kgp_raise('KGP_TITLE_LENGTH', 'Заголовок — от 5 до 80 символов');
  end if;
  return new;
end
$$;

create trigger complaints_before_update
  before update on public.complaints
  for each row execute function public.complaints_before_update();

-- ---------- complaints: history and notifications ----------

create function public.complaints_after_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.is_demo then return null; end if;
  insert into public.status_history (complaint_id, old_status, new_status, changed_by, actor_label, comment)
    values (new.id, null, new.status, auth.uid(), 'Автор', 'Обращение создано');
  perform public.kgp_notify(new.author_id, new.id, format('Обращение «%s» отправлено на модерацию', new.title));
  return null;
end
$$;

create trigger complaints_after_insert
  after insert on public.complaints
  for each row execute function public.complaints_after_insert();

create function public.complaints_after_status()
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

  -- Author first, then everyone who supported the complaint; the person who made the change is skipped.
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
  return null;
end
$$;

create trigger complaints_after_status
  after update of status on public.complaints
  for each row when (old.status is distinct from new.status)
  execute function public.complaints_after_status();

-- ---------- supports ----------

create function public.supports_counter()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    update public.complaints set supports_count = supports_count + 1 where id = new.complaint_id;
  else
    update public.complaints set supports_count = greatest(supports_count - 1, 0) where id = old.complaint_id;
  end if;
  return null;
end
$$;

create trigger supports_counter
  after insert or delete on public.supports
  for each row execute function public.supports_counter();

-- ---------- confirmations: 3 confirmations resolve the complaint ----------

create function public.confirmations_counter()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  cid uuid;
  delta integer;
  n integer;
  st public.complaint_status;
begin
  -- Incremental (like supports) so seeded demo counters keep their base value.
  if tg_op = 'INSERT' then
    cid := new.complaint_id; delta := case when new.value then 1 else 0 end;
  elsif tg_op = 'UPDATE' then
    cid := new.complaint_id; delta := new.value::integer - old.value::integer;
  else
    cid := old.complaint_id; delta := case when old.value then -1 else 0 end;
  end if;
  if delta = 0 then return null; end if;
  update public.complaints set confirms_count = greatest(confirms_count + delta, 0)
    where id = cid returning status, confirms_count into st, n;
  if n >= 3 and st = 'resolved_wait' then
    perform public.kgp_apply_status(cid, 'resolved', 'Жители',
      format('Решение подтвердили %s %s', n, case when n % 10 between 2 and 4 and n % 100 not between 12 and 14 then 'жителя' else 'жителей' end));
  end if;
  return null;
end
$$;

create trigger confirmations_counter
  after insert or update or delete on public.confirmations
  for each row execute function public.confirmations_counter();

-- ---------- photos ----------

create function public.complaint_photos_before_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  c public.complaints%rowtype;
begin
  select * into c from public.complaints where id = new.complaint_id;
  if auth.uid() is not null and not public.kgp_is_moderator() then
    if c.author_id is distinct from auth.uid() then
      perform public.kgp_raise('KGP_NOT_ALLOWED', 'Фото может добавить только автор обращения');
    end if;
    new.approved := false;
    if split_part(new.storage_path, '/', 1) <> auth.uid()::text then
      perform public.kgp_raise('KGP_PHOTO_PATH', 'Неверный путь к фото');
    end if;
  end if;
  if new.kind = 'before' and (select count(*) from public.complaint_photos p
      where p.complaint_id = new.complaint_id and p.kind = 'before') >= 3 then
    perform public.kgp_raise('KGP_PHOTO_LIMIT', 'Не более трёх фото');
  end if;
  if new.kind = 'after' and c.status not in ('published', 'sent', 'work', 'resolved_wait') then
    perform public.kgp_raise('KGP_STATUS', 'Фото «после» можно добавить только к актуальному обращению');
  end if;
  return new;
end
$$;

create trigger complaint_photos_before_insert
  before insert on public.complaint_photos
  for each row execute function public.complaint_photos_before_insert();

create function public.complaint_photos_after_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  st public.complaint_status;
begin
  if new.kind <> 'after' then return null; end if;
  select status into st from public.complaints where id = new.complaint_id;
  if tg_op = 'INSERT' and st in ('published', 'sent', 'work') then
    perform public.kgp_apply_status(new.complaint_id, 'resolved_wait', 'Автор', 'Автор приложил фото «после»');
  elsif tg_op = 'UPDATE' and new.approved and not old.approved and st <> 'resolved' then
    perform public.kgp_apply_status(new.complaint_id, 'resolved', 'Модератор', 'Фото «после» одобрено модератором');
  end if;
  return null;
end
$$;

create trigger complaint_photos_after_change
  after insert or update of approved on public.complaint_photos
  for each row execute function public.complaint_photos_after_change();
