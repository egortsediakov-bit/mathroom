# Mathroom Web v3.1

Облачная версия кабинета репетитора: **GitHub Pages + Supabase + Google Drive encrypted backup**.

Если у тебя уже работает v3.0, начни с `UPGRADE-v3.1.md`.

## Архитектура

- GitHub Pages — статический сайт.
- Supabase Auth — преподаватель + анонимные ученические сессии.
- Supabase PostgreSQL — ученики, темы, уроки, задания, история.
- Supabase Realtime — общая доска и live-состояние урока.
- Google Drive — ежедневные AES-256-GCM backup-файлы через `drive-backup` Edge Function.

## Чистая установка

1. Создай Supabase-проект.
2. SQL Editor → выполни `supabase/schema.sql`.
3. Включи Email Auth и Anonymous Sign-Ins.
4. Создай `config.js` по образцу `config.example.js`.
5. Опубликуй статические файлы через GitHub Pages.
6. При необходимости настрой `drive-backup` и Cron по существующей инструкции v3.0.

`config.js` содержит только Publishable key, не Service Role key. Секреты Google Drive и ключ шифрования хранятся только в Supabase Edge Function Secrets.
