# Перенос данных Mathroom v2.0 → Supabase

1. Сначала разверните `supabase/schema.sql`.
2. Зарегистрируйте преподавателя через Mathroom Web v3.0.
3. В Supabase Dashboard → Authentication → Users скопируйте UUID преподавателя.
4. В Dashboard → Project Settings → API получите **service role / secret key**. Никогда не добавляйте его в GitHub и `config.js`.
5. В Windows CMD перед запуском задайте переменные:

```cmd
set SUPABASE_URL=https://PROJECT.supabase.co
set SUPABASE_SERVICE_ROLE_KEY=YOUR_SECRET_SERVICE_ROLE_KEY
set TEACHER_ID=UUID_ПРЕПОДАВАТЕЛЯ
python import_v2_sqlite.py C:\путь\к\mathroom.db
```

Скрипт переносит учеников, персональные ссылки, темы, задачи, уроки, доски/листы, домашние, тесты, шаблоны и исторические версии досок. Импортированные локальные PDF/картинки из `data/uploads` пока не загружаются автоматически — их нужно перенести в Supabase Storage отдельным этапом.
