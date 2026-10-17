-- Mathroom v51.8 — reversible teacher access
-- Keeps teacher data intact while allowing admin.kotomatika.ru to disable cabinet access.

alter table public.teachers
  add column if not exists access_enabled boolean not null default true;

comment on column public.teachers.access_enabled is
  'Whether the teacher may use the Mathroom teacher cabinet.';
