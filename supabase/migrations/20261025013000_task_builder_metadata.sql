-- Task constructor metadata for the operational Mathroom exercise bank.
alter table public.exercises
  add column if not exists builder_meta jsonb not null default '{}'::jsonb,
  add column if not exists is_draft boolean not null default false;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.exercises'::regclass
      and conname='exercises_builder_meta_object_chk'
  ) then
    alter table public.exercises
      add constraint exercises_builder_meta_object_chk
      check (jsonb_typeof(builder_meta)='object');
  end if;
end $$;

create index if not exists exercises_teacher_draft_idx
  on public.exercises (teacher_id, is_draft, updated_at desc);
