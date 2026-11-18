# Mathroom v95 — Kotomatika PDF import + remaining-task review
Date: 2026-11-18

## User story
1. A teacher imports mixed math problems from a PDF into a staging area.
2. Ready entries are saved as **private drafts**.
3. When unsaved PDF fragments remain, a **new, separate modal** opens.
4. The teacher corrects topic/grade, attaches a missing drawing, saves useful leftovers, discards invalid extraction, or opens the bank.
5. A prominent **Черновики · N** action in the personal bank filters to saved drafts, which have an explicit **Удалить черновик** action.

## Changes
- Added \`css/pdf-import-v95.css\`, scoped to the existing importer dialogs and consistent with Mathroom's black/white/orange Kotomatika Pro Grid.
- Replaced the plain PDF importer top with a branded dark header, a two-step label, sectioned settings, compact controls, three counters, and individual task cards.
- Added **Удалить из импорта** on each staging card with confirmation. This removes an **unsaved** entry from the in-memory queue only. The original PDF and existing database tasks are never deleted by this action.
- Successful partial save opens the new \`ЭТАП 02 / 02\` dialog, excluding all already saved cards.
- The second dialog supports individual corrections, additional saves, PDF crops using the original local file object, **Убрать все проблемные** (with confirmation), selection controls and **Перейти в личный банк**.
- The new dialog keeps the original PDF file and difficulty in memory until the import closes. It reuses v94's existing duplicate and readiness checks.
- In the bank, **Черновики · N** filters to \`is_draft=true\`. A saved draft shows **Удалить черновик**, invoking the existing authenticated deletion path and confirmation. Switching to the shared library clears this personal draft-only filter.
- Retained previous protections: private drafts, rights acknowledgment, safe retry on write failure, manual review, no automatic publication, no paid AI calls.

## Test
\`node tests/v95-pdf-review.cjs\`

The integration test mocks PDF.js, Supabase inserts and the modal renderer and verifies:
- the first dialog identifies two classifiable tasks and one unresolved drawing;
- the two classifiable tasks are saved to separate topics and remain drafts;
- a *new modal* appears with only the remaining task;
- deleting that task from the queue leaves the saved database records unchanged;
- a second end-to-end run repairs the topic in the follow-up dialog, saves the third draft and returns to the bank.

## Manual browser verification
1. Hard refresh https://mathroom.kotomatika.ru (Ctrl + F5).
2. Open **Банк задач → Импорт PDF** and extract tasks from \`mathroom_v93_stress_test.pdf\`.
3. Check the styled header, small form controls, counters and card-level **Удалить из импорта** buttons.
4. Save the classifiable tasks as private drafts (confirm PDF usage rights).
5. Verify the **separate second window** opens with only unsaved tasks, including those initially unchecked.
6. Select a class and topic for one remaining item, save; delete a corrupt task using **Удалить из импорта** or, for multiple invalid fragments, **Убрать все проблемные**.
7. Go back to the bank, click **Черновики · N** to view only drafts; verify each saved draft has **Удалить черновик** and requires confirmation.

## Limitations
- Removing a task in the importer is not a deletion of a previously stored exercise. Use **Банк задач → Черновики** for that.
- The tool does not automatically distinguish a truly mathematically incorrect task from an incomplete OCR/text-layer extraction. It flags unclassified and duplicate fragments conservatively, and the teacher makes the final deletion choice.
- No new Supabase schema changes or Edge Functions in this release.
- The release has passed JavaScript syntax and mocked workflow tests; an authenticated browser/Storage upload test still requires a live teacher session.
