-- Mathroom v56.0 — storage/load cleanup.
-- Applied to production Supabase on 2026-10-21.

create schema if not exists private;
revoke all on schema private from public;

create table if not exists private.legacy_table_archives (
  archive_key text primary key,
  archived_at timestamptz not null default now(),
  row_count bigint not null,
  payload jsonb not null,
  note text not null default ''
);
revoke all on table private.legacy_table_archives from public, anon, authenticated;

insert into private.legacy_table_archives(archive_key,archived_at,row_count,payload,note)
select
  'task_bank_ocr_pages_2026_10_21',
  now(),
  count(*),
  coalesce(jsonb_agg(to_jsonb(t) order by t.page_no,t.id),'[]'::jsonb),
  'Archived before Mathroom v56 storage/load cleanup. Legacy PDF OCR pipeline is disabled.'
from public.task_bank_ocr_pages t
on conflict (archive_key) do update
set archived_at=excluded.archived_at,
    row_count=excluded.row_count,
    payload=excluded.payload,
    note=excluded.note;

insert into private.legacy_table_archives(archive_key,archived_at,row_count,payload,note)
select
  'task_bank_import_candidates_2026_10_21',
  now(),
  count(*),
  coalesce(jsonb_agg(to_jsonb(t) order by t.created_at,t.id),'[]'::jsonb),
  'Archived before Mathroom v56 storage/load cleanup. Replaced by direct XLSX import into exercises.'
from public.task_bank_import_candidates t
on conflict (archive_key) do update
set archived_at=excluded.archived_at,
    row_count=excluded.row_count,
    payload=excluded.payload,
    note=excluded.note;

insert into private.legacy_table_archives(archive_key,archived_at,row_count,payload,note)
select
  'lesson_board_versions_2026_10_21',
  now(),
  count(*),
  coalesce(jsonb_agg(to_jsonb(t) order by t.created_at,t.id),'[]'::jsonb),
  'Archived before disabling persistent post-lesson board history.'
from public.lesson_board_versions t
on conflict (archive_key) do update
set archived_at=excluded.archived_at,
    row_count=excluded.row_count,
    payload=excluded.payload,
    note=excluded.note;

drop function if exists public.mathroom_import_task_candidates(uuid[]);
drop table if exists public.task_bank_import_candidates;
drop table if exists public.task_bank_ocr_pages;

delete from public.lesson_board_versions;

create or replace function private.mathroom_cleanup_transient_data()
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_signals integer := 0;
  v_pages integer := 0;
  v_versions integer := 0;
begin
  delete from public.webrtc_signals
  where created_at < now() - interval '5 minutes';
  get diagnostics v_signals = row_count;

  delete from public.board_pages bp
  using public.lessons l
  where bp.lesson_id = l.id
    and l.status = 'completed'
    and coalesce(l.completed_at,l.started_at,l.scheduled_at,l.created_at)
        < now() - interval '7 days';
  get diagnostics v_pages = row_count;

  delete from public.lesson_board_versions v
  using public.lessons l
  where v.lesson_id = l.id
    and l.status = 'completed'
    and coalesce(l.completed_at,l.started_at,l.scheduled_at,l.created_at)
        < now() - interval '1 day';
  get diagnostics v_versions = row_count;

  return jsonb_build_object(
    'webrtc_signals_deleted',v_signals,
    'board_pages_deleted',v_pages,
    'board_versions_deleted',v_versions,
    'ran_at',now()
  );
end;
$$;
revoke all on function private.mathroom_cleanup_transient_data() from public, anon, authenticated;

do $$
declare
  v_job bigint;
begin
  select jobid into v_job from cron.job where jobname='mathroom-clean-transient-data' limit 1;
  if v_job is not null then
    perform cron.unschedule(v_job);
  end if;
  perform cron.schedule(
    'mathroom-clean-transient-data',
    '17 * * * *',
    'select private.mathroom_cleanup_transient_data();'
  );
end
$$;
