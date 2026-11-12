-- Mathroom v71 — progressive hints, post-attempt solutions, and student-safe task metadata.
-- Production SQL applied on 2026-11-12.

create table if not exists public.assignment_help_progress (
  student_id uuid not null references public.students(id) on delete cascade,
  assignment_kind text not null check (assignment_kind in ('homework','test')),
  assignment_id uuid not null,
  item_id uuid not null,
  highest_hint integer not null default -1 check (highest_hint between -1 and 2),
  updated_at timestamptz not null default now(),
  primary key(student_id, assignment_kind, assignment_id, item_id)
);

alter table public.assignment_help_progress enable row level security;
revoke all on table public.assignment_help_progress from anon, authenticated;

create or replace function public.mathroom_student_task_meta(p_meta jsonb)
returns jsonb
language plpgsql
immutable
set search_path=public
as $$
declare
  m jsonb:=coalesce(p_meta,'{}'::jsonb);
  safe_answers jsonb;
  safe_options jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
    'label',coalesce(x->>'label','Ответ')
  ) order by ord),'[]'::jsonb)
  into safe_answers
  from jsonb_array_elements(coalesce(m->'answers','[]'::jsonb)) with ordinality a(x,ord);

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',coalesce(x->>'id','o'||ord::text),
    'text',coalesce(x->>'text','')
  ) order by ord),'[]'::jsonb)
  into safe_options
  from jsonb_array_elements(coalesce(m->'options','[]'::jsonb)) with ordinality a(x,ord);

  m:=m - 'solution' - 'hints' - 'open_answer' - 'answer_check';
  m:=jsonb_set(m,'{answers}',safe_answers,true);
  m:=jsonb_set(m,'{options}',safe_options,true);
  return m;
end; $$;

