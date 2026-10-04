-- Mathroom v29.8.1 — PDF -> task bank import queue.
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

create or replace function public.mathroom_import_task_candidates(p_ids uuid[])
returns integer
language plpgsql
security invoker
set search_path=public
as $$
declare
  r public.task_bank_import_candidates;
  v_exercise_id uuid;
  v_count int := 0;
begin
  if auth.uid() is null then
    raise exception 'authentication_required';
  end if;

  for r in
    select *
    from public.task_bank_import_candidates
    where id = any(p_ids)
      and teacher_id = auth.uid()
      and status in ('pending','ready')
      and exercise_id is null
    order by confidence desc, created_at
  loop
    select e.id into v_exercise_id
    from public.exercises e
    where e.teacher_id = r.teacher_id
      and e.kind = 'task'
      and e.content = r.content
    limit 1;

    if v_exercise_id is null then
      insert into public.exercises(
        teacher_id, topic_id, kind, title, content, answer,
        difficulty, category, tags, generator_spec, generator_answer, favorite
      ) values (
        r.teacher_id,
        r.topic_id,
        'task',
        '№ ' || coalesce(nullif(r.task_no,''),'—') || ' · ' || r.topic_title,
        r.content,
        coalesce(r.answer,''),
        r.difficulty,
        r.topic_title,
        array[
          'mathroom-core-bank-v29.8-pdf',
          'mathroom-core-bank-v29.8-pdf:source:' || coalesce(r.source_id::text,''),
          'mathroom-core-bank-v29.8-pdf:page:' || r.page_no::text,
          'mathroom-core-bank-v29.8-pdf:task:' || coalesce(nullif(r.task_no,''),'?')
        ]::text[],
        jsonb_build_object(
          'type','pdf_import',
          'version','29.8.1',
          'candidate_id',r.id,
          'source_id',r.source_id,
          'textbook_id',r.textbook_id,
          'page_no',r.page_no,
          'task_no',r.task_no,
          'confidence',r.confidence,
          'source_title',r.source_title
        )::text,
        '',
        false
      ) returning id into v_exercise_id;
      v_count := v_count + 1;
    end if;

    update public.task_bank_import_candidates
    set status='imported', exercise_id=v_exercise_id, updated_at=now()
    where id=r.id and teacher_id=auth.uid();
  end loop;

  return v_count;
end;
$$;

grant execute on function public.mathroom_import_task_candidates(uuid[]) to authenticated;

comment on table public.task_bank_import_candidates is
'Mathroom v29.8 review queue for tasks extracted from indexed textbook PDF pages.';
