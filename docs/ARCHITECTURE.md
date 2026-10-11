# Архитектура «Карты городских проблем»

## 1. Общая схема

```
  Android (Kotlin, Compose, osmdroid, Room, WorkManager) ──┐
                                                           ├─► Supabase
  Сайт PWA (Vite + TS, Leaflet, IndexedDB, Service Worker) ┘     PostgreSQL 17 + PostGIS (RLS, триггеры, RPC)
                                                                 Auth (anonymous + Яндекс ID / VK ID через Edge Functions)
                                                                 Storage (бакет photos, приватный, signed URL)
                                                                 Realtime (notifications, complaints)
                                                                 Edge Functions (Deno): auth-yandex, auth-vk, delete-account
  Открытые API без ключей: тайлы OSM (+ зеркала osm.de, osm.fr), Open-Meteo, Nominatim → Photon
```

Оба клиента работают с одной базой. Бизнес-правила выполняются на сервере, а не в клиенте:
счётчики, статусы, лимиты, bbox, история, уведомления. Клиенты только вызывают RPC и читают представления.

## 2. Монорепозиторий

| Путь | Содержимое |
|---|---|
| `android/` | Gradle Kotlin DSL + version catalog, модуль `app` (`ru.sfu.kgp`) |
| `web/` | Vite + TypeScript strict: `src/api`, `src/map`, `src/screens`, `src/state`, `src/ui` |
| `supabase/` | `migrations/`, `functions/`, `tests/` (pgTAP), `seed.sql`, `config.toml` |
| `docs/` | `handoff/` (материалы ПР1/ПР2), `ARCHITECTURE.md`, `API.md`, `TESTING.md`, `MANUAL_STEPS.md`, `privacy.md` |
| `.github/workflows/` | `ci.yml`, `web-deploy.yml`, `android-build.yml` |

## 3. Модель данных

Схема `public`, геоданные — `geography(Point, 4326)`.

- `profiles` (id = `auth.users.id`): `nickname` (уникальный, 3–24), `provider` (`yandex`/`vk`/`demo`),
  `external_id`, `role` (`user`/`moderator`/`admin`), `pd_consent_at`, `is_blocked`, `created_at`.
  Публично читаются только `id` и `nickname` (права на уровне столбцов).
- `categories` — 9 категорий из прототипа (`id`, `name`, `icon`, `color`, `org_hint`, `sort`).
- `districts` — 7 районов Красноярска, `boundary geography(Polygon)` может быть пустым (см. §7).
- `complaints` — обращение; `lat`/`lng` — генерируемые столбцы из `location` для удобства клиентов.
  Поля `is_demo` и `demo_author` нужны для 15 демо-записей без реальных авторов.
- `complaint_photos` — `storage_path`, `kind` (`before`/`after`), `approved` (для «после»), `size_bytes`.
- `status_history` — заполняется только триггером `AFTER UPDATE OF status`.
- `supports` (PK `user_id, complaint_id`), `confirmations` (PK `user_id, complaint_id`, `value boolean`).
- `notifications` — создаются триггером при создании и смене статуса для автора и поддержавших.
- `reports` — жалобы на обращения: причина, решение модератора.

### Статусы

```
moderation ─► published ─► sent ─► work ─► resolved_wait ─► resolved
     │            ▲  │                         │  ▲ 3 подтверждения
     ├─► rejected │  └──────────► resolved_wait │  │ или одобренное фото «после»
     └─► duplicate└──── «Не решено» ◄───────────┘
```

Кто может менять статус:

- **Модератор** — любой переход через RPC `moderate_set_status`.
- **Автор** — только `published → sent` («Я отправил официальное обращение»).
- **Жители** — через `confirm_resolution`: «Решено» переводит в `resolved_wait`, третье подтверждение — в `resolved`;
  «Не решено» возвращает в `published` и обнуляет подтверждения.

### Серверные правила

| Правило | Где |
|---|---|
| Длины title 5–80, description ≤ 500, точка в bbox 55.90–56.14 / 92.60–93.20 | CHECK + триггер `complaints_validate` |
| Не более 5 обращений в час | триггер `complaints_validate` |
| Счётчики `supports_count`, `confirms_count` | триггеры на `supports`, `confirmations` |
| История статусов, уведомления | триггер `complaints_status_changed` |
| Заблокированный пользователь не пишет | `kgp_is_active_user()` в RLS-политиках |
| Поиск дублей в радиусе 30 м | RPC `nearby_duplicates(lat, lng, category, radius_m)` (PostGIS `ST_DWithin`) |
| Статистика | RPC `stats_summary()` + представления `analytics_*` |

## 4. Аутентификация (406-ФЗ)

1. **Демо-вход** — `signInAnonymously()` в Supabase Auth, затем никнейм и согласие на обработку ПДн.
   Управляется флагом `DEMO_LOGIN_ENABLED` / `VITE_DEMO_LOGIN_ENABLED`.