create or replace function public.mathroom_student_help_state(
  p_student_id uuid,
  p_kind text,
  p_assignment_id uuid,
  p_item_id uuid,
  p_meta jsonb,
  p_attempted boolean
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  meta jsonb:=coalesce(p_meta,'{}'::jsonb);
  cfg jsonb:=coalesce(meta->'help_settings','{}'::jsonb);
  hints jsonb:=coalesce(meta->'hints','[]'::jsonb);
  solution text:=coalesce(meta->>'solution','');
  enabled boolean;
  highest integer:=-1;
  revealed jsonb:='[]'::jsonb;
  total integer:=0;
  i integer;
  hint text;
  solution_mode text:=coalesce(nullif(cfg->>'solution_mode',''),'after_attempt');
  show_solution boolean:=false;
begin
  enabled:=case
    when p_kind='test' then coalesce((cfg->>'test_hints')::boolean,false)
    else coalesce((cfg->>'homework_hints')::boolean,true)
  end;

  select coalesce(hp.highest_hint,-1)
  into highest
  from public.assignment_help_progress hp
  where hp.student_id=p_student_id
    and hp.assignment_kind=p_kind
    and hp.assignment_id=p_assignment_id
    and hp.item_id=p_item_id;

  if highest is null then highest:=-1; end if;

  if jsonb_typeof(hints)='array' then
    for i in 0..greatest(jsonb_array_length(hints)-1,-1) loop
      hint:=coalesce(hints->>i,'');
      if btrim(hint)<>'' then
        total:=total+1;
        if enabled and i<=highest then
          revealed:=revealed||jsonb_build_array(jsonb_build_object('index',i,'text',hint));
        end if;
      end if;
    end loop;
  end if;

  show_solution:=p_attempted
    and solution_mode='after_attempt'
    and btrim(solution)<>'';

  return jsonb_build_object(
    'hints_enabled',enabled and total>0,
    'hint_count',total,
    'revealed_hints',revealed,
    'has_more_hints',enabled and (
      select exists(
        select 1
        from jsonb_array_elements_text(hints) with ordinality h(value,ord)
        where btrim(value)<>''
          and (ord-1)>highest
      )
    ),
    'has_solution',btrim(solution)<>'',
    'solution_mode',solution_mode,
    'solution_available',show_solution,
    'solution',case when show_solution then solution else null end
  );
end; $$;

create or replace function public.reveal_student_task_hint(
  p_kind text,
  p_assignment_id uuid,
  p_item_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  sid uuid;
  meta jsonb;
  cfg jsonb;
  hints jsonb;
  enabled boolean;
  highest integer:=-1;
  next_index integer:=-1;
  next_hint text:='';
  i integer;
  more_after boolean:=false;
begin
  if p_kind not in ('homework','test') then raise exception 'invalid_kind'; end if;

  if p_kind='homework' then
    select h.student_id,coalesce(i.builder_meta,'{}'::jsonb)
    into sid,meta
    from public.homeworks h
    join public.homework_items i on i.homework_id=h.id
    where h.id=p_assignment_id
      and i.id=p_item_id
      and public.is_my_student(h.student_id);
  else
    select t.student_id,coalesce(i.builder_meta,'{}'::jsonb)
    into sid,meta
    from public.tests t
    join public.test_items i on i.test_id=t.id
    where t.id=p_assignment_id
      and i.id=p_item_id
      and public.is_my_student(t.student_id);
  end if;

  if sid is null then raise exception 'forbidden'; end if;

  cfg:=coalesce(meta->'help_settings','{}'::jsonb);
  enabled:=case
    when p_kind='test' then coalesce((cfg->>'test_hints')::boolean,false)
    else coalesce((cfg->>'homework_hints')::boolean,true)
  end;
  if not enabled then raise exception 'hints_disabled'; end if;

  hints:=coalesce(meta->'hints','[]'::jsonb);
  if jsonb_typeof(hints)<>'array' then return jsonb_build_object('done',true); end if;

  select coalesce(hp.highest_hint,-1)
  into highest
  from public.assignment_help_progress hp
  where hp.student_id=sid
    and hp.assignment_kind=p_kind
    and hp.assignment_id=p_assignment_id
    and hp.item_id=p_item_id;

  if highest is null then highest:=-1; end if;

  for i in greatest(highest+1,0)..greatest(jsonb_array_length(hints)-1,-1) loop
    if btrim(coalesce(hints->>i,''))<>'' then
      next_index:=i;
      next_hint:=hints->>i;
      exit;
    end if;
  end loop;

  if next_index<0 then
    return jsonb_build_object('done',true,'has_more',false);
  end if;

  insert into public.assignment_help_progress(
    student_id,assignment_kind,assignment_id,item_id,highest_hint,updated_at
  ) values(
    sid,p_kind,p_assignment_id,p_item_id,next_index,now()
  )
  on conflict(student_id,assignment_kind,assignment_id,item_id)
  do update set highest_hint=greatest(public.assignment_help_progress.highest_hint,excluded.highest_hint),
                updated_at=now();

  if next_index<jsonb_array_length(hints)-1 then
    for i in next_index+1..jsonb_array_length(hints)-1 loop
      if btrim(coalesce(hints->>i,''))<>'' then more_after:=true; exit; end if;
    end loop;
  end if;

  return jsonb_build_object(
    'done',false,
    'index',next_index,
    'hint',next_hint,
    'has_more',more_after
  );
end; $$;

create or replace function public.get_student_homework(p_homework_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare h public.homeworks; items jsonb;
begin
  select * into h
  from public.homeworks
  where id=p_homework_id and public.is_my_student(student_id);
  if h.id is null then raise exception 'forbidden'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',i.id,
    'prompt',i.prompt,
    'student_answer',i.student_answer,
    'is_correct',case when h.status='assigned' then null else i.is_correct end,
    'position',i.position,
    'builder_meta',public.mathroom_student_task_meta(coalesce(i.builder_meta,'{}'::jsonb)),
    'help',public.mathroom_student_help_state(
      h.student_id,'homework',h.id,i.id,coalesce(i.builder_meta,'{}'::jsonb),h.attempt_count>0
    ),
    'teacher_feedback',i.teacher_feedback
  ) order by i.position),'[]'::jsonb)
  into items
  from public.homework_items i
  where i.homework_id=h.id;

  return jsonb_build_object(
    'id',h.id,'title',h.title,'status',h.status,'score',h.score,'comment',h.comment,
    'due_at',h.due_at,'attempt_count',h.attempt_count,'reviewed_at',h.reviewed_at,
    'revision_requested_at',h.revision_requested_at,'revision_message',h.revision_message,
    'items',items
  );
end; $$;

create or replace function public.get_student_test(p_test_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare t public.tests; items jsonb;
begin
  select * into t
  from public.tests
  where id=p_test_id and public.is_my_student(student_id);
  if t.id is null then raise exception 'forbidden'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',i.id,
    'prompt',i.prompt,
    'student_answer',i.student_answer,
    'is_correct',case when t.status='assigned' then null else i.is_correct end,
    'position',i.position,
    'builder_meta',public.mathroom_student_task_meta(coalesce(i.builder_meta,'{}'::jsonb)),
    'help',public.mathroom_student_help_state(
      t.student_id,'test',t.id,i.id,coalesce(i.builder_meta,'{}'::jsonb),t.status<>'assigned'
    )
  ) order by i.position),'[]'::jsonb)
  into items
  from public.test_items i
  where i.test_id=t.id;

  return jsonb_build_object('id',t.id,'title',t.title,'status',t.status,'score',t.score,'items',items);
end; $$;

revoke execute on function public.mathroom_student_task_meta(jsonb) from public,anon,authenticated;
revoke execute on function public.mathroom_student_help_state(uuid,text,uuid,uuid,jsonb,boolean) from public,anon,authenticated;
revoke execute on function public.reveal_student_task_hint(text,uuid,uuid) from public,anon;
grant execute on function public.reveal_student_task_hint(text,uuid,uuid) to authenticated;
revoke execute on function public.get_student_homework(uuid) from public,anon;
revoke execute on function public.get_student_test(uuid) from public,anon;
grant execute on function public.get_student_homework(uuid) to authenticated;
grant execute on function public.get_student_test(uuid) to authenticated;
