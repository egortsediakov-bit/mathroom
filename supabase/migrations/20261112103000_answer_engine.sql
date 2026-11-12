-- Mathroom v70 — typed answer engine and configurable autograding.
-- Production SQL applied on 2026-11-12.

create or replace function public.mathroom_norm_answer_rules(
  p text,
  p_ignore_case boolean default true,
  p_ignore_spaces boolean default true
)
returns text
language plpgsql
immutable
set search_path=public
as $$
declare s text;
begin
  s:=replace(replace(coalesce(p,''), ',', '.'), '−', '-');
  if p_ignore_spaces then
    s:=regexp_replace(s, '[[:space:]]+', '', 'g');
  else
    s:=btrim(regexp_replace(s, '[[:space:]]+', ' ', 'g'));
  end if;
  if p_ignore_case then s:=lower(s); end if;
  return s;
end; $$;

create or replace function public.mathroom_answer_scalar_equal(
  p_expected text,
  p_actual text,
  p_meta jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
immutable
set search_path=public
as $$
declare
  cfg jsonb:=coalesce(p_meta->'answer_check','{}'::jsonb);
  numeric_equiv boolean:=coalesce((cfg->>'numeric_equivalence')::boolean,true);
  ignore_case boolean:=coalesce((cfg->>'ignore_case')::boolean,true);
  ignore_spaces boolean:=coalesce((cfg->>'ignore_spaces')::boolean,true);
  tolerance numeric:=greatest(0,coalesce(nullif(cfg->>'tolerance','')::numeric,0.000000001));
  a text;
  b text;
  na numeric;
  nb numeric;
begin
  a:=public.mathroom_norm_answer_rules(p_expected,ignore_case,ignore_spaces);
  b:=public.mathroom_norm_answer_rules(p_actual,ignore_case,ignore_spaces);
  a:=regexp_replace(a, '^[[:alpha:]а-яё]+[[:space:]]*=', '');
  b:=regexp_replace(b, '^[[:alpha:]а-яё]+[[:space:]]*=', '');
  if a=b then return true; end if;
  if numeric_equiv then
    na:=public.mathroom_parse_number(a);
    nb:=public.mathroom_parse_number(b);
    if na is not null and nb is not null then return abs(na-nb)<=tolerance; end if;
  end if;
  return false;
end; $$;

create or replace function public.mathroom_grade_answer(
  p_correct text,
  p_payload jsonb,
  p_meta jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
immutable
set search_path=public
as $$
declare
  task_type text:=coalesce(nullif(p_meta->>'task_type',''),'standard');
  expected_answers jsonb:=coalesce(p_meta->'answers','[]'::jsonb);
  options jsonb:=coalesce(p_meta->'options','[]'::jsonb);
  actual_text text;
  expected_text text;
  accepted jsonb;
  match_one boolean;
  expected_count int;
  actual_count int;
  i int;
  selected_ids text[];
  correct_ids text[];
  legacy_parts text[];
begin
  if task_type='open' then return null; end if;

  if task_type in ('single','multiple') and jsonb_typeof(options)='array' then
    select coalesce(array_agg(x->>'id' order by x->>'id'),'{}'::text[])
      into correct_ids
      from jsonb_array_elements(options) x
      where coalesce((x->>'correct')::boolean,false);

    if p_payload is null then
      selected_ids:='{}'::text[];
    elsif jsonb_typeof(p_payload)='array' then
      select coalesce(array_agg(value order by value),'{}'::text[])
        into selected_ids
        from jsonb_array_elements_text(p_payload);
    else
      actual_text:=coalesce(p_payload#>>'{}','');
      select coalesce(array_agg(x->>'id' order by x->>'id'),'{}'::text[])
        into selected_ids
        from jsonb_array_elements(options) x
        where public.mathroom_answer_scalar_equal(x->>'text',actual_text,p_meta);
    end if;
    return selected_ids=correct_ids;
  end if;

  if jsonb_typeof(expected_answers)='array' and jsonb_array_length(expected_answers)>0 then
    expected_count:=jsonb_array_length(expected_answers);
    if p_payload is not null and jsonb_typeof(p_payload)='array' then
      actual_count:=jsonb_array_length(p_payload);
      if actual_count<>expected_count then return false; end if;
    else
      actual_text:=coalesce(p_payload#>>'{}','');
      if expected_count>1 then
        legacy_parts:=string_to_array(actual_text,';');
        if coalesce(array_length(legacy_parts,1),0)<>expected_count then return false; end if;
      end if;
    end if;

    for i in 0..expected_count-1 loop
      expected_text:=coalesce(expected_answers->i->>'value','');
      if p_payload is not null and jsonb_typeof(p_payload)='array' then
        actual_text:=coalesce(p_payload->>i,'');
      elsif expected_count=1 then
        actual_text:=coalesce(p_payload#>>'{}','');
      else
        actual_text:=coalesce(legacy_parts[i+1],'');
      end if;

      match_one:=public.mathroom_answer_scalar_equal(expected_text,actual_text,p_meta);
      if not match_one then
        accepted:=coalesce(expected_answers->i->'accepted','[]'::jsonb);
        if jsonb_typeof(accepted)='array' then
          select exists(
            select 1
            from jsonb_array_elements_text(accepted) a
            where public.mathroom_answer_scalar_equal(a,actual_text,p_meta)
          ) into match_one;
        end if;
      end if;
      if not coalesce(match_one,false) then return false; end if;
    end loop;
    return true;
  end if;

  return public.mathroom_answer_scalar_equal(
    p_correct,
    coalesce(p_payload#>>'{}',''),
    p_meta
  );
end; $$;

create or replace function public.mathroom_answer_display(
  p_payload jsonb,
  p_meta jsonb default '{}'::jsonb
)
returns text
language plpgsql
immutable
set search_path=public
as $$
declare
  task_type text:=coalesce(nullif(p_meta->>'task_type',''),'standard');
  options jsonb:=coalesce(p_meta->'options','[]'::jsonb);
  result text;
begin
  if p_payload is null then return ''; end if;

  if jsonb_typeof(p_payload)='array' then
    if task_type in ('single','multiple') and jsonb_typeof(options)='array' then
      select string_agg(coalesce(o->>'text',v.value), '; ' order by v.ord)
        into result
        from jsonb_array_elements_text(p_payload) with ordinality v(value,ord)
        left join lateral (
          select x
          from jsonb_array_elements(options) x
          where x->>'id'=v.value
          limit 1
        ) q on true
        left join lateral (select q.x as o) z on true;
      if result is not null then return result; end if;
    end if;
    select string_agg(value,'; ' order by ord)
      into result
      from jsonb_array_elements_text(p_payload) with ordinality v(value,ord);
    return coalesce(result,'');
  end if;

  return coalesce(p_payload#>>'{}','');
end; $$;

create or replace function public.submit_homework(p_homework_id uuid, p_answers jsonb)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  h public.homeworks;
  r record;
  payload jsonb;
  ans text;
  ok boolean;
  total int:=0;
  graded int:=0;
  good int:=0;
  score_value numeric;
  attempt_no_value int;
  snapshot jsonb;
  needs_review boolean:=false;
begin
  select * into h from public.homeworks
  where id=p_homework_id and public.is_my_student(student_id)
  for update;
  if h.id is null then raise exception 'forbidden'; end if;
  if h.status<>'assigned' then raise exception 'already_submitted'; end if;

  for r in select * from public.homework_items where homework_id=h.id order by position loop
    payload:=p_answers -> r.id::text;
    ans:=public.mathroom_answer_display(payload,coalesce(r.builder_meta,'{}'::jsonb));
    ok:=public.mathroom_grade_answer(r.correct_answer,payload,coalesce(r.builder_meta,'{}'::jsonb));
    update public.homework_items set student_answer=ans,is_correct=ok where id=r.id;
    total:=total+1;
    if ok is null then
      needs_review:=true;
    else
      graded:=graded+1;
      if ok then good:=good+1; end if;
    end if;
  end loop;

  score_value:=case when graded=0 then null else round(good*100.0/graded,1) end;

  update public.homeworks
  set status='submitted',score=score_value,submitted_at=now(),last_attempt_at=now(),
      attempt_count=attempt_count+1,revision_requested_at=null,revision_message='',reviewed_at=null
  where id=h.id
  returning attempt_count into attempt_no_value;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',i.id,'prompt',i.prompt,'student_answer',i.student_answer,'correct_answer',i.correct_answer,
    'is_correct',i.is_correct,'teacher_feedback',i.teacher_feedback,'position',i.position,
    'category',i.category,'tags',i.tags,'difficulty',i.difficulty,
    'builder_meta',coalesce(i.builder_meta,'{}'::jsonb)
  ) order by i.position),'[]'::jsonb)
  into snapshot
  from public.homework_items i where i.homework_id=h.id;

  insert into public.homework_attempts(
    teacher_id,homework_id,student_id,attempt_no,auto_score,answers,submitted_at
  ) values(
    h.teacher_id,h.id,h.student_id,attempt_no_value,coalesce(score_value,0),snapshot,now()
  )
  on conflict(homework_id,attempt_no) do update
  set auto_score=excluded.auto_score,answers=excluded.answers,submitted_at=excluded.submitted_at;

  return jsonb_build_object(
    'ok',true,'correct',good,'graded',graded,'total',total,'score',score_value,
    'needs_review',needs_review,'attempt',attempt_no_value
  );
end; $$;

create or replace function public.submit_test(p_test_id uuid, p_answers jsonb)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  t public.tests;
  r record;
  payload jsonb;
  ans text;
  ok boolean;
  total int:=0;
  graded int:=0;
  good int:=0;
  score_value numeric;
  needs_review boolean:=false;
begin
  select * into t from public.tests
  where id=p_test_id and public.is_my_student(student_id)
  for update;
  if t.id is null then raise exception 'forbidden'; end if;
  if t.status<>'assigned' then raise exception 'already_submitted'; end if;

  for r in select * from public.test_items where test_id=t.id order by position loop
    payload:=p_answers -> r.id::text;
    ans:=public.mathroom_answer_display(payload,coalesce(r.builder_meta,'{}'::jsonb));
    ok:=public.mathroom_grade_answer(r.correct_answer,payload,coalesce(r.builder_meta,'{}'::jsonb));
    update public.test_items set student_answer=ans,is_correct=ok where id=r.id;
    total:=total+1;
    if ok is null then
      needs_review:=true;
    else
      graded:=graded+1;
      if ok then good:=good+1; end if;
    end if;
  end loop;

  score_value:=case when graded=0 then null else round(good*100.0/graded,1) end;
  update public.tests set status='submitted',score=score_value,submitted_at=now() where id=t.id;

  return jsonb_build_object(
    'ok',true,'correct',good,'graded',graded,'total',total,'score',score_value,'needs_review',needs_review
  );
end; $$;

revoke execute on function public.mathroom_norm_answer_rules(text,boolean,boolean) from public, anon, authenticated;
revoke execute on function public.mathroom_answer_scalar_equal(text,text,jsonb) from public, anon, authenticated;
revoke execute on function public.mathroom_grade_answer(text,jsonb,jsonb) from public, anon, authenticated;
revoke execute on function public.mathroom_answer_display(jsonb,jsonb) from public, anon, authenticated;
revoke execute on function public.submit_homework(uuid,jsonb) from public, anon;
revoke execute on function public.submit_test(uuid,jsonb) from public, anon;
grant execute on function public.submit_homework(uuid,jsonb) to authenticated;
grant execute on function public.submit_test(uuid,jsonb) to authenticated;