2. **Яндекс ID** (OAuth 2.0, authorization code).
   - Redirect URI один для обоих клиентов: Edge Function `auth-yandex`.
   - Функция обменивает `code` на токен (client secret хранится только в секретах функции).
   - Затем запрашивает `login.yandex.ru/info` и находит или создаёт пользователя Supabase через admin API
     (служебный email `ya-<id>@users.kgp.invalid` наружу не показывается).
   - Через `generateLink(magiclink)` получает `token_hash` и перенаправляет на клиент:
     - сайт: `…/#/auth/callback?token_hash=…`
     - Android: `kgp://auth/callback?token_hash=…`
   - Клиент вызывает `verifyOtp({ token_hash, type: 'magiclink' })` и получает обычную сессию Supabase (JWT 1 ч + refresh).
3. **VK ID** — тот же механизм (`auth-vk`, OAuth 2.1 + PKCE).
4. Первый вход: экран никнейма и **отдельного** согласия на обработку ПДн → RPC `complete_profile`.
5. Без входа доступны карта, список, карточки, погода, статистика.
   Действие, которое требует входа, запоминается и выполняется после входа (как `S.pending` в прототипе).

Удаление аккаунта (Ф-15) — Edge Function `delete-account`:

- удаляет файлы пользователя из Storage через Storage API (прямой `DELETE` из `storage.objects` Supabase запрещает);
- затем `auth.admin.deleteUser`. Каскад удаляет профиль, обращения, поддержки, подтверждения и уведомления.

## 5. Сайт (web/)

- Перенос прототипа 1:1: те же разметка, классы, `style.css` (токены без изменений), тексты, порядок экранов.
- Модули:
  - `state/` — стор `S` и фильтры;
  - `api/` — интерфейс `Backend` с реализациями `SupabaseBackend` и `LocalBackend` (IndexedDB, автономный демо-режим, когда сервер не настроен);
  - `map/` — тайлы, `isBlockedTile`, снимки, кластеризация;
  - `screens/` — экраны;
  - `ui/` — модалки, тосты, иконки.
- Hash-роутер (`#/list`, `#/c/<id>`, `#/create`, `#/admin`…), потому что GitHub Pages не делает SPA-fallback.
- Офлайн:
  - Service Worker кэширует оболочку и просмотренные тайлы;
  - IndexedDB хранит кэш обращений и черновики (Ф-07), черновики отправляются при `online`.
- `#/admin`: очередь модерации, статусы, дубли, жалобы, блокировки, справочники, аналитика, CSV (Ф-16…Ф-22).

## 6. Android (android/)

- Одна `MainActivity`, Navigation Compose, MVVM: ViewModel + `StateFlow`, репозитории, ручной DI через `AppContainer`.
- `supabase-kt` (Auth, Postgrest, Storage, Realtime) на Ktor OkHttp.
- osmdroid с собственным `User-Agent` и цепочкой `XYTileSource` (osm.org → osm.de → osm.fr).
  Проверка первого тайла на заглушку «Access blocked».
- Камера и галерея — `TakePicture` / `PickVisualMedia`. Сжатие до 1280 px, JPEG 80, EXIF удаляется.
- Геолокация — `LocationManager` (без GMS).
- Room: черновики (Ф-07) и кэш обращений.
- WorkManager:
  - `DraftUploadWorker` (constraint CONNECTED);
  - `NotificationPollWorker` (периодический, раз в 15 мин) → локальные уведомления.
- Жизненный цикл: черновик мастера в `SavedStateHandle` и в Room на `onStop`.

## 7. Ограничения и допущения

- Supabase размещается вне РФ. Промышленная версия по ТЗ (152-ФЗ, ст. 18 ч. 5) переносится в российское облако.
  Схема переносима: PostgreSQL + PostGIS, S3-совместимое хранилище, Edge Functions → любой Deno/Node-хостинг.
- Надёжных открытых полигонов районов Красноярска в репозитории нет.
  Поэтому `districts.boundary` пуст, а район обращения хранится текстом из геокодера.
  Если позже загрузить полигоны, триггер заполнит `district` по `ST_Covers`.
- Push через FCM не используется (нужен Firebase). На Android уведомления приходят через периодический WorkManager,
  на сайте — через Realtime.

## 8. План работ (этапы)

1. Подготовка: эта схема, монорепо, CI-заготовки, `.env.example`, `MANUAL_STEPS.md`.
2. Бэкенд: миграции, RLS, триггеры, RPC, Storage, сид, pgTAP-тесты.
3. Сайт: перенос прототипа на Vite/TS, Supabase, офлайн, PWA, `#/admin`, Vitest + Playwright.
4. Авторизация: `auth-yandex`, `auth-vk`, демо-вход, согласие на ПДн, `delete-account`.
5. Android: экраны Compose, osmdroid, камера, геолокация, Room, WorkManager, вход. Тесты.
6. Сборка и публикация: подписанный APK, GitHub Pages, README с QR-кодами.
7. Финальная проверка и отчёт.
