-- Mathroom v56.1 — indexes for teacher boot/load queries.
-- Applied to production Supabase on 2026-10-21.

create index if not exists idx_exercises_teacher_created
  on public.exercises(teacher_id, created_at);

create index if not exists idx_topics_teacher_order
  on public.topics(teacher_id, grade, section, title);

create index if not exists idx_homeworks_teacher_created
  on public.homeworks(teacher_id, created_at desc);

create index if not exists idx_tests_teacher_created
  on public.tests(teacher_id, created_at desc);
