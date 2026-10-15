create table if not exists public.crm_trial_sync_state (
  lead_id text primary key,
  lesson_id uuid,
  state text not null check (state in ('scheduled','completed','deleted')),
  scheduled_at timestamptz,
  completed_at timestamptz,
  changed_at timestamptz not null default now()
);

alter table public.crm_trial_sync_state enable row level security;

create index if not exists idx_crm_trial_sync_state_changed_at
  on public.crm_trial_sync_state(changed_at desc);

create or replace function public.mathroom_capture_crm_trial_state()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_event_key text;
  v_lead_id text;
begin
  if tg_op = 'DELETE' then
    v_event_key := old.crm_event_key;

    if v_event_key is null or v_event_key not like 'crm-trial:%' then
      return old;
    end if;

    v_lead_id := substring(v_event_key from length('crm-trial:') + 1);

    -- Removing an already completed lesson from history must not undo the
    -- fact that the trial lesson actually happened.
    if old.status = 'completed' then
      return old;
    end if;

    insert into public.crm_trial_sync_state(
      lead_id, lesson_id, state, scheduled_at, completed_at, changed_at
    )
    values (
      v_lead_id, old.id, 'deleted', null, null, now()
    )
    on conflict (lead_id) do update set
      lesson_id = excluded.lesson_id,
      state = 'deleted',
      scheduled_at = null,
      completed_at = null,
      changed_at = now();

    return old;
  end if;

  v_event_key := new.crm_event_key;
  if v_event_key is null or v_event_key not like 'crm-trial:%' then
    return new;
  end if;

  v_lead_id := substring(v_event_key from length('crm-trial:') + 1);

  insert into public.crm_trial_sync_state(
    lead_id, lesson_id, state, scheduled_at, completed_at, changed_at
  )
  values (
    v_lead_id,
    new.id,
    case when new.status = 'completed' then 'completed'
         when new.status = 'cancelled' then 'deleted'
         else 'scheduled' end,
    case when new.status = 'cancelled' then null else new.scheduled_at end,
    case when new.status = 'completed' then coalesce(new.completed_at, now()) else null end,
    now()
  )
  on conflict (lead_id) do update set
    lesson_id = excluded.lesson_id,
    state = excluded.state,
    scheduled_at = excluded.scheduled_at,
    completed_at = excluded.completed_at,
    changed_at = now();

  return new;
end;
$$;

drop trigger if exists trg_mathroom_crm_trial_state on public.lessons;
create trigger trg_mathroom_crm_trial_state
after insert or update or delete on public.lessons
for each row execute function public.mathroom_capture_crm_trial_state();

insert into public.crm_trial_sync_state(
  lead_id, lesson_id, state, scheduled_at, completed_at, changed_at
)
select
  substring(l.crm_event_key from length('crm-trial:') + 1),
  l.id,
  case when l.status = 'completed' then 'completed'
       when l.status = 'cancelled' then 'deleted'
       else 'scheduled' end,
  case when l.status = 'cancelled' then null else l.scheduled_at end,
  case when l.status = 'completed' then l.completed_at else null end,
  now()
from public.lessons l
where l.crm_event_key like 'crm-trial:%'
on conflict (lead_id) do update set
  lesson_id = excluded.lesson_id,
  state = excluded.state,
  scheduled_at = excluded.scheduled_at,
  completed_at = excluded.completed_at,
  changed_at = excluded.changed_at;
