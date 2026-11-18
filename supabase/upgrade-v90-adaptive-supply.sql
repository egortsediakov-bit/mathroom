-- Mathroom v90.0 — opt-in, bounded background supply and private authentication
alter table public.task_supply_settings
  add column if not exists auto_enabled boolean not null default false,
  add column if not exists daily_ai_limit smallint not null default 10,
  add column if not exists auto_focus_grades smallint[] not null default '{}'::smallint[],
  add column if not exists last_auto_run_at timestamptz,
  add column if not exists last_auto_error text;
alter table public.task_supply_settings drop constraint if exists task_supply_settings_daily_ai_limit_check;
alter table public.task_supply_settings add constraint task_supply_settings_daily_ai_limit_check
  check (daily_ai_limit between 1 and 100);
create index if not exists idx_mr_supply_jobs_teacher_date
  on public.task_generation_jobs(teacher_id,created_at desc);
create index if not exists idx_mr_supply_exercises_topic_diff
  on public.exercises(teacher_id,topic_id,difficulty)
  where kind='task' and is_draft=false;
create index if not exists idx_mr_supply_candidates_topic_diff
  on public.task_candidates(teacher_id,topic_id,difficulty,status);
do $$
begin
  if not exists (select 1 from vault.secrets where name='mathroom_task_supply_cron_secret') then
    perform vault.create_secret(encode(gen_random_bytes(32),'hex'), 'mathroom_task_supply_cron_secret');
  end if;
end $$;
create or replace function public.task_supply_cron_auth(p_token text)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select length(coalesce(p_token,'')) >= 64
     and exists (
       select 1 from vault.decrypted_secrets s
       where s.name='mathroom_task_supply_cron_secret'
         and s.decrypted_secret=p_token
     );
$$;
revoke all on function public.task_supply_cron_auth(text) from public,anon,authenticated;
grant execute on function public.task_supply_cron_auth(text) to service_role;

-- Service-only selector: counts published and pending candidates separately.
-- Pending candidates count toward coverage to prevent repeated generation into quarantine.
create or replace function public.task_supply_next_gap(p_teacher uuid,p_grades integer[])
returns table(topic_id uuid,difficulty text,shortage integer)
language sql stable security invoker
set search_path = ''
as $$
  select t.id,targets.difficulty,
    greatest(0,targets.target_count -
      (select count(*)::integer
       from public.exercises e
       where e.teacher_id=p_teacher and e.topic_id=t.id
         and e.kind='task' and e.is_draft=false
         and e.difficulty=targets.difficulty and length(trim(e.answer))>0) -
      (select count(*)::integer
       from public.task_candidates c
       where c.teacher_id=p_teacher and c.topic_id=t.id
         and c.difficulty=targets.difficulty and c.status in ('ready','review'))
    ) as shortage
  from public.task_supply_settings s
  join public.topics t on t.teacher_id=s.teacher_id
  cross join lateral (values
    ('medium'::text,s.target_medium::integer),
    ('basic'::text,s.target_basic::integer),
    ('advanced'::text,s.target_advanced::integer)
  ) targets(difficulty,target_count)
  where s.teacher_id=p_teacher
    and t.grade=any(p_grades)
    and targets.target_count>0
    and (select count(*) from public.exercises e
         where e.teacher_id=p_teacher and e.topic_id=t.id
           and e.kind='task' and e.is_draft=false
           and e.difficulty=targets.difficulty and length(trim(e.answer))>0)
        +
        (select count(*) from public.task_candidates c
         where c.teacher_id=p_teacher and c.topic_id=t.id
           and c.difficulty=targets.difficulty and c.status in ('ready','review'))
        < targets.target_count
  order by
    (targets.target_count -
      (select count(*)::integer from public.exercises e where e.teacher_id=p_teacher and e.topic_id=t.id
       and e.kind='task' and e.is_draft=false and e.difficulty=targets.difficulty and length(trim(e.answer))>0)
      -
      (select count(*)::integer from public.task_candidates c where c.teacher_id=p_teacher and c.topic_id=t.id
       and c.difficulty=targets.difficulty and c.status in ('ready','review'))
    )::numeric/nullif(targets.target_count,0) desc,
    t.grade, t.title, targets.difficulty
  limit 1;
$$;
revoke all on function public.task_supply_next_gap(uuid,integer[]) from public,anon,authenticated;
grant execute on function public.task_supply_next_gap(uuid,integer[]) to service_role;
