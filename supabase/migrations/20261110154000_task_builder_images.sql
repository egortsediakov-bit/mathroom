-- Mathroom v63 — task builder image attachments.
-- Production migration applied via Supabase MCP on 2026-11-10.

alter table public.shared_materials
  add column if not exists builder_meta jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.shared_materials'::regclass
      and conname='shared_materials_builder_meta_object_chk'
  ) then
    alter table public.shared_materials
      add constraint shared_materials_builder_meta_object_chk
      check (jsonb_typeof(builder_meta)='object');
  end if;
end $$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values(
  'task-images',
  'task-images',
  false,
  15728640,
  array['image/png','image/jpeg','image/webp','image/gif']::text[]
)
on conflict(id) do update
set public=false,
    file_size_limit=excluded.file_size_limit,
    allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists task_images_select on storage.objects;
drop policy if exists task_images_insert on storage.objects;
drop policy if exists task_images_update on storage.objects;
drop policy if exists task_images_delete on storage.objects;

create policy task_images_select
on storage.objects for select to authenticated
using (
  bucket_id='task-images'
  and storage.allow_any_operation(array['object.get_authenticated_info','object.get_authenticated'])
);

create policy task_images_insert
on storage.objects for insert to authenticated
with check (
  bucket_id='task-images'
  and (storage.foldername(name))[1]=(select auth.uid())::text
);

create policy task_images_update
on storage.objects for update to authenticated
using (
  bucket_id='task-images'
  and (storage.foldername(name))[1]=(select auth.uid())::text
)
with check (
  bucket_id='task-images'
  and (storage.foldername(name))[1]=(select auth.uid())::text
);

create policy task_images_delete
on storage.objects for delete to authenticated
using (
  bucket_id='task-images'
  and (storage.foldername(name))[1]=(select auth.uid())::text
);
