-- Mathroom v63.1 — preserve task builder media in lessons, homework and tests.
-- Production migration applied via Supabase MCP on 2026-11-10.

alter table public.homework_items
  add column if not exists builder_meta jsonb not null default '{}'::jsonb;

alter table public.test_items
  add column if not exists builder_meta jsonb not null default '{}'::jsonb;

alter table public.lesson_queue_items
  add column if not exists builder_meta jsonb not null default '{}'::jsonb;

alter table public.lesson_live_state
  add column if not exists current_builder_meta jsonb not null default '{}'::jsonb;

do $$
declare
  rec record;
begin
  for rec in
    select * from (values
      ('homework_items','homework_items_builder_meta_object_chk','builder_meta'),
      ('test_items','test_items_builder_meta_object_chk','builder_meta'),
      ('lesson_queue_items','lesson_queue_items_builder_meta_object_chk','builder_meta'),
      ('lesson_live_state','lesson_live_state_builder_meta_object_chk','current_builder_meta')
    ) as v(table_name,constraint_name,column_name)
  loop
    if not exists (
      select 1 from pg_constraint
      where conrelid=('public.'||rec.table_name)::regclass
        and conname=rec.constraint_name
    ) then
      execute format(
        'alter table public.%I add constraint %I check (jsonb_typeof(%I)=''object'')',
        rec.table_name,rec.constraint_name,rec.column_name
      );
    end if;
  end loop;
end $$;

create or replace function public.get_student_homework(p_homework_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare h public.homeworks; items jsonb;
begin
  select * into h from public.homeworks where id=p_homework_id and public.is_my_student(student_id);
  if h.id is null then raise exception 'forbidden'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',i.id,
    'prompt',i.prompt,
    'student_answer',i.student_answer,
    'is_correct',case when h.status='assigned' then null else i.is_correct end,
    'position',i.position,
    'builder_meta',coalesce(i.builder_meta,'{}'::jsonb),
    'teacher_feedback',i.teacher_feedback
  ) order by i.position),'[]'::jsonb)
  into items from public.homework_items i where i.homework_id=h.id;
  return jsonb_build_object(
    'id',h.id,'title',h.title,'status',h.status,'score',h.score,'comment',h.comment,
    'due_at',h.due_at,'attempt_count',h.attempt_count,'reviewed_at',h.reviewed_at,
    'revision_requested_at',h.revision_requested_at,'revision_message',h.revision_message,
    'items',items
  );
end; $$;

create or replace function public.get_student_test(p_test_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare t public.tests; items jsonb;
begin
  select * into t from public.tests where id=p_test_id and public.is_my_student(student_id);
  if t.id is null then raise exception 'forbidden'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',i.id,
    'prompt',i.prompt,
    'student_answer',i.student_answer,
    'is_correct',case when t.status='assigned' then null else i.is_correct end,
    'position',i.position,
    'builder_meta',coalesce(i.builder_meta,'{}'::jsonb)
  ) order by i.position),'[]'::jsonb)
  into items from public.test_items i where i.test_id=t.id;
  return jsonb_build_object('id',t.id,'title',t.title,'status',t.status,'score',t.score,'items',items);
end; $$;

revoke all on function public.get_student_homework(uuid) from public;
revoke all on function public.get_student_test(uuid) from public;
grant execute on function public.get_student_homework(uuid) to authenticated;
grant execute on function public.get_student_test(uuid) to authenticated;
