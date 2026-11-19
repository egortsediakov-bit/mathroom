# Mathroom v98 — PDF duplicate review and intentional copy

Date: 2026-11-19

## Background

The PDF importer blocked an entire selection when all extracted problems matched previous personal-bank entries, without telling the teacher *which* existing problems had matched. Different tasks represented only by scanned figures also carried the same boilerplate placeholder text and risked being classified as duplicates.

## Implemented

### Exact duplicate vs near-match
- `js/pdf-draft-save-v94.js` now performs exact, normalized text matching. A duplicate record includes **source type**, **existing task title**, **condition excerpt**, and the existing task ID when available.
- Source is either a task in the teacher's own bank or an earlier problem in the currently selected PDF batch.
- A separately named **similar but not identical** match is shown as a soft hint, based on the existing v92 comparison. It does not block saving.
- Image-only exercises with separate captures are never automatically conflated just because their text contains the same generic placeholder.
- Seeded tasks explicitly marked `kind:'deleted'` do not prevent reimport.

### Teacher-controlled override
- Each exact duplicate card shows **Показать совпавшую задачу** and **Сохранить как отдельную копию**.
- The override is specific to one problem. It requires a confirmation, selects that problem for import, and may be turned off again.
- The final save confirmation explicitly states the number of deliberately repeated exercises.
- Saved private drafts record `builder_meta.pdf_import.duplicate_review` including `override`, `match_source`, `matched_exercise_id` (where available), and confirmation date.
- An original matching task remains unchanged. No changes are made to shared library, existing exercises, RLS policies or schema.

### Reliability
- After a successful PDF draft save, Mathroom rehydrates the teacher's complete personal bank to prevent Supabase's common 1,000-row response limit from hiding newly saved entries when checking subsequent duplicates.
- The existing two-stage import/review workflow remains intact. All tasks stay **private drafts**, requiring a teacher check before publication.
- Automated AI generation remains off without an explicitly configured API key.

## Testing
Run:
```sh
node tests/v98-pdf-duplicates.cjs
node tests/v95-pdf-review.cjs
node tests/v94-pdf-draft-save.cjs
```

The v98 test covers duplicates in the personal bank, duplicates within a PDF, distinct visual tasks, intentionally deleted seed tasks, opt-in and opt-out per-card behavior, final saving as two independent private drafts and provenance. All three test suites passed in a mocked source-level execution environment.

## Manual verification
1. In Mathroom → **Банк задач → Импорт PDF**, upload a test PDF whose first task was already added to **Черновики**.
2. The repeated task should show **Точное совпадение условия с личным банком** and a disclosure to view the previously saved condition.
3. Confirm that the duplicate is unchecked by default and the main save button counts only ready items.
4. On that task, click **Сохранить как отдельную копию**, approve the explicit confirmation and verify the task is counted as ready.
5. Save the batch; both the new task and intentional copy should appear as private drafts.
6. Check a task that contains nearly identical but not equal text: it should show a similarity hint, but should not be blocked by the exact-duplicate rule.
7. Open **Черновики**, verify deleting one draft retains the others (v97 behavior).

**Verification limitation:** tests cover the algorithm and a mocked browser/Supabase workflow. A real authenticated upload-and-save operation has not been carried out in the user's browser.
