-- Core schema: reference data, complaints and everything attached to them.
-- Geodata uses geography(Point, 4326); lat/lng are the source columns, location is derived.

create extension if not exists postgis with schema extensions;

create type public.complaint_status as enum (
  'moderation', 'published', 'sent', 'work', 'resolved_wait', 'resolved', 'rejected', 'duplicate'
);
create type public.photo_kind as enum ('before', 'after');
create type public.user_role as enum ('user', 'moderator', 'admin');

-- ---------- reference data ----------

create table public.categories (
  id text primary key check (id ~ '^[a-z_]{2,20}$'),
  name text not null check (char_length(name) between 2 and 60),
  icon text not null,
  color text not null check (color ~ '^#[0-9a-fA-F]{6}$'),
  org_hint text not null default '',
  sort smallint not null default 0,
  is_active boolean not null default true
);

-- Same order, names, icons and colors as the prototype (CATS in app.js).
insert into public.categories (id, name, icon, color, org_hint, sort) values
  ('road',    'Дороги и ямы',                 'add_road',        '#5b5f97', 'МКУ «Управление дорог, инфраструктуры и благоустройства»', 1),
  ('light',   'Освещение',                    'lightbulb',       '#c08a00', 'Эксплуатирующая организация сетей наружного освещения', 2),
  ('trash',   'Мусор и свалки',               'delete',          '#6b7b2a', 'Региональный оператор по обращению с ТКО', 3),
  ('snow',    'Снег и наледь',                'ac_unit',         '#2f7fb5', 'Администрация района / управляющая компания', 4),
  ('ice',     'Сосульки и опасные кровли',    'warning',         '#b3471d', 'Управляющая компания / собственник здания', 5),
  ('yard',    'Двор и придомовая территория', 'holiday_village', '#8a4f8f', 'Управляющая компания / ТСЖ', 6),
  ('green',   'Благоустройство и озеленение', 'park',            '#2e7d4f', 'Администрация района', 7),
  ('transit', 'Транспорт и остановки',        'directions_bus',  '#0b6c78', 'Департамент транспорта администрации города', 8),
  ('other',   'Прочее',                       'more_horiz',      '#6a6f73', 'Администрация района', 9);

create table public.districts (
  id smallint generated always as identity primary key,
  name text not null unique,
  -- Optional: no reliable open polygons are bundled; when filled, complaints get their district by ST_Covers.
  boundary extensions.geography(MultiPolygon, 4326)
);

insert into public.districts (name) values
  ('Железнодорожный район'), ('Кировский район'), ('Ленинский район'), ('Октябрьский район'),
  ('Свердловский район'), ('Советский район'), ('Центральный район');

-- ---------- users ----------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  nickname text not null check (
    char_length(nickname) between 3 and 24 and nickname ~ '^[0-9A-Za-zА-Яа-яЁё_.\- ]+$'
  ),
  provider text not null default 'demo' check (provider in ('yandex', 'vk', 'demo')),
  external_id text,
  role public.user_role not null default 'user',
  pd_consent_at timestamptz not null,
  is_blocked boolean not null default false,
  notify_enabled boolean not null default true,
  created_at timestamptz not null default now()
);
-- Case-insensitive key that does not depend on the server locale (lower() ignores Cyrillic under the C locale).
create function public.kgp_nick_key(p text)
returns text language sql immutable parallel safe set search_path = '' as $$
  select lower(translate(p, 'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ', 'абвгдеёжзийклмнопрстуфхцчшщъыьэюя'))
$$;
create unique index profiles_nickname_ci on public.profiles (public.kgp_nick_key(nickname));

-- ---------- complaints ----------

create table public.complaints (
  id uuid primary key default gen_random_uuid(),
  author_id uuid references auth.users (id) on delete cascade,
  category_id text not null references public.categories (id),
  title text not null check (char_length(title) between 5 and 80),
  description text not null default '' check (char_length(description) <= 500),
  lat double precision not null,
  lng double precision not null,
  location extensions.geography(Point, 4326)
    generated always as (extensions.st_setsrid(extensions.st_makepoint(lng, lat), 4326)::extensions.geography) stored,
  address text not null check (char_length(address) between 1 and 200),
  district text not null default '' check (char_length(district) <= 100),
  status public.complaint_status not null default 'moderation',
  duplicate_of uuid references public.complaints (id) on delete set null,
  supports_count integer not null default 0 check (supports_count >= 0),
  confirms_count integer not null default 0 check (confirms_count >= 0),
  is_demo boolean not null default false,
  demo_author text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  resolved_at timestamptz,
  -- Krasnoyarsk bounding box from the TZ / prototype (KRSK_BOX).
  constraint complaints_in_city check (lat > 55.90 and lat < 56.14 and lng > 92.60 and lng < 93.20),
  constraint complaints_author_or_demo check (author_id is not null or is_demo),
  constraint complaints_duplicate_link check (status <> 'duplicate' or duplicate_of is not null)
);
create index complaints_location_gix on public.complaints using gist (location);
create index complaints_status_idx on public.complaints (status);
create index complaints_author_idx on public.complaints (author_id, created_at desc);
create index complaints_created_idx on public.complaints (created_at desc);
create index complaints_category_idx on public.complaints (category_id);

create table public.complaint_photos (
  id uuid primary key default gen_random_uuid(),
  complaint_id uuid not null references public.complaints (id) on delete cascade,
  storage_path text not null unique check (char_length(storage_path) <= 300),
  kind public.photo_kind not null default 'before',
  -- "after" photos become public and resolve the complaint only after a moderator approves them.
  approved boolean not null default false,
  size_bytes integer check (size_bytes is null or size_bytes between 1 and 2097152),
  created_at timestamptz not null default now()
);
create index complaint_photos_complaint_idx on public.complaint_photos (complaint_id);

create table public.status_history (
  id bigint generated always as identity primary key,
  complaint_id uuid not null references public.complaints (id) on delete cascade,
  old_status public.complaint_status,
  new_status public.complaint_status not null,
  changed_by uuid references auth.users (id) on delete set null,
  actor_label text not null default '',
  comment text not null default '',
  created_at timestamptz not null default now()
);
create index status_history_complaint_idx on public.status_history (complaint_id, created_at desc);

create table public.supports (
  user_id uuid not null references auth.users (id) on delete cascade,
  complaint_id uuid not null references public.complaints (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, complaint_id)
);
create index supports_complaint_idx on public.supports (complaint_id);

create table public.confirmations (
  user_id uuid not null references auth.users (id) on delete cascade,
  complaint_id uuid not null references public.complaints (id) on delete cascade,
  value boolean not null,
  created_at timestamptz not null default now(),
  primary key (user_id, complaint_id)
);
create index confirmations_complaint_idx on public.confirmations (complaint_id);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  complaint_id uuid references public.complaints (id) on delete cascade,
  text text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  complaint_id uuid not null references public.complaints (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  reason text not null check (char_length(reason) between 3 and 200),
  created_at timestamptz not null default now(),
  resolution text,
  resolved_by uuid references auth.users (id) on delete set null,
  resolved_at timestamptz,
  unique (complaint_id, user_id)
);
create index reports_open_idx on public.reports (created_at desc) where resolved_at is null;
