# Как довести сайт и приложение до полной работы

Код готов: сайт опубликован на GitHub Pages, APK собирается и подписывается в GitHub Actions. Чтобы появились
**общая база, регистрация и вход через Яндекс ID / VK ID**, нужен облачный сервер Supabase и два OAuth-приложения.
Пока этого нет, сайт и APK работают в **автономном демо-режиме**: данные хранятся только на устройстве,
кнопки «Яндекс ID» / «VK ID» помечены «нужен сервер».

## Что уже сделано

| Что | Состояние |
|---|---|
| Репозиторий, GitHub Pages, CI | работает: каждый push в `main` проверяется и публикует сайт |
| Ключ подписи APK | в Secrets: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` |
| База данных | миграции, RLS, RPC, Storage, Realtime, pgTAP-тесты — в `supabase/`, ждут проекта |
| Вход через Яндекс ID / VK ID | Edge Functions `auth-yandex`, `auth-vk` готовы, ждут ключей |
| Карта | векторная (OpenFreeMap), резерв — тайлы OSM, затем встроенный снимок; ключи не нужны |

## Чек-лист (≈40 минут)

### 1. Проект Supabase (≈10 мин)

1. Войдите на <https://supabase.com> (через GitHub) → **New project**: имя `kgp`, регион **Central EU (Frankfurt)**,
   задайте и сохраните **пароль базы**. Бесплатного тарифа достаточно.
2. **Project Settings → API**: скопируйте `Project URL` и ключ `anon public`.
   **Project Settings → General**: скопируйте `Reference ID`.
3. Аватар → **Account → Access Tokens → Generate new token** — это `SUPABASE_ACCESS_TOKEN`.
4. **Authentication → Sign In / Providers**:
   - **Allow anonymous sign-ins** → включить (нужен для демо-входа);
   - провайдер **Email** оставить включённым (вход через Яндекс/VK выдаёт одноразовую ссылку, письма не отправляются).

> Можно не делать шаги 2–6 вручную: пришлите токен из п. 3 — Claude создаст проект через CLI, применит миграции,
> задеплоит функции и пропишет секреты сам.

### 2. База и функции (≈3 мин, из корня репозитория)

```bash
npx supabase@2.120.0 login
npx supabase@2.120.0 link --project-ref <Reference ID>
npx supabase@2.120.0 db push --include-seed
npx supabase@2.120.0 functions deploy auth-yandex auth-vk delete-account
npx supabase@2.120.0 secrets set SITE_URL=https://virginshumor-ux.github.io/karta-gorodskih-problem/ KGP_STATE_SECRET=<случайная строка 32+ символа>
```

Проверка: в **Table Editor** появились таблицы `complaints`, `profiles`, `complaint_comments` и 15 демо-обращений.

### 3. Секреты GitHub (≈2 мин)

```bash
gh secret set SUPABASE_URL --body "https://<ref>.supabase.co"
gh secret set SUPABASE_ANON_KEY --body "<anon public>"
gh secret set SUPABASE_PROJECT_REF --body "<ref>"
gh secret set SUPABASE_ACCESS_TOKEN --body "<токен>"
gh secret set SUPABASE_DB_PASSWORD --body "<пароль базы>"
gh variable set SUPABASE_AUTO_MIGRATE --body true
```

Последняя строка включает автоматическое применение новых миграций при каждом деплое сайта.

### 4. Пересобрать сайт

```bash
gh workflow run web-deploy.yml
```

Через ~2 минуты откройте сайт: баннер «Автономный демо-режим» должен исчезнуть, демо-вход создаёт настоящую
учётную запись, обращения видны с любого устройства.

### 5. Яндекс ID (≈5 мин)

1. <https://oauth.yandex.ru/client/new> → название «Карта городских проблем», платформа **Веб-сервисы**.
2. Redirect URI: `https://<ref>.supabase.co/functions/v1/auth-yandex`.
3. Доступ: **Доступ к логину, имени и фамилии, полу** (`login:info`). Email и телефон не запрашивать (152-ФЗ: минимум данных).
4. Сохраните `ClientID` и `Client secret`:
   ```bash
   npx supabase@2.120.0 secrets set YANDEX_CLIENT_ID=<ClientID> YANDEX_CLIENT_SECRET=<Client secret>
   gh secret set YANDEX_CLIENT_ID --body "<ClientID>"
   ```

### 6. VK ID (≈10 мин)

1. <https://id.vk.com/about/business/go> → **Создать приложение** → **Web**.
2. Базовый домен `<ref>.supabase.co`, доверенный Redirect URL `https://<ref>.supabase.co/functions/v1/auth-vk`.
3. ```bash
   npx supabase@2.120.0 secrets set VK_CLIENT_ID=<ID приложения> VK_CLIENT_SECRET=<Защищённый ключ>
   gh secret set VK_CLIENT_ID --body "<ID приложения>"
   ```
4. Снова `gh workflow run web-deploy.yml`, чтобы сайт узнал ID приложений.

### 7. Проверка входа (5 мин)

- Сайт → «Войти через Яндекс ID» → согласие у Яндекса → возврат на сайт → форма никнейма и отдельного согласия (152-ФЗ) → профиль.
- То же для VK ID.
- Создайте обращение с фото, откройте сайт в другом браузере — обращение видно «на модерации» только вам.
- Профиль → «Удалить учётную запись и мои данные» — профиль, обращения и фото удаляются.

### 8. Роль модератора

После первого входа выполните в **SQL Editor**:

```sql
update public.profiles set role = 'moderator' where nickname = '<ваш никнейм>';
```

Панель модератора — `#/admin` на сайте.

### 9. Новый APK

```bash
git tag v1.2.0 && git push origin v1.2.0
```

Workflow `android-build.yml` соберёт подписанный APK с адресом сервера и приложит его к релизу;
постоянная ссылка `…/releases/latest/download/kgp.apk` начнёт отдавать новую версию.

## Если что-то не работает

| Симптом | Причина и решение |
|---|---|
| Кнопки входа серые («нужен сервер» / «скоро») | нет `SUPABASE_*` или `YANDEX_CLIENT_ID` / `VK_CLIENT_ID` в Secrets — шаги 3, 5, 6 и пересборка |
| После Яндекса «Ссылка входа устарела» | неверный `SITE_URL` или Redirect URI; адреса должны совпадать символ в символ |
| Демо-вход: «Anonymous sign-ins are disabled» | шаг 1.4 |
| Карта без улиц, внизу «Встроенная карта» | недоступны и OpenFreeMap, и тайлы OSM — проверьте сеть; приложение продолжает работать на снимке |
| Нет уведомлений на Android | разрешите уведомления приложению; проверка идёт каждые 15 минут (WorkManager) |

## Что можно развивать дальше

- Синхронизация игрового прогресса (уровень, шишки) между устройствами — сейчас он хранится на устройстве.
- Мини-игры и квесты в Android-приложении (на сайте уже есть).
- Размещение в облаке на территории РФ (Yandex Cloud) для промышленной версии — по 152-ФЗ ч. 5 ст. 18.
