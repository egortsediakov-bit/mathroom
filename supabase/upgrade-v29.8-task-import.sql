-- Mathroom v29.8.0 — PDF -> task bank import queue.
-- Run once in Supabase Dashboard -> SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.task_bank_import_candidates (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.teachers(id) on delete cascade,
  source_id uuid,
  textbook_id uuid,
  topic_id uuid not null references public.topics(id) on delete cascade,
  exercise_id uuid references public.exercises(id) on delete set null,
  grade int check (grade between 1 and 11),
  topic_title text not null default '',
  source_title text not null default '',
  page_no int not null check (page_no > 0),
  task_no text not null default '',
  content text not null,
  answer text not null default '',
  confidence numeric not null default 0 check (confidence >= 0 and confidence <= 1),
  difficulty text not null default 'medium' check (difficulty in ('basic','medium','advanced')),
  fingerprint text not null,
  status text not null default 'pending' check (status in ('pending','ready','imported','rejected')),
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(teacher_id, fingerprint)
);

create index if not exists idx_task_bank_import_teacher_status
  on public.task_bank_import_candidates(teacher_id, status, confidence desc);
create index if not exists idx_task_bank_import_source_page
  on public.task_bank_import_candidates(source_id, page_no);
create index if not exists idx_task_bank_import_topic
  on public.task_bank_import_candidates(topic_id);

alter table public.task_bank_import_candidates enable row level security;

drop policy if exists task_bank_import_teacher_select on public.task_bank_import_candidates;
drop policy if exists task_bank_import_teacher_insert on public.task_bank_import_candidates;
drop policy if exists task_bank_import_teacher_update on public.task_bank_import_candidates;
drop policy if exists task_bank_import_teacher_delete on public.task_bank_import_candidates;

create policy task_bank_import_teacher_select
on public.task_bank_import_candidates for select to authenticated
using (teacher_id = auth.uid());

create policy task_bank_import_teacher_insert
on public.task_bank_import_candidates for insert to authenticated
with check (teacher_id = auth.uid());

create policy task_bank_import_teacher_update
on public.task_bank_import_candidates for update to authenticated
using (teacher_id = auth.uid())
with check (teacher_id = auth.uid());

create policy task_bank_import_teacher_delete
on public.task_bank_import_candidates for delete to authenticated
using (teacher_id = auth.uid());

comment on table public.task_bank_import_candidates is
'Mathroom v29.8 review queue for tasks extracted from indexed textbook PDF pages.';
