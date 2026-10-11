# API серверной части

Клиенты обращаются к Supabase через `supabase-js` (сайт) и `supabase-kt` (Android).

- Чтение — из представлений и таблиц, права ограничены RLS.
- Запись — только через RPC (`POST /rest/v1/rpc/<name>`).
- Ошибки бизнес-правил приходят с SQLSTATE `P0001`; в тексте стабильный код до двоеточия: `KGP_RATE_LIMIT: Можно отправить не более 5 обращений в час`.

## Чтение

| Объект | Кто | Что |
|---|---|---|
| `complaint_feed` (view) | все | Обращения с `lat`, `lng`, `author_nickname`, `is_mine`, `supported_by_me`, `confirmed_by_me`, `photos` (jsonb: `path`, `kind`, `approved`) |
| `status_history` | все (по видимости обращения) | `id, complaint_id, old_status, new_status, actor_label, comment, created_at` |
| `categories`, `districts` | все | Справочники |
| `profiles` | все | Только `id, nickname` |
| `notifications` | владелец | Лента уведомлений; Realtime-канал `postgres_changes` по `user_id=eq.<uid>` |
| `report_feed` (view) | автор жалобы, модератор | Жалобы с заголовком обращения |
| `analytics_by_category`, `analytics_by_district`, `analytics_by_week`, `analytics_timing`, `analytics_export` | все | Обезличенная статистика (задел для Yandex DataLens), выгрузка CSV |

Видимость обращений:

- статусы `published`, `sent`, `work`, `resolved_wait`, `resolved`, `duplicate` — всем, включая гостей;
- `moderation`, `rejected` — автору и модераторам.

## RPC

| Функция | Роль | Назначение |
|---|---|---|
| `complete_profile(p_nickname, p_consent)` | вошедший | Никнейм и отдельное согласие на обработку ПДн (152-ФЗ); создаёт профиль |
| `my_profile()` | вошедший | Свой профиль и личная статистика (`null`, пока профиль не создан) |
| `update_my_settings(p_notify_enabled)` | пользователь | Настройка уведомлений (Ф-11) |
| `create_complaint(p_id, p_category, p_title, p_description, p_lat, p_lng, p_address, p_district, p_photos[])` | пользователь | Создание обращения. Идемпотентно по `p_id` — нужно для офлайн-черновиков. Фото загружаются заранее в `photos/<uid>/<p_id>/` |
| `nearby_duplicates(p_lat, p_lng, p_category, p_radius_m=30)` | все | Похожие обращения рядом (PostGIS `ST_DWithin`) |
| `set_support(p_id, p_on)` | пользователь | «Я тоже видел» / отмена; возвращает счётчик |
| `confirm_resolution(p_id, p_resolved)` | пользователь | «Решено» (третье подтверждение → `resolved`) / «Не решено» |
| `author_mark_sent(p_id)` | автор | «Я отправил обращение» → `sent` |
| `add_after_photo(p_id, p_path)` | автор | Фото «после» → `resolved_wait`, ждёт одобрения модератора |
| `report_complaint(p_id, p_reason)` | пользователь | Жалоба (Ф-14) |
| `mark_notifications_read(p_ids[] = null)` | пользователь | Прочитать выбранные или все |
| `stats_summary(p_days=21)` | все | KPI, по дням, категориям, статусам, районам, медианы |
| `moderate_set_status(p_id, p_status, p_comment)` | модератор | Смена статуса с комментарием (Ф-16, Ф-17) |
| `moderate_mark_duplicate(p_id, p_original)` | модератор | Объединение дублей; автор дубля становится поддержавшим |
| `moderate_review_after_photo(p_photo, p_approve)` | модератор | Одобрить фото «после» (→ `resolved`) или отклонить |
| `moderate_resolve_report(p_report, p_resolution, p_hide)` | модератор | Решение по жалобе; `p_hide` → `rejected` |
| `admin_list_users(p_search)` | модератор | Пользователи |
| `admin_set_blocked(p_user, p_blocked)`, `admin_set_role(p_user, p_role)` | админ | Блокировка (Ф-20), роли |

Справочники (`categories`, `districts`) админ меняет напрямую: RLS разрешает `insert` / `update` / `delete` только роли `admin` (Ф-19).

## Storage

Бакет `photos` приватный, до 2 МБ, только `image/jpeg`, `image/png`, `image/webp`.

- Запись — только в свою папку `<uid>/…`.
- Чтение через signed URL. Своё фото и фото опубликованных обращений видят все; фото «после» — только после одобрения; модератор видит всё.

## Edge Functions

| Функция | Назначение |
|---|---|
| `auth-yandex` | OAuth-колбэк Яндекс ID → пользователь Supabase → `token_hash` для `verifyOtp` |
| `auth-vk` | То же для VK ID (OAuth 2.1 + PKCE) |
| `delete-account` | Удаление аккаунта: файлы в Storage → `auth.admin.deleteUser` (каскад по всем таблицам) |

## Коды ошибок

| Код | Сообщение |
|---|---|
| `KGP_AUTH` | Требуется вход |
| `KGP_NOT_ALLOWED` | Учётная запись не завершила регистрацию, заблокирована или нет прав автора |
| `KGP_FORBIDDEN` | Нужны права модератора или администратора |
| `KGP_RATE_LIMIT` | Не более 5 обращений в час |
| `KGP_OUT_OF_CITY` | Точка за пределами Красноярска |
| `KGP_TITLE_LENGTH`, `KGP_DESCRIPTION_LENGTH` | Ограничения длины |
| `KGP_PHOTO_COUNT`, `KGP_PHOTO_PATH`, `KGP_PHOTO_MISSING`, `KGP_PHOTO_LIMIT` | Фото |
| `KGP_NICKNAME`, `KGP_NICK_TAKEN`, `KGP_CONSENT` | Регистрация |
| `KGP_STATUS`, `KGP_OWN`, `KGP_NOT_FOUND`, `KGP_CONFLICT`, `KGP_CATEGORY` | Прочие правила |
