-- Mathroom v51.9 — RPC security hardening
-- Student links first create a Supabase Anonymous Auth session, so direct
-- database role "anon" never needs to execute SECURITY DEFINER RPCs.

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.prosecdef
      and has_function_privilege('authenticated',p.oid,'EXECUTE')
  loop
    execute format('revoke execute on function %s from public, anon', r.signature);
    execute format('grant execute on function %s to authenticated', r.signature);
  end loop;
end
$$;

-- Internal/service-only routines stay unavailable to normal signed-in users.
revoke all on function public.create_initial_lesson_board_page()
  from public, anon, authenticated;
grant execute on function public.create_initial_lesson_board_page()
  to service_role;

revoke all on function public.mathroom_create_first_board_page()
  from public, anon, authenticated;

revoke all on function public.mathroom_capture_crm_trial_state()
  from public, anon, authenticated;
grant execute on function public.mathroom_capture_crm_trial_state()
  to service_role;

revoke all on function public.crm_transfer_unstarted_trial(text,uuid)
  from public, anon, authenticated;
grant execute on function public.crm_transfer_unstarted_trial(text,uuid)
  to service_role;

-- Fix mutable search_path warnings on answer/task-bank helpers.
alter function public.mathroom_norm_answer(text) set search_path=public;
alter function public.mathroom_parse_number(text) set search_path=public;
alter function public.mathroom_answer_token(text) set search_path=public;
alter function public.mathroom_answers_equal(text,text) set search_path=public;
alter function public.normalize_task_bank_source_grade_range() set search_path=public;
alter function public.touch_task_bank_updated_at() set search_path=public;
alter function public.task_bank_pick(integer,text,integer,integer) set search_path=public;
alter function public.task_bank_request_ocr(uuid) set search_path=public;
