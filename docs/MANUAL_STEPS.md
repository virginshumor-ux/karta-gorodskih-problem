# Шаги, которые нужно выполнить вручную

Всё, что можно сделать без человека, уже сделано в коде. Пока эти шаги не выполнены:

- сайт и APK работают в **автономном демо-режиме** — данные хранятся только на устройстве;
- кнопки «Яндекс ID» / «VK ID» показывают пометку «настраивается».

Порядок важен: шаги 1–2 открывают общую базу, остальные — по мере готовности.

## 1. Облачный проект Supabase (≈10 мин)

1. Зарегистрируйтесь на <https://supabase.com> (вход через GitHub).
2. **New project**:
   - Name `kgp`;
   - Region — ближайший к РФ (например, `Central EU (Frankfurt)`);
   - задайте и сохраните пароль базы.
3. Откройте **Project Settings → API** и скопируйте:
   - `Project URL` → `SUPABASE_URL`;
   - `anon public` → `SUPABASE_ANON_KEY`;
   - `Reference ID` (Settings → General) → `SUPABASE_PROJECT_REF`.
4. Получите **Access token**: аватар → **Account → Access Tokens → Generate new token** → `SUPABASE_ACCESS_TOKEN`.
5. Включите анонимный вход (нужен для демо-входа): **Authentication → Sign In / Providers → Allow anonymous sign-ins → Enable**.
6. Примените миграции из корня репозитория:
   ```bash
   npx supabase@2.120.0 login
   npx supabase@2.120.0 link --project-ref <SUPABASE_PROJECT_REF>
   npx supabase@2.120.0 db push --include-seed
   npx supabase@2.120.0 functions deploy auth-yandex auth-vk delete-account
   ```

## 2. Ключи для клиентов

- Сайт локально: создайте `web/.env.local`:
  ```
  VITE_SUPABASE_URL=...
  VITE_SUPABASE_ANON_KEY=...
  ```
- Android локально: добавьте в `android/local.properties`:
  ```
  supabase.url=...
  supabase.anonKey=...
  ```
- CI: **GitHub → Settings → Secrets and variables → Actions → New repository secret**:
  `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD`.

## 3. Яндекс ID (≈5 мин)

1. Откройте <https://oauth.yandex.ru/client/new> и войдите аккаунтом Яндекса.
2. Название — «Карта городских проблем». Платформа — **Веб-сервисы**.
3. Redirect URI: `https://<project-ref>.supabase.co/functions/v1/auth-yandex`.
4. Доступы: **Доступ к логину, имени и фамилии, полу** (`login:info`). Email не нужен.
5. Сохраните `ClientID` и `Client secret`, затем выполните:
   ```bash
   npx supabase@2.120.0 secrets set YANDEX_CLIENT_ID=... YANDEX_CLIENT_SECRET=... SITE_URL=https://<user>.github.io/<repo>/
   ```
6. Тот же `ClientID` добавьте в GitHub Secrets как `YANDEX_CLIENT_ID` (он публичный, нужен клиентам).

## 4. VK ID (по желанию, ≈10 мин)

1. Откройте <https://id.vk.com/about/business/go> → **Создать приложение** → тип **Web**.
2. Базовый домен — `<project-ref>.supabase.co`. Доверенный Redirect URL — `https://<project-ref>.supabase.co/functions/v1/auth-vk`.
3. Выполните:
   ```bash
   npx supabase@2.120.0 secrets set VK_CLIENT_ID=... VK_CLIENT_SECRET=...
   ```
4. Добавьте `VK_CLIENT_ID` в GitHub Secrets.

## 5. Роль модератора

После первого входа найдите свой `id` в **Table Editor → profiles** и выполните в **SQL Editor**:

```sql
update public.profiles set role = 'moderator' where nickname = '<ваш никнейм>';
```

## 6. Публикация (когда решите опубликовать)

1. Создайте репозиторий на GitHub (для бесплатного GitHub Pages — публичный) и отправьте код:
   ```bash
   gh repo create <repo> --public --source . --push
   ```
2. **Settings → Pages → Source: GitHub Actions**.
3. Ключ подписи APK (один раз, хранить в надёжном месте, **не коммитить**):
   ```bash
   keytool -genkeypair -v -keystore kgp-release.jks -alias kgp -keyalg RSA -keysize 2048 -validity 10000
   base64 -w0 kgp-release.jks > kgp-release.jks.b64
   ```
   Затем добавьте в Secrets: `ANDROID_KEYSTORE_BASE64` (содержимое `.b64`), `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS=kgp`, `ANDROID_KEY_PASSWORD`.
4. Релиз:
   ```bash
   git tag v1.0.0 && git push origin v1.0.0
   ```
   Workflow `android-build.yml` соберёт подписанный APK и приложит его к GitHub Release.
