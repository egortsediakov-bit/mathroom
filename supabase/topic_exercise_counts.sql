-- Count all exercise rows in a teacher's topics without downloading task bodies.
-- Uses the caller's privileges and respects RLS. Result is one JSON object,
-- avoiding the PostgREST max_rows limit on array-of-row responses.
create or replace function public.mathroom_topic_exercise_counts()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(
    jsonb_object_agg(rows.topic_id, jsonb_build_object('tasks', rows.tasks, 'examples', rows.examples)),
    '{}'::jsonb
  )
  from (
    select e.topic_id,
      count(*) filter (where e.kind = 'task') as tasks,
      count(*) filter (where e.kind = 'example') as examples
    from public.exercises e
    join public.topics t on t.id = e.topic_id
    where e.teacher_id = (select auth.uid()) and t.teacher_id = (select auth.uid())
    group by e.topic_id
  ) rows;
$$;
revoke all on function public.mathroom_topic_exercise_counts() from public;
grant execute on function public.mathroom_topic_exercise_counts() to authenticated;
