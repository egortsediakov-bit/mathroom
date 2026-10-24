-- Automatically close lessons that were left in progress for three hours.
-- The timeout is based on lessons.started_at, not scheduled_at.
-- Attendance is preserved: an automatic timeout must never guess whether the
-- student was present. CRM trial sync therefore remains attendance-gated.

create schema if not exists private;

create or replace function private.mathroom_auto_complete_stale_lessons()
returns integer
language plpgsql
set search_path = public, private
as $$
declare
  v_count integer := 0;
begin
  -- Stop the live lesson controls first. If the lesson timer is still running,
  -- preserve the elapsed segment only up to the three-hour timeout.
  update public.lesson_live_state ls
  set
    timer_elapsed_seconds = case
      when ls.timer_running and ls.timer_started_at is not null then
        least(
          10800,
          greatest(0, coalesce(ls.timer_elapsed_seconds, 0)) +
          greatest(
            0,
            floor(
              extract(
                epoch from (
                  least(now(), l.started_at + interval '3 hours') - ls.timer_started_at
                )
              )
            )::integer
          )
        )
      else greatest(0, coalesce(ls.timer_elapsed_seconds, 0))
    end,
    timer_running = false,
    timer_started_at = null,
    focus_enabled = false,
    task_timer_running = false,
    task_timer_end_at = null,
    updated_at = now()
  from public.lessons l
  where l.id = ls.lesson_id
    and l.status = 'in_progress'
    and l.started_at is not null
    and l.started_at <= now() - interval '3 hours';

  with completed as (
    update public.lessons l
    set
      status = 'completed',
      completed_at = l.started_at + interval '3 hours',
      actual_duration_minutes = coalesce(
        l.actual_duration_minutes,
        case
          when l.attendance_status = 'absent' then 0
          else greatest(0, l.duration_minutes)
        end
      )
    where l.status = 'in_progress'
      and l.started_at is not null
      and l.started_at <= now() - interval '3 hours'
    returning
      l.id,
      l.teacher_id,
      l.student_id,
      l.started_at,
      l.completed_at,
      l.attendance_status
  ),
  event_rows as (
    insert into public.lesson_events(
      teacher_id,
      lesson_id,
      student_id,
      kind,
      title,
      details,
      created_at
    )
    select
      c.teacher_id,
      c.id,
      c.student_id,
      'lesson_completed',
      'Урок завершён автоматически',
      jsonb_build_object(
        'auto', true,
        'reason', 'three_hour_timeout',
        'timeout_minutes', 180,
        'started_at', c.started_at,
        'completed_at', c.completed_at,
        'attendance_status', c.attendance_status
      ),
      c.completed_at
    from completed c
    returning id
  )
  select count(*) into v_count from completed;

  return v_count;
end;
$$;

select cron.schedule(
  'mathroom-auto-complete-lessons',
  '* * * * *',
  $$select private.mathroom_auto_complete_stale_lessons();$$
);
