-- Mathroom v62 — automated task generation/review pipeline
-- Mirrors the production schema applied for task generation, validation and quarantine.

create table if not exists public.task_generation_jobs (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.teachers(id) on delete cascade,
  topic_id uuid not null references public.topics(id) on delete cascade,
  mode text not null default 'topic' check (mode in ('topic','similar')),
  source_exercise_id uuid references public.exercises(id) on delete set null,
  difficulty text not null default 'medium' check (difficulty in ('basic','medium','advanced','mixed')),
  requested_count smallint not null default 5 check (requested_count between 1 and 20),
  status text not null default 'queued' check (status in ('queued','running','done','failed','cancelled')),
  ready_count integer not null default 0,
  review_count integer not null default 0,
  rejected_count integer not null default 0,
  accepted_count integer not null default 0,
  error_text text,
  params jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.task_candidates (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.task_generation_jobs(id) on delete cascade,
  teacher_id uuid not null references public.teachers(id) on delete cascade,
  topic_id uuid not null references public.topics(id) on delete cascade,
  parent_exercise_id uuid references public.exercises(id) on delete set null,
  content text not null,
  answer text not null default '',
  solution text not null default '',
  difficulty text not null default 'medium' check (difficulty in ('basic','medium','advanced')),
  task_type text not null default 'standard' check (task_type in ('standard','numeric','single','multiple','open')),
  category text not null default '',
  tags text[] not null default '{}'::text[],
  confidence numeric(5,4) not null default 0.5 check (confidence between 0 and 1),
  status text not null default 'review' check (status in ('ready','review','rejected','accepted','duplicate')),
  validation jsonb not null default '{}'::jsonb,
  generation_meta jsonb not null default '{}'::jsonb,
  exercise_id uuid references public.exercises(id) on delete set null,
  content_hash text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.task_candidate_checks (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.task_candidates(id) on delete cascade,
  teacher_id uuid not null references public.teachers(id) on delete cascade,
  check_type text not null check (check_type in ('independent_solution','answer_match','quality','duplicate','curriculum')),
  passed boolean not null default false,
  score numeric(5,4) not null default 0 check (score between 0 and 1),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.task_relations (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.teachers(id) on delete cascade,
  parent_exercise_id uuid not null references public.exercises(id) on delete cascade,
  child_exercise_id uuid not null references public.exercises(id) on delete cascade,
  relation_type text not null default 'variant' check (relation_type in ('variant','derived_from')),
  created_at timestamptz not null default now(),
  unique (parent_exercise_id, child_exercise_id, relation_type)
);

create index if not exists task_generation_jobs_teacher_created_idx on public.task_generation_jobs(teacher_id, created_at desc);
create index if not exists task_generation_jobs_teacher_status_idx on public.task_generation_jobs(teacher_id, status);
create index if not exists task_candidates_job_status_idx on public.task_candidates(job_id, status);
create index if not exists task_candidates_teacher_status_idx on public.task_candidates(teacher_id, status, created_at desc);
create index if not exists task_candidates_content_hash_idx on public.task_candidates(content_hash);
create index if not exists task_candidate_checks_candidate_idx on public.task_candidate_checks(candidate_id);
create index if not exists task_relations_parent_idx on public.task_relations(parent_exercise_id);
create index if not exists task_relations_child_idx on public.task_relations(child_exercise_id);

alter table public.task_generation_jobs enable row level security;
alter table public.task_candidates enable row level security;
alter table public.task_candidate_checks enable row level security;
alter table public.task_relations enable row level security;

drop policy if exists task_generation_jobs_teacher_select on public.task_generation_jobs;
drop policy if exists task_generation_jobs_teacher_insert on public.task_generation_jobs;
drop policy if exists task_generation_jobs_teacher_update on public.task_generation_jobs;
drop policy if exists task_generation_jobs_teacher_delete on public.task_generation_jobs;
create policy task_generation_jobs_teacher_select on public.task_generation_jobs for select to authenticated using ((select auth.uid()) = teacher_id);
create policy task_generation_jobs_teacher_insert on public.task_generation_jobs for insert to authenticated with check ((select auth.uid()) = teacher_id);
create policy task_generation_jobs_teacher_update on public.task_generation_jobs for update to authenticated using ((select auth.uid()) = teacher_id) with check ((select auth.uid()) = teacher_id);
create policy task_generation_jobs_teacher_delete on public.task_generation_jobs for delete to authenticated using ((select auth.uid()) = teacher_id);

drop policy if exists task_candidates_teacher_select on public.task_candidates;
drop policy if exists task_candidates_teacher_insert on public.task_candidates;
drop policy if exists task_candidates_teacher_update on public.task_candidates;
drop policy if exists task_candidates_teacher_delete on public.task_candidates;
create policy task_candidates_teacher_select on public.task_candidates for select to authenticated using ((select auth.uid()) = teacher_id);
create policy task_candidates_teacher_insert on public.task_candidates for insert to authenticated with check ((select auth.uid()) = teacher_id);
create policy task_candidates_teacher_update on public.task_candidates for update to authenticated using ((select auth.uid()) = teacher_id) with check ((select auth.uid()) = teacher_id);
create policy task_candidates_teacher_delete on public.task_candidates for delete to authenticated using ((select auth.uid()) = teacher_id);

drop policy if exists task_candidate_checks_teacher_select on public.task_candidate_checks;
drop policy if exists task_candidate_checks_teacher_insert on public.task_candidate_checks;
drop policy if exists task_candidate_checks_teacher_delete on public.task_candidate_checks;
create policy task_candidate_checks_teacher_select on public.task_candidate_checks for select to authenticated using ((select auth.uid()) = teacher_id);
create policy task_candidate_checks_teacher_insert on public.task_candidate_checks for insert to authenticated with check ((select auth.uid()) = teacher_id);
create policy task_candidate_checks_teacher_delete on public.task_candidate_checks for delete to authenticated using ((select auth.uid()) = teacher_id);

drop policy if exists task_relations_teacher_select on public.task_relations;
drop policy if exists task_relations_teacher_insert on public.task_relations;
drop policy if exists task_relations_teacher_delete on public.task_relations;
create policy task_relations_teacher_select on public.task_relations for select to authenticated using ((select auth.uid()) = teacher_id);
create policy task_relations_teacher_insert on public.task_relations for insert to authenticated with check ((select auth.uid()) = teacher_id);
create policy task_relations_teacher_delete on public.task_relations for delete to authenticated using ((select auth.uid()) = teacher_id);

revoke all on table public.task_generation_jobs from anon;
revoke all on table public.task_candidates from anon;
revoke all on table public.task_candidate_checks from anon;
revoke all on table public.task_relations from anon;
grant select, insert, update, delete on table public.task_generation_jobs to authenticated;
grant select, insert, update, delete on table public.task_candidates to authenticated;
grant select, insert, delete on table public.task_candidate_checks to authenticated;
grant select, insert, delete on table public.task_relations to authenticated;
grant select, insert, update, delete on table public.task_generation_jobs to service_role;
grant select, insert, update, delete on table public.task_candidates to service_role;
grant select, insert, update, delete on table public.task_candidate_checks to service_role;
grant select, insert, update, delete on table public.task_relations to service_role;
