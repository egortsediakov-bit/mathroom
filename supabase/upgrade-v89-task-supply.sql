-- Mathroom v89 — task supply engine settings
create table if not exists public.task_supply_settings (
  teacher_id uuid primary key references public.teachers(id) on delete cascade,
  target_basic smallint not null default 20 check (target_basic between 0 and 200),
  target_medium smallint not null default 30 check (target_medium between 0 and 200),
  target_advanced smallint not null default 15 check (target_advanced between 0 and 200),
  target_generators smallint not null default 5 check (target_generators between 0 and 50),
  max_tasks_per_run smallint not null default 30 check (max_tasks_per_run between 1 and 100),
  auto_accept_ready boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.task_supply_settings enable row level security;
drop policy if exists task_supply_settings_teacher_select on public.task_supply_settings;
drop policy if exists task_supply_settings_teacher_insert on public.task_supply_settings;
drop policy if exists task_supply_settings_teacher_update on public.task_supply_settings;
drop policy if exists task_supply_settings_teacher_delete on public.task_supply_settings;
create policy task_supply_settings_teacher_select on public.task_supply_settings for select to authenticated
using ((select coalesce((auth.jwt()->>'is_anonymous')::boolean,false)) is false and (select auth.uid())=teacher_id);
create policy task_supply_settings_teacher_insert on public.task_supply_settings for insert to authenticated
with check ((select coalesce((auth.jwt()->>'is_anonymous')::boolean,false)) is false and (select auth.uid())=teacher_id);
create policy task_supply_settings_teacher_update on public.task_supply_settings for update to authenticated
using ((select coalesce((auth.jwt()->>'is_anonymous')::boolean,false)) is false and (select auth.uid())=teacher_id)
with check ((select coalesce((auth.jwt()->>'is_anonymous')::boolean,false)) is false and (select auth.uid())=teacher_id);
create policy task_supply_settings_teacher_delete on public.task_supply_settings for delete to authenticated
using ((select coalesce((auth.jwt()->>'is_anonymous')::boolean,false)) is false and (select auth.uid())=teacher_id);
revoke all on table public.task_supply_settings from anon,authenticated,service_role;
grant select,insert,update,delete on table public.task_supply_settings to authenticated;
grant select,insert,update,delete on table public.task_supply_settings to service_role;
