-- Mathroom v84 — saved immutable task-set snapshots
create table if not exists public.saved_task_sets (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.teachers(id) on delete cascade,
  topic_id uuid references public.topics(id) on delete set null,
  title text not null check (char_length(btrim(title)) between 1 and 160),
  difficulty_mode text not null default 'balanced' check (difficulty_mode in ('balanced','basic','medium','advanced')),
  item_count smallint not null default 0 check (item_count between 0 and 100),
  items jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array'),
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  cloned_from uuid references public.saved_task_sets(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists saved_task_sets_teacher_updated_idx on public.saved_task_sets(teacher_id, updated_at desc);
create index if not exists saved_task_sets_teacher_topic_idx on public.saved_task_sets(teacher_id, topic_id);
alter table public.saved_task_sets enable row level security;
drop policy if exists saved_task_sets_teacher_select on public.saved_task_sets;
drop policy if exists saved_task_sets_teacher_insert on public.saved_task_sets;
drop policy if exists saved_task_sets_teacher_update on public.saved_task_sets;
drop policy if exists saved_task_sets_teacher_delete on public.saved_task_sets;
create policy saved_task_sets_teacher_select on public.saved_task_sets for select to authenticated using ((select auth.uid()) = teacher_id);
create policy saved_task_sets_teacher_insert on public.saved_task_sets for insert to authenticated with check ((select auth.uid()) = teacher_id);
create policy saved_task_sets_teacher_update on public.saved_task_sets for update to authenticated using ((select auth.uid()) = teacher_id) with check ((select auth.uid()) = teacher_id);
create policy saved_task_sets_teacher_delete on public.saved_task_sets for delete to authenticated using ((select auth.uid()) = teacher_id);
revoke all on table public.saved_task_sets from anon, authenticated, service_role;
grant select, insert, update, delete on table public.saved_task_sets to authenticated;
grant select, insert, update, delete on table public.saved_task_sets to service_role;
