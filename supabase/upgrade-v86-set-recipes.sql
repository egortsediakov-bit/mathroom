-- Mathroom v86 — reusable task-set recipes
create table if not exists public.task_set_recipes (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.teachers(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 160),
  grade smallint check (grade between 1 and 11),
  mode text not null default 'single' check (mode in ('single','multi')),
  difficulty_mode text not null default 'balanced' check (difficulty_mode in ('balanced','basic','medium','advanced')),
  allow_templates boolean not null default true,
  config jsonb not null default '{}'::jsonb check (jsonb_typeof(config)='object'),
  use_count integer not null default 0 check (use_count >= 0),
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists task_set_recipes_teacher_updated_idx on public.task_set_recipes(teacher_id, updated_at desc);
alter table public.task_set_recipes enable row level security;
drop policy if exists task_set_recipes_teacher_select on public.task_set_recipes;
drop policy if exists task_set_recipes_teacher_insert on public.task_set_recipes;
drop policy if exists task_set_recipes_teacher_update on public.task_set_recipes;
drop policy if exists task_set_recipes_teacher_delete on public.task_set_recipes;
create policy task_set_recipes_teacher_select
  on public.task_set_recipes for select to authenticated
  using (
    (select coalesce((auth.jwt()->>'is_anonymous')::boolean,false)) is false
    and (select auth.uid()) = teacher_id
  );
create policy task_set_recipes_teacher_insert
  on public.task_set_recipes for insert to authenticated
  with check (
    (select coalesce((auth.jwt()->>'is_anonymous')::boolean,false)) is false
    and (select auth.uid()) = teacher_id
  );
create policy task_set_recipes_teacher_update
  on public.task_set_recipes for update to authenticated
  using (
    (select coalesce((auth.jwt()->>'is_anonymous')::boolean,false)) is false
    and (select auth.uid()) = teacher_id
  )
  with check (
    (select coalesce((auth.jwt()->>'is_anonymous')::boolean,false)) is false
    and (select auth.uid()) = teacher_id
  );
create policy task_set_recipes_teacher_delete
  on public.task_set_recipes for delete to authenticated
  using (
    (select coalesce((auth.jwt()->>'is_anonymous')::boolean,false)) is false
    and (select auth.uid()) = teacher_id
  );
revoke all on table public.task_set_recipes from anon, authenticated, service_role;
grant select, insert, update, delete on table public.task_set_recipes to authenticated;
grant select, insert, update, delete on table public.task_set_recipes to service_role;
