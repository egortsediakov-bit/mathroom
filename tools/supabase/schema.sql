-- Mathroom Web v3.0 — Supabase schema
-- Run this entire file once in Supabase Dashboard -> SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.teachers (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'Преподаватель',
  created_at timestamptz not null default now()
);

create table if not exists public.students (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.teachers(id) on delete cascade,
  name text not null,
  grade int not null check (grade between 1 and 11),
  notes text not null default '',
  access_token text not null unique default encode(gen_random_bytes(24),'hex'),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.student_sessions (
  auth_user_id uuid primary key references auth.users(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  claimed_at timestamptz not null default now()
);

create table if not exists public.topics (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.teachers(id) on delete cascade,
  grade int not null check (grade between 1 and 11),
  section text not null default '',
  title text not null,
  theory text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.exercises (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.teachers(id) on delete cascade,
  topic_id uuid not null references public.topics(id) on delete cascade,
  kind text not null default 'task' check (kind in ('task','example')),
  title text not null default '',
  content text not null default '',
  answer text not null default '',
  difficulty text not null default 'basic' check (difficulty in ('basic','medium','advanced')),
  category text not null default '',
  tags text[] not null default '{}',
  generator_spec text not null default '',
  generator_answer text not null default '',
  favorite boolean not null default false,
  use_count int not null default 0,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.lessons (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.teachers(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  topic_id uuid references public.topics(id) on delete set null,
  scheduled_at timestamptz,
  duration_minutes int not null default 60,
  status text not null default 'assigned' check (status in ('assigned','in_progress','completed','cancelled')),
  public_summary text not null default '',
  homework_plan text not null default '',
  private_notes text not null default '',
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.board_pages (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.teachers(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  title text not null default 'Лист',
  sort_order int not null default 0,
  elements jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.lesson_board_versions (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.teachers(id) on delete cascade,
  lesson_id uuid not null references public.lessons(id) on delete cascade,
  title text not null default 'Версия доски',
  note text not null default '',
  pages jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.homeworks (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.teachers(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  topic_id uuid references public.topics(id) on delete set null,
  title text not null default 'Домашняя работа',
  status text not null default 'assigned' check (status in ('assigned','submitted','reviewed')),
  score numeric,
  comment text not null default '',
  created_at timestamptz not null default now(),
  submitted_at timestamptz
);

create table if not exists public.homework_items (
  id uuid primary key default gen_random_uuid(),
  homework_id uuid not null references public.homeworks(id) on delete cascade,
  prompt text not null,
  correct_answer text not null default '',
  student_answer text not null default '',
  is_correct boolean,
  position int not null default 0
);

create table if not exists public.tests (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.teachers(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  topic_id uuid references public.topics(id) on delete set null,
  title text not null default 'Мини-тест',
  status text not null default 'assigned' check (status in ('assigned','submitted')),
  score numeric,
  created_at timestamptz not null default now(),
  submitted_at timestamptz
);

create table if not exists public.test_items (
  id uuid primary key default gen_random_uuid(),
  test_id uuid not null references public.tests(id) on delete cascade,
  prompt text not null,
  correct_answer text not null default '',
  student_answer text not null default '',
  is_correct boolean,
  position int not null default 0
);

create table if not exists public.board_templates (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.teachers(id) on delete cascade,
  title text not null,
  elements jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_students_teacher on public.students(teacher_id);
create index if not exists idx_topics_teacher on public.topics(teacher_id, grade);
create index if not exists idx_exercises_topic on public.exercises(topic_id);
create index if not exists idx_lessons_teacher_time on public.lessons(teacher_id, scheduled_at);
create index if not exists idx_lessons_student on public.lessons(student_id, scheduled_at);
create index if not exists idx_board_pages_student on public.board_pages(student_id, sort_order);

-- Automatically create a first board page for every student.
create or replace function public.mathroom_create_first_board_page()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into public.board_pages(teacher_id, student_id, title, sort_order)
  values(new.teacher_id, new.id, 'Лист 1', 0);
  return new;
end; $$;

drop trigger if exists trg_mathroom_student_board on public.students;
create trigger trg_mathroom_student_board
after insert on public.students
for each row execute function public.mathroom_create_first_board_page();

-- Anonymous student session -> student binding.
create or replace function public.claim_student_access(p_token text)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  s public.students;
begin
  if auth.uid() is null then
    raise exception 'authentication_required';
  end if;
  select * into s from public.students where access_token=p_token and active=true limit 1;
  if s.id is null then
    raise exception 'invalid_link';
  end if;
  insert into public.student_sessions(auth_user_id, student_id)
  values(auth.uid(), s.id)
  on conflict(auth_user_id) do update set student_id=excluded.student_id, claimed_at=now();
  return jsonb_build_object('id',s.id,'name',s.name,'grade',s.grade);
end; $$;

create or replace function public.my_student_id()
returns uuid
language sql
stable
security definer
set search_path=public
as $$
  select student_id from public.student_sessions where auth_user_id=auth.uid() limit 1
$$;

create or replace function public.is_my_student(p_student_id uuid)
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select exists(select 1 from public.student_sessions where auth_user_id=auth.uid() and student_id=p_student_id)
$$;

create or replace function public.rotate_student_access(p_student_id uuid)
returns text
language plpgsql
security definer
set search_path=public
as $$
declare t text;
begin
  if not exists(select 1 from public.students where id=p_student_id and teacher_id=auth.uid()) then
    raise exception 'forbidden';
  end if;
  t := encode(gen_random_bytes(24),'hex');
  update public.students set access_token=t where id=p_student_id;
  delete from public.student_sessions where student_id=p_student_id;
  return t;
end; $$;

-- RLS
alter table public.teachers enable row level security;
alter table public.students enable row level security;
alter table public.student_sessions enable row level security;
alter table public.topics enable row level security;
alter table public.exercises enable row level security;
alter table public.lessons enable row level security;
alter table public.board_pages enable row level security;
alter table public.lesson_board_versions enable row level security;
alter table public.homeworks enable row level security;
alter table public.homework_items enable row level security;
alter table public.tests enable row level security;
alter table public.test_items enable row level security;
alter table public.board_templates enable row level security;

-- Drop policies to make this file rerunnable.
do $$ declare r record; begin
  for r in select schemaname, tablename, policyname from pg_policies where schemaname='public' and tablename in
    ('teachers','students','student_sessions','topics','exercises','lessons','board_pages','lesson_board_versions','homeworks','homework_items','tests','test_items','board_templates')
  loop execute format('drop policy if exists %I on %I.%I',r.policyname,r.schemaname,r.tablename); end loop;
end $$;

create policy teacher_self_select on public.teachers for select using(id=auth.uid());
create policy teacher_self_insert on public.teachers for insert with check(id=auth.uid());
create policy teacher_self_update on public.teachers for update using(id=auth.uid()) with check(id=auth.uid());

create policy students_teacher_all on public.students for all using(teacher_id=auth.uid()) with check(teacher_id=auth.uid());
create policy students_student_select on public.students for select using(public.is_my_student(id));

create policy sessions_self_select on public.student_sessions for select using(auth_user_id=auth.uid());

create policy topics_teacher_all on public.topics for all using(teacher_id=auth.uid()) with check(teacher_id=auth.uid());
create policy exercises_teacher_all on public.exercises for all using(teacher_id=auth.uid()) with check(teacher_id=auth.uid());

create policy lessons_teacher_all on public.lessons for all using(teacher_id=auth.uid()) with check(teacher_id=auth.uid());
create policy lessons_student_select on public.lessons for select using(public.is_my_student(student_id));

create policy board_teacher_all on public.board_pages for all using(teacher_id=auth.uid()) with check(teacher_id=auth.uid());
create policy board_student_select on public.board_pages for select using(public.is_my_student(student_id));
create policy board_student_update on public.board_pages for update using(public.is_my_student(student_id)) with check(public.is_my_student(student_id));

create policy versions_teacher_all on public.lesson_board_versions for all using(teacher_id=auth.uid()) with check(teacher_id=auth.uid());
create policy versions_student_select on public.lesson_board_versions for select using(
  exists(select 1 from public.lessons l where l.id=lesson_id and public.is_my_student(l.student_id))
);

create policy hw_teacher_all on public.homeworks for all using(teacher_id=auth.uid()) with check(teacher_id=auth.uid());
create policy hw_student_select on public.homeworks for select using(public.is_my_student(student_id));
create policy hw_student_update on public.homeworks for update using(public.is_my_student(student_id)) with check(public.is_my_student(student_id));
create policy hw_items_teacher_all on public.homework_items for all using(exists(select 1 from public.homeworks h where h.id=homework_id and h.teacher_id=auth.uid())) with check(exists(select 1 from public.homeworks h where h.id=homework_id and h.teacher_id=auth.uid()));
create policy hw_items_student_select on public.homework_items for select using(exists(select 1 from public.homeworks h where h.id=homework_id and public.is_my_student(h.student_id)));
create policy hw_items_student_update on public.homework_items for update using(exists(select 1 from public.homeworks h where h.id=homework_id and public.is_my_student(h.student_id))) with check(exists(select 1 from public.homeworks h where h.id=homework_id and public.is_my_student(h.student_id)));

create policy tests_teacher_all on public.tests for all using(teacher_id=auth.uid()) with check(teacher_id=auth.uid());
create policy tests_student_select on public.tests for select using(public.is_my_student(student_id));
create policy tests_student_update on public.tests for update using(public.is_my_student(student_id)) with check(public.is_my_student(student_id));
create policy test_items_teacher_all on public.test_items for all using(exists(select 1 from public.tests t where t.id=test_id and t.teacher_id=auth.uid())) with check(exists(select 1 from public.tests t where t.id=test_id and t.teacher_id=auth.uid()));
create policy test_items_student_select on public.test_items for select using(exists(select 1 from public.tests t where t.id=test_id and public.is_my_student(t.student_id)));
create policy test_items_student_update on public.test_items for update using(exists(select 1 from public.tests t where t.id=test_id and public.is_my_student(t.student_id))) with check(exists(select 1 from public.tests t where t.id=test_id and public.is_my_student(t.student_id)));

create policy templates_teacher_all on public.board_templates for all using(teacher_id=auth.uid()) with check(teacher_id=auth.uid());

-- Storage bucket for PDFs/images. Teacher-only in v3.0; student board embeds can be added later.
insert into storage.buckets(id,name,public,file_size_limit)
values('mathroom-materials','mathroom-materials',false,52428800)
on conflict(id) do nothing;

drop policy if exists mathroom_storage_teacher_select on storage.objects;
drop policy if exists mathroom_storage_teacher_insert on storage.objects;
drop policy if exists mathroom_storage_teacher_update on storage.objects;
drop policy if exists mathroom_storage_teacher_delete on storage.objects;
create policy mathroom_storage_teacher_select on storage.objects for select to authenticated using(bucket_id='mathroom-materials' and (storage.foldername(name))[1]=auth.uid()::text);
create policy mathroom_storage_teacher_insert on storage.objects for insert to authenticated with check(bucket_id='mathroom-materials' and (storage.foldername(name))[1]=auth.uid()::text);
create policy mathroom_storage_teacher_update on storage.objects for update to authenticated using(bucket_id='mathroom-materials' and (storage.foldername(name))[1]=auth.uid()::text);
create policy mathroom_storage_teacher_delete on storage.objects for delete to authenticated using(bucket_id='mathroom-materials' and (storage.foldername(name))[1]=auth.uid()::text);


-- Secure Supabase Realtime Broadcast channels used by the whiteboard.
-- In Dashboard -> Realtime Settings, disable "Allow public access" after these policies exist.
drop policy if exists mathroom_realtime_read on realtime.messages;
drop policy if exists mathroom_realtime_write on realtime.messages;

create policy mathroom_realtime_read
on realtime.messages for select to authenticated
using (
  realtime.messages.extension = 'broadcast'
  and (
    (
      (select realtime.topic()) like 'board:%'
      and exists (
        select 1 from public.board_pages p
        where p.id::text = split_part((select realtime.topic()), ':', 2)
          and (p.teacher_id = auth.uid() or public.is_my_student(p.student_id))
      )
    )
    or
    (
      (select realtime.topic()) like 'student:%:pages'
      and exists (
        select 1 from public.students s
        where s.id::text = split_part((select realtime.topic()), ':', 2)
          and (s.teacher_id = auth.uid() or public.is_my_student(s.id))
      )
    )
  )
);

create policy mathroom_realtime_write
on realtime.messages for insert to authenticated
with check (
  realtime.messages.extension = 'broadcast'
  and (
    (
      (select realtime.topic()) like 'board:%'
      and exists (
        select 1 from public.board_pages p
        where p.id::text = split_part((select realtime.topic()), ':', 2)
          and (p.teacher_id = auth.uid() or public.is_my_student(p.student_id))
      )
    )
    or
    (
      (select realtime.topic()) like 'student:%:pages'
      and exists (
        select 1 from public.students s
        where s.id::text = split_part((select realtime.topic()), ':', 2)
          and (s.teacher_id = auth.uid() or public.is_my_student(s.id))
      )
    )
  )
);


-- ===== v3.1 additions =====
-- Mathroom Web v3.1 upgrade
-- Run ONCE in Supabase SQL Editor after the v3.0 schema.

alter table public.homeworks add column if not exists lesson_id uuid references public.lessons(id) on delete set null;
alter table public.homework_items add column if not exists source_exercise_id uuid references public.exercises(id) on delete set null;
alter table public.homework_items add column if not exists source_queue_item_id uuid;
alter table public.homework_items add column if not exists difficulty text not null default 'basic';
alter table public.homework_items add column if not exists category text not null default '';
alter table public.homework_items add column if not exists tags text[] not null default '{}';
alter table public.test_items add column if not exists source_exercise_id uuid references public.exercises(id) on delete set null;
alter table public.test_items add column if not exists difficulty text not null default 'basic';
alter table public.test_items add column if not exists category text not null default '';
alter table public.test_items add column if not exists tags text[] not null default '{}';

create table if not exists public.lesson_queue_items (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.teachers(id) on delete cascade,
  lesson_id uuid not null references public.lessons(id) on delete cascade,
  exercise_id uuid references public.exercises(id) on delete set null,
  title text not null default 'Задача',
  prompt text not null,
  correct_answer text not null default '',
  difficulty text not null default 'basic',
  category text not null default '',
  tags text[] not null default '{}',
  status text not null default 'pending' check (status in ('pending','solved','hard','later')),
  homework_added boolean not null default false,
  position int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.lesson_live_state (
  lesson_id uuid primary key references public.lessons(id) on delete cascade,
  teacher_id uuid not null references public.teachers(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  current_queue_item_id uuid,
  current_title text not null default '',
  current_prompt text not null default '',
  current_position int not null default 0,
  focus_enabled boolean not null default false,
  timer_running boolean not null default false,
  timer_started_at timestamptz,
  timer_elapsed_seconds int not null default 0,
  updated_at timestamptz not null default now()
);

create index if not exists idx_lesson_queue_lesson on public.lesson_queue_items(lesson_id, position);
create index if not exists idx_lesson_live_student on public.lesson_live_state(student_id);
create index if not exists idx_homeworks_lesson on public.homeworks(lesson_id);

alter table public.lesson_queue_items enable row level security;
alter table public.lesson_live_state enable row level security;

drop policy if exists lesson_queue_teacher_all on public.lesson_queue_items;
create policy lesson_queue_teacher_all on public.lesson_queue_items for all
using(teacher_id=auth.uid()) with check(teacher_id=auth.uid());

drop policy if exists lesson_live_teacher_all on public.lesson_live_state;
drop policy if exists lesson_live_student_select on public.lesson_live_state;
create policy lesson_live_teacher_all on public.lesson_live_state for all
using(teacher_id=auth.uid()) with check(teacher_id=auth.uid());
create policy lesson_live_student_select on public.lesson_live_state for select
using(public.is_my_student(student_id));

-- Student answers are submitted only through security-definer RPCs so the
-- browser never receives correct_answer from homework_items/test_items.
drop policy if exists hw_items_student_select on public.homework_items;
drop policy if exists hw_items_student_update on public.homework_items;
drop policy if exists test_items_student_select on public.test_items;
drop policy if exists test_items_student_update on public.test_items;
drop policy if exists hw_student_update on public.homeworks;
drop policy if exists tests_student_update on public.tests;

create or replace function public.mathroom_norm_answer(p text)
returns text language sql immutable as $$
  select lower(regexp_replace(replace(replace(coalesce(p,''), ',', '.'), '−', '-'), '[[:space:]]+', '', 'g'))
$$;

create or replace function public.mathroom_parse_number(p text)
returns numeric language plpgsql immutable as $$
declare s text; parts text[]; a numeric; b numeric;
begin
  s := public.mathroom_norm_answer(p);
  s := regexp_replace(s, '^[[:alpha:]а-яё]+=', '');
  begin return s::numeric; exception when others then null; end;
  if s ~ '^[-+]?[0-9]+([.][0-9]+)?/[-+]?[0-9]+([.][0-9]+)?$' then
    parts := string_to_array(s,'/');
    begin a:=parts[1]::numeric; b:=parts[2]::numeric; if b<>0 then return a/b; end if; exception when others then null; end;
  end if;
  return null;
end; $$;

create or replace function public.mathroom_answer_token(p text)
returns text language plpgsql immutable as $$
declare n numeric; s text;
begin
  s:=public.mathroom_norm_answer(p);
  s:=regexp_replace(s, '^[[:alpha:]а-яё]+=', '');
  n:=public.mathroom_parse_number(s);
  if n is not null then return regexp_replace(regexp_replace(n::text, '([.][0-9]*?)0+$', '\1'), '[.]$', ''); end if;
  return s;
end; $$;

create or replace function public.mathroom_answers_equal(a text,b text)
returns boolean language plpgsql immutable as $$
declare aa text; bb text; na numeric; nb numeric; sa text[]; sb text[];
begin
  aa:=public.mathroom_norm_answer(a); bb:=public.mathroom_norm_answer(b);
  aa:=regexp_replace(aa, '^[[:alpha:]а-яё]+=', ''); bb:=regexp_replace(bb, '^[[:alpha:]а-яё]+=', '');
  if aa=bb then return true; end if;
  na:=public.mathroom_parse_number(aa); nb:=public.mathroom_parse_number(bb);
  if na is not null and nb is not null then return abs(na-nb) < 0.000000001; end if;
  if position(';' in aa)>0 or position(';' in bb)>0 then
    select array_agg(public.mathroom_answer_token(x) order by public.mathroom_answer_token(x)) into sa from unnest(string_to_array(aa,';')) x;
    select array_agg(public.mathroom_answer_token(x) order by public.mathroom_answer_token(x)) into sb from unnest(string_to_array(bb,';')) x;
    return sa=sb;
  end if;
  return false;
end; $$;

create or replace function public.get_student_homework(p_homework_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare h public.homeworks; items jsonb;
begin
  select * into h from public.homeworks where id=p_homework_id and public.is_my_student(student_id);
  if h.id is null then raise exception 'forbidden'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'prompt',i.prompt,'student_answer',i.student_answer,'is_correct',case when h.status='assigned' then null else i.is_correct end,'position',i.position) order by i.position),'[]'::jsonb)
  into items from public.homework_items i where i.homework_id=h.id;
  return jsonb_build_object('id',h.id,'title',h.title,'status',h.status,'score',h.score,'comment',h.comment,'items',items);
end; $$;

create or replace function public.get_student_test(p_test_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare t public.tests; items jsonb;
begin
  select * into t from public.tests where id=p_test_id and public.is_my_student(student_id);
  if t.id is null then raise exception 'forbidden'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'prompt',i.prompt,'student_answer',i.student_answer,'is_correct',case when t.status='assigned' then null else i.is_correct end,'position',i.position) order by i.position),'[]'::jsonb)
  into items from public.test_items i where i.test_id=t.id;
  return jsonb_build_object('id',t.id,'title',t.title,'status',t.status,'score',t.score,'items',items);
end; $$;

create or replace function public.submit_homework(p_homework_id uuid,p_answers jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare h public.homeworks; r record; ans text; ok boolean; total int:=0; good int:=0; score_value numeric;
begin
  select * into h from public.homeworks where id=p_homework_id and public.is_my_student(student_id) for update;
  if h.id is null then raise exception 'forbidden'; end if;
  if h.status<>'assigned' then raise exception 'already_submitted'; end if;
  for r in select * from public.homework_items where homework_id=h.id order by position loop
    ans:=coalesce(p_answers->>r.id::text,''); ok:=public.mathroom_answers_equal(r.correct_answer,ans);
    update public.homework_items set student_answer=ans,is_correct=ok where id=r.id;
    total:=total+1; if ok then good:=good+1; end if;
  end loop;
  score_value:=case when total=0 then 0 else round(good*100.0/total,1) end;
  update public.homeworks set status='submitted',score=score_value,submitted_at=now() where id=h.id;
  return jsonb_build_object('ok',true,'correct',good,'total',total,'score',score_value);
end; $$;

create or replace function public.submit_test(p_test_id uuid,p_answers jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare t public.tests; r record; ans text; ok boolean; total int:=0; good int:=0; score_value numeric;
begin
  select * into t from public.tests where id=p_test_id and public.is_my_student(student_id) for update;
  if t.id is null then raise exception 'forbidden'; end if;
  if t.status<>'assigned' then raise exception 'already_submitted'; end if;
  for r in select * from public.test_items where test_id=t.id order by position loop
    ans:=coalesce(p_answers->>r.id::text,''); ok:=public.mathroom_answers_equal(r.correct_answer,ans);
    update public.test_items set student_answer=ans,is_correct=ok where id=r.id;
    total:=total+1; if ok then good:=good+1; end if;
  end loop;
  score_value:=case when total=0 then 0 else round(good*100.0/total,1) end;
  update public.tests set status='submitted',score=score_value,submitted_at=now() where id=t.id;
  return jsonb_build_object('ok',true,'correct',good,'total',total,'score',score_value);
end; $$;

grant execute on function public.get_student_homework(uuid) to authenticated;
grant execute on function public.get_student_test(uuid) to authenticated;
grant execute on function public.submit_homework(uuid,jsonb) to authenticated;
grant execute on function public.submit_test(uuid,jsonb) to authenticated;

-- Realtime current-task/timer updates for the student view.
do $$ begin
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='lesson_live_state') then
    alter publication supabase_realtime add table public.lesson_live_state;
  end if;
end $$;
