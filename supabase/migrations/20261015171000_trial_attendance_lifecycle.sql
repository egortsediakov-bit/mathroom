-- CRM trial lifecycle: attendance-gated completion and 30-minute no-start timeout.
-- Production migration applied on 2026-10-15.

alter table public.crm_trial_sync_state
  add column if not exists reason text,
  add column if not exists attendance_status text,
  add column if not exists started_at timestamptz;

create or replace function public.mathroom_capture_crm_trial_state()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_event_key text;
  v_lead_id text;
  v_state text;
  v_reason text;
begin
  if tg_op = 'DELETE' then
    v_event_key := old.crm_event_key;

    if v_event_key is null or v_event_key not like 'crm-trial:%' then
      return old;
    end if;

    v_lead_id := substring(v_event_key from length('crm-trial:') + 1);

    -- Removing an attended, completed lesson from history must not undo CRM.
    if old.status = 'completed' and old.attendance_status in ('present','late') then
      return old;
    end if;

    insert into public.crm_trial_sync_state(
      lead_id, lesson_id, state, reason, scheduled_at, started_at,
      completed_at, attendance_status, changed_at
    )
    values (
      v_lead_id, old.id, 'deleted', 'lesson_deleted', null, old.started_at,
      null, old.attendance_status, now()
    )
    on conflict (lead_id) do update set
      lesson_id = excluded.lesson_id,
      state = 'deleted',
      reason = 'lesson_deleted',
      scheduled_at = null,
      started_at = excluded.started_at,
      completed_at = null,
      attendance_status = excluded.attendance_status,
      changed_at = now();

    return old;
  end if;

  v_event_key := new.crm_event_key;
  if v_event_key is null or v_event_key not like 'crm-trial:%' then
    return new;
  end if;

  v_lead_id := substring(v_event_key from length('crm-trial:') + 1);

  if new.attendance_status = 'absent' then
    v_state := 'deleted';
    if new.started_at is null
       and new.status = 'assigned'
       and coalesce(new.attendance_note, '') like 'Пробный не начат в течение 30 минут%' then
      v_reason := 'not_started_30m';
    else
      v_reason := 'absent';
    end if;
  elsif new.status = 'completed' and new.attendance_status in ('present','late') then
    v_state := 'completed';
    v_reason := case when new.attendance_status = 'late' then 'late' else 'present' end;
  elsif new.status = 'cancelled' then
    v_state := 'deleted';
    v_reason := 'cancelled';
  else
    v_state := 'scheduled';
    v_reason := case
      when new.status = 'completed' then 'awaiting_attendance'
      when new.status = 'in_progress' then 'in_progress'
      else 'scheduled'
    end;
  end if;

  insert into public.crm_trial_sync_state(
    lead_id, lesson_id, state, reason, scheduled_at, started_at,
    completed_at, attendance_status, changed_at
  )
  values (
    v_lead_id,
    new.id,
    v_state,
    v_reason,
    case when v_state = 'deleted' then null else new.scheduled_at end,
    new.started_at,
    case when v_state = 'completed' then coalesce(new.completed_at, now()) else null end,
    new.attendance_status,
    now()
  )
  on conflict (lead_id) do update set
    lesson_id = excluded.lesson_id,
    state = excluded.state,
    reason = excluded.reason,
    scheduled_at = excluded.scheduled_at,
    started_at = excluded.started_at,
    completed_at = excluded.completed_at,
    attendance_status = excluded.attendance_status,
    changed_at = now();

  return new;
end;
$$;

create or replace function public.mathroom_mark_missed_crm_trials()
returns integer
language plpgsql
set search_path = public
as $$
declare
  v_count integer := 0;
begin
  with marked as (
    update public.lessons
    set
      attendance_status = 'absent',
      attendance_note = case
        when btrim(coalesce(attendance_note, '')) = ''
          then 'Пробный не начат в течение 30 минут после назначенного времени'
        else attendance_note
      end,
      attendance_marked_at = coalesce(attendance_marked_at, now()),
      actual_duration_minutes = 0
    where lesson_type = 'trial'
      and crm_event_key like 'crm-trial:%'
      and status = 'assigned'
      and started_at is null
      and scheduled_at is not null
      and scheduled_at <= now() - interval '30 minutes'
      and attendance_status = 'unmarked'
    returning id, teacher_id, student_id, scheduled_at
  ),
  event_rows as (
    insert into public.lesson_events(
      teacher_id, lesson_id, student_id, kind, title, details
    )
    select
      teacher_id,
      id,
      student_id,
      'attendance',
      'Пробный не состоялся',
      jsonb_build_object(
        'status', 'absent',
        'reason', 'not_started_30m',
        'scheduled_at', scheduled_at,
        'auto', true
      )
    from marked
    returning id
  )
  select count(*) into v_count from marked;

  return v_count;
end;
$$;

insert into public.crm_trial_sync_state(
  lead_id, lesson_id, state, reason, scheduled_at, started_at,
  completed_at, attendance_status, changed_at
)
select
  substring(l.crm_event_key from length('crm-trial:') + 1),
  l.id,
  case
    when l.attendance_status = 'absent' then 'deleted'
    when l.status = 'completed' and l.attendance_status in ('present','late') then 'completed'
    when l.status = 'cancelled' then 'deleted'
    else 'scheduled'
  end,
  case
    when l.attendance_status = 'absent'
      and l.started_at is null
      and l.status = 'assigned'
      and coalesce(l.attendance_note, '') like 'Пробный не начат в течение 30 минут%'
      then 'not_started_30m'
    when l.attendance_status = 'absent' then 'absent'
    when l.status = 'completed' and l.attendance_status = 'late' then 'late'
    when l.status = 'completed' and l.attendance_status = 'present' then 'present'
    when l.status = 'cancelled' then 'cancelled'
    when l.status = 'completed' then 'awaiting_attendance'
    when l.status = 'in_progress' then 'in_progress'
    else 'scheduled'
  end,
  case
    when l.attendance_status = 'absent' or l.status = 'cancelled' then null
    else l.scheduled_at
  end,
  l.started_at,
  case
    when l.status = 'completed' and l.attendance_status in ('present','late')
      then l.completed_at
    else null
  end,
  l.attendance_status,
  now()
from public.lessons l
where l.crm_event_key like 'crm-trial:%'
on conflict (lead_id) do update set
  lesson_id = excluded.lesson_id,
  state = excluded.state,
  reason = excluded.reason,
  scheduled_at = excluded.scheduled_at,
  started_at = excluded.started_at,
  completed_at = excluded.completed_at,
  attendance_status = excluded.attendance_status,
  changed_at = excluded.changed_at;
