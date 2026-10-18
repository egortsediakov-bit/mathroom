-- Mathroom v52.1 — shared textbook mappings + personal library references.
-- Applied to production Supabase on 2026-10-18.

alter table public.textbook_topic_links
  add column if not exists topic_grade integer,
  add column if not exists topic_section text,
  add column if not exists topic_title text;

update public.textbook_topic_links l
set topic_grade=t.grade,
    topic_section=coalesce(t.section,''),
    topic_title=t.title
from public.topics t
where t.id=l.topic_id
  and (
    l.topic_grade is distinct from t.grade
    or l.topic_section is distinct from coalesce(t.section,'')
    or l.topic_title is distinct from t.title
  );

create table if not exists public.teacher_textbook_library (
  teacher_id uuid not null references public.teachers(id) on delete cascade,
  textbook_id uuid not null references public.textbooks(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (teacher_id,textbook_id)
);

create index if not exists idx_teacher_textbook_library_book
  on public.teacher_textbook_library(textbook_id,teacher_id);

alter table public.teacher_textbook_library enable row level security;
revoke all on table public.teacher_textbook_library from anon,authenticated;
grant select,insert,delete on table public.teacher_textbook_library to authenticated;

drop policy if exists teacher_textbook_library_select_own on public.teacher_textbook_library;
create policy teacher_textbook_library_select_own
on public.teacher_textbook_library for select to authenticated
using (teacher_id=(select auth.uid()));

drop policy if exists teacher_textbook_library_insert_own on public.teacher_textbook_library;
create policy teacher_textbook_library_insert_own
on public.teacher_textbook_library for insert to authenticated
with check (
  teacher_id=(select auth.uid())
  and exists (
    select 1 from public.teachers t
    where t.id=(select auth.uid()) and t.access_enabled=true
  )
  and exists (
    select 1 from public.textbooks b
    where b.id=teacher_textbook_library.textbook_id
      and b.is_shared=true
      and b.teacher_id<>(select auth.uid())
  )
);

drop policy if exists teacher_textbook_library_delete_own on public.teacher_textbook_library;
create policy teacher_textbook_library_delete_own
on public.teacher_textbook_library for delete to authenticated
using (teacher_id=(select auth.uid()));

drop policy if exists textbook_topic_links_teacher_all on public.textbook_topic_links;
create policy textbook_topic_links_teacher_all
on public.textbook_topic_links for all to authenticated
using (teacher_id=(select auth.uid()))
with check (
  teacher_id=(select auth.uid())
  and exists (
    select 1 from public.topics t
    where t.id=textbook_topic_links.topic_id
      and t.teacher_id=(select auth.uid())
  )
  and exists (
    select 1 from public.textbooks b
    where b.id=textbook_topic_links.textbook_id
      and (
        b.teacher_id=(select auth.uid())
        or (
          b.is_shared=true
          and exists (
            select 1 from public.teacher_textbook_library lib
            where lib.teacher_id=(select auth.uid())
              and lib.textbook_id=b.id
          )
        )
      )
  )
);

drop policy if exists textbook_topic_links_shared_master_select on public.textbook_topic_links;
create policy textbook_topic_links_shared_master_select
on public.textbook_topic_links for select to authenticated
using (
  exists (
    select 1 from public.teachers t
    where t.id=(select auth.uid()) and t.access_enabled=true
  )
  and exists (
    select 1 from public.textbooks b
    where b.id=textbook_topic_links.textbook_id
      and b.is_shared=true
      and b.teacher_id=textbook_topic_links.teacher_id
  )
);

create schema if not exists private;

create or replace function private.fill_textbook_topic_link_meta()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_grade integer;
  v_section text;
  v_title text;
begin
  select t.grade,coalesce(t.section,''),t.title
  into v_grade,v_section,v_title
  from public.topics t
  where t.id=new.topic_id and t.teacher_id=new.teacher_id;

  if v_title is null then
    raise exception 'Topic does not belong to link teacher';
  end if;

  new.topic_grade:=v_grade;
  new.topic_section:=v_section;
  new.topic_title:=v_title;
  return new;
end;
$$;
revoke all on function private.fill_textbook_topic_link_meta() from public,anon,authenticated;

drop trigger if exists trg_textbook_topic_link_meta on public.textbook_topic_links;
create trigger trg_textbook_topic_link_meta
before insert or update of topic_id,teacher_id
on public.textbook_topic_links
for each row execute function private.fill_textbook_topic_link_meta();

create or replace function private.propagate_topic_meta_to_textbook_links()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  update public.textbook_topic_links l
  set topic_grade=new.grade,
      topic_section=coalesce(new.section,''),
      topic_title=new.title
  where l.topic_id=new.id and l.teacher_id=new.teacher_id;
  return new;
end;
$$;
revoke all on function private.propagate_topic_meta_to_textbook_links() from public,anon,authenticated;

drop trigger if exists trg_topic_meta_to_textbook_links on public.topics;
create trigger trg_topic_meta_to_textbook_links
after update of grade,section,title on public.topics
for each row
when (
  old.grade is distinct from new.grade
  or old.section is distinct from new.section
  or old.title is distinct from new.title
)
execute function private.propagate_topic_meta_to_textbook_links();

create or replace function private.cleanup_unshared_textbook_personal_refs()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  if old.is_shared=true and new.is_shared=false then
    delete from public.textbook_topic_links l
    where l.textbook_id=new.id and l.teacher_id<>new.teacher_id;

    delete from public.teacher_textbook_library lib
    where lib.textbook_id=new.id;
  end if;
  return new;
end;
$$;
revoke all on function private.cleanup_unshared_textbook_personal_refs() from public,anon,authenticated;

drop trigger if exists trg_cleanup_unshared_textbook_personal_refs on public.textbooks;
create trigger trg_cleanup_unshared_textbook_personal_refs
after update of is_shared on public.textbooks
for each row execute function private.cleanup_unshared_textbook_personal_refs();
