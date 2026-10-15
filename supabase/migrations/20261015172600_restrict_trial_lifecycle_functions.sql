-- Keep CRM trial lifecycle maintenance server-only.
revoke all on function public.mathroom_mark_missed_crm_trials() from public, anon, authenticated;
grant execute on function public.mathroom_mark_missed_crm_trials() to postgres, service_role;

revoke all on function public.mathroom_capture_crm_trial_state() from public, anon, authenticated;
grant execute on function public.mathroom_capture_crm_trial_state() to postgres, service_role;
