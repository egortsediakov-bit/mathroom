# Mathroom v90 — Adaptive supply
Date: 2026-11-18

## Included
- `js/adaptive-v90.js`: teacher-only suggestions from the latest `student_progress_snapshots`, followed by the existing task-set builder. No AI call is made for recommendations.
- `js/task-supply-v89.js`: opt-in scheduled supply controls, daily maximum and grade scope.
- `supabase/upgrade-v90-adaptive-supply.sql`: daily-limit settings, service-only gap selector, Vault-backed shared secret.
- `supabase/functions/task-supply-worker/index.ts`: a scheduled worker that reserves at most 5 proposed tasks per invocation and respects the per-teacher daily cap. Processing is disabled unless `auto_enabled=true`.
- `supabase/functions/task-pipeline/index.ts`: authenticates Vault-secret cron jobs using the same candidate-validation pathway as manual generation.

## Production setup
1. Apply the v90 SQL migration.
2. Deploy `task-pipeline` (`verify_jwt=true`) and `task-supply-worker` (`verify_jwt=false`, Vault-secret protected).
3. Schedule `task-supply-worker` via `pg_cron` + `pg_net`, providing the Vault secret in header `x-mr-supply-cron`. The schedule deployed on 2026-11-18 is `0 */2 * * *` UTC, job name `mathroom-v90-task-supply`.
4. In Supabase Edge Function secrets, set `OPENAI_API_KEY` (never in GitHub or browser). Optionally set `OPENAI_MODEL` and `OPENAI_VALIDATOR_MODEL` to valid Responses API models.
5. Under Bank → Sources and supply, set the daily limit (start with 10), select grades or default to active pupils, leave auto-accept **off**, and explicitly enable the background replenishment checkbox.
6. Verify candidate count and job errors after a scheduled run before gradually increasing the quota.

## Safeguards and limitations
- The scheduled worker does not run paid AI tasks if there is no OpenAI key or no opt-in.
- It does not scrape or import PDF textbooks automatically. XLSX import remains intact; copyright checks on external content are needed before future automated imports.
- Progress snapshots give **topic-level** suggestions, not reliable diagnosis of specific mistakes. Without scored observations it recommends nothing rather than inventing mastery.
- Existing pipeline uses LLM-based validation; mathematical proof and geometry still require teacher review.
- This module does not replace old task-bank records.
- Scheduled job loops over eligible teachers but processes at most one job per invocation.
- Service role key and Vault token must remain server-side.

## Verified on 2026-11-18
- Browser JS syntax checks for adaptive, supply and app scripts passed.
- SQL migration applied successfully.
- Supabase Edge Functions deployed; authenticated worker ping returned HTTP 200 with AI_NOT_CONFIGURED, and unauthenticated ping HTTP 401.
- Existing data showed 5976 exercises, 1699 topics, zero generation jobs and zero candidates prior to rollout.
