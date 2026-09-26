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
