# Mathroom v102 — AI temporarily disabled everywhere

Date: 2026-11-19

## Reason
The free Mathroom mathematical template engine and the separately billed OpenAI-based task pipeline were confusingly displayed side by side. At the teacher's request, all AI-generation entrypoints are temporarily removed while the unpaid mathematical generator remains in use.

## Frontend
- Bank: removed **✦ Похожие** and the **✦ Источники и пополнение** link that entered the AI/scheduled task pipeline.
- No longer loads `js/task-pipeline-v62.js`, `js/task-supply-v89.js` or the AI-pipeline stylesheet.
- Old saved views `task-pipeline` and `task-supply` redirect safely to the Bank instead of attempting to start a pipeline.
- Task Builder: removed **Сгенерировано AI** as a new source option and **Разрешить AI использовать как пример** checkbox. Any new/edited task saves `settings.allow_ai_example=false`.
- Existing AI-source attribution of historical tasks is preserved as data, rather than silently falsified.
- **↻ Варианты**, **Создать задачу**, import PDF/Excel, drafts, free local math validation, whiteboard and schedules remain.

## Server hard stops (deployed to Supabase)
- `task-pipeline` Edge Function v3 (`verify_jwt=true`): constant `AI_FEATURES_ENABLED=false` prevents generate/accept/reject and all other AI actions **before any database/auth-context or OpenAI calls**. `health` reports `ai_configured:false`. Old cached clients receive `AI_DISABLED`.
- `task-supply-worker` Edge Function v2 (`verify_jwt=false`, unchanged historical auth mode): a constant guard immediately returns `skipped:AI_DISABLED` before reading its cron secret or accessing privileged services.
- Paused existing pg_cron job `mathroom-v90-task-supply` (job 6, every 2 hours) using `cron.alter_job(... active:=false)`. The cron definition is retained for reversibility.
- Forced all existing `task_supply_settings.auto_enabled` to false; query confirmed there were **0 settings rows enabled**. The cron job's inactive state was also verified in SQL.
- No API keys, secrets, generated candidates, exercises, teachers, or drafts have been deleted.
- No service-role keys were exposed to clients.

## Validation
- Tests: `tests/v102-ai-disabled.cjs`, `tests/v101-xlsx-design.cjs`, `tests/v101-xlsx-select-all.cjs`, `tests/v100-xlsx-import.cjs`, `tests/v99-math-check.cjs` passed using source/mock execution.
- Verified live deployed Edge Function source and version, and that cron job `active=false` in the intended Supabase project.
- The browser has not yet been tested in the user's authenticated session.

## Reactivation
AI may be re-enabled only after explicit approval and cost controls: review account billing limits, remove the hard-stop guards, redeploy both Edge Functions, add gated UI back and only then (if desired) reactivate cron and opt-in settings. Do not reactivate the job as a shortcut. Free templates work independently and require no reactivation.
