# Mathroom Web v3.0

Первая облачная версия Mathroom без локального Python-сервера.

## Архитектура

- **GitHub Pages** — интерфейс сайта.
- **Supabase Auth** — вход преподавателя и анонимные сессии учеников.
- **Supabase PostgreSQL** — ученики, темы, задачи, расписание, уроки и состояния досок.
- **Supabase Realtime** — совместная доска.
- **Supabase Storage** — подготовлено хранилище `mathroom-materials` для PDF/изображений.
- **Supabase Edge Function + Cron** — ежедневный зашифрованный backup в Google Drive.

## Что уже перенесено в v3.0

- аккаунт преподавателя через email/password;
- ученики: имя + класс + персональная ссылка;
- перевыпуск ссылки с отзывом ранее выданных анонимных сессий;
- темы и теория;
- примеры и банк задач;
- категории, теги и уровни сложности в схеме БД;
- расписание;
- режим урока: материалы слева + общая доска справа;
- несколько листов доски;
- realtime-доска преподаватель ↔ ученик;
- перо, линии, прямоугольники, окружности, текст;
- бесконечное перемещение и масштабирование;
- выделение и перемещение объектов;
- `Ctrl+Z`, `Ctrl+Y` и кнопка `↶ Назад` как Undo;
- ученический вход без логина и пароля;
- подготовленные таблицы для домашних, тестов, истории и версий доски;
- одноразовый импорт основной базы из Mathroom Python v2.0;
- ежедневный зашифрованный backup PostgreSQL-данных в Google Drive.

Расширенные функции Python v2.0 (SymPy-проверка, импорт PDF прямо на доску, видео, очередь урока и часть аналитики) пока остаются в старой версии и будут переноситься поверх этой облачной основы следующими релизами. Старую v2.0 пока не удаляйте.

---

# 1. Создать Supabase

1. Создайте новый проект Supabase.
2. Откройте **SQL Editor**.
3. Вставьте целиком содержимое `supabase/schema.sql` и выполните.
4. Откройте **Authentication → Providers** и включите:
   - Email;
   - Anonymous Sign-Ins.
5. После выполнения `schema.sql` откройте **Realtime Settings** и отключите `Allow public access`: v3.0 использует приватные Realtime-каналы с RLS.

`schema.sql` создаёт таблицы, RLS-политики, функции безопасного входа ученика и Storage bucket.

---

# 2. Подключить сайт к Supabase

Откройте `config.js`:

```js
window.MATHROOM_CONFIG = {
  SUPABASE_URL: 'https://YOUR_PROJECT.supabase.co',
  SUPABASE_ANON_KEY: 'YOUR_PUBLISHABLE_KEY',
  APP_NAME: 'Mathroom'
};
```

Вставьте значения из **Supabase → Project Settings / Connect / API**.

Публичный/anon key можно хранить в GitHub Pages: безопасность данных обеспечивается RLS. **Secret/service-role key в `config.js` добавлять нельзя.**

---

# 3. Проверить локально

Это уже полностью статический сайт. Python нужен только как простой локальный HTTP-сервер:

```cmd
cd C:\путь\к\mathroom-web-v3.0
python -m http.server 8000
```

Откройте:

```text
http://127.0.0.1:8000
```

Создайте аккаунт преподавателя. Если в Supabase включено подтверждение email, подтвердите письмо и затем войдите.

Создайте ученика и откройте его ссылку **в режиме инкогнито или на другом устройстве**. В одном обычном окне браузера нельзя одновременно держать учительскую и анонимную ученическую Supabase-сессию одного origin.

---

# 4. Опубликовать на GitHub Pages

В проект уже добавлен workflow:

```text
.github/workflows/pages.yml
```

1. Создайте GitHub-репозиторий, например `mathroom`.
2. Загрузите содержимое этой папки в корень репозитория.
3. GitHub → **Settings → Pages**.
4. Source: **GitHub Actions**.
5. Сделайте push в ветку `main`.

Через несколько минут сайт будет доступен примерно по адресу:

```text
https://USERNAME.github.io/mathroom/
```

После этого в Supabase Authentication → URL Configuration добавьте этот адрес как Site URL / Redirect URL.

Персональная ссылка ученика будет генерироваться автоматически от текущего адреса сайта:

```text
https://USERNAME.github.io/mathroom/?access=...
```

---

# 5. Перенести данные из Python v2.0

Не обязательно, если база была тестовой.

Инструкция находится в:

```text
migration/README.md
```

Скрипт `migration/import_v2_sqlite.py` переносит основные данные из `mathroom.db` в Supabase. Он использует service-role key только локально и не отправляет его в GitHub.

Перед миграцией обязательно сохраните старый `mathroom.db` отдельно.

---

# 6. Ежедневный backup в Google Drive

В проекте уже лежит Edge Function:

```text
supabase/functions/drive-backup/index.ts
```

Она:

1. считывает таблицы Mathroom service-role клиентом;
2. формирует JSON;
3. сжимает его gzip;
4. шифрует AES-256-GCM;
5. загружает `.json.gz.enc` в указанную папку Google Drive.

Нужные секреты Edge Function:

```text
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
GOOGLE_REFRESH_TOKEN
GOOGLE_DRIVE_FOLDER_ID
BACKUP_CRON_SECRET
BACKUP_ENCRYPTION_KEY_B64
```

Сгенерировать 256-битный ключ шифрования можно локально:

```cmd
python -c "import secrets,base64; print(base64.b64encode(secrets.token_bytes(32)).decode())"
```

Сохраните этот ключ отдельно от Google Drive. Без него зашифрованный архив восстановить нельзя.

После публикации Edge Function откройте `supabase/cron.sql`, замените три placeholder-значения и выполните в SQL Editor. По умолчанию cron стоит на `00:15 UTC` ежедневно.

Для проверки/расшифровки резервной копии есть локальная утилита:

```text
tools/decrypt-backup.html
```

Она работает полностью в браузере и никуда не отправляет файл или ключ.

---

# Важное про Google Drive

Google Drive в этой архитектуре **не является живой БД**. Сайт продолжает работать через Supabase даже если Drive временно недоступен. Drive нужен как резервная копия, а позже его можно использовать как холодный архив тяжёлых старых материалов.

---

# Безопасность

- В браузере находится только publishable/anon key Supabase.
- Все основные таблицы защищены RLS.
- Ученик сначала создаёт анонимную Auth-сессию, а персональный token привязывает только эту сессию к конкретному ученику.
- Realtime-доска использует private channels и отдельные policies `realtime.messages`.
- Перевыпуск персональной ссылки удаляет существующие `student_sessions` для этого ученика.
- Google OAuth refresh token, service-role/secret key и ключ шифрования хранятся только в Edge Function Secrets.

Для реального использования с персональными данными учеников из РФ отдельно проверьте требования к локализации и трансграничной обработке данных.
