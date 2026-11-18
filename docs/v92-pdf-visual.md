# Mathroom v92 — PDF visual capture and pre-import audit
Released: 2026-11-18

## Changes
- The existing **Банк задач → Импорт PDF** flow now includes **▧ Прикрепить формулу / чертёж из PDF** on each extracted task.
- The teacher can open the original PDF page in a local canvas, mark a rectangle by pointer or touch, and attach the selected PNG to the task. The original PDF file stays in the browser.
- PNGs are uploaded **only** when saving the selected task as a *private draft*. Assets reuse the existing private Supabase Storage bucket `task-images` and the established per-teacher folder policy.
- Draft `builder_meta.images`, `text_blocks` and `content_order` use the same schema as the Task Builder. Source filename and PDF page are stored with the draft.
- An image-only PDF page can be imported using **＋ Задача со скана** after the PDF is opened with **Извлечь задания**. The teacher must attach a screenshot. Placeholder text explicitly says the condition must be reviewed.
- The importer flags common failure signals: unreadable replacement/private-use characters, references to missing illustrations, absent answers, short conditions and closely matching problems in the personal bank.
- Duplicate screening first reuses the existing `MathroomBankAllExercisesV2982` hydration to consider all teacher-owned tasks, not only the first 1,000 rows.
- All tasks remain **private drafts**. On first promotion from draft, the Task Builder requires a correct answer, its normal quality audit and an explicit teacher confirmation that the PDF condition, mathematical signs, diagrams and rights were checked.
- If an image upload succeeds but inserting its task fails, the importer attempts to remove that newly uploaded image. It tracks partially successful imports to avoid accidentally recreating completed drafts when retrying.

## Test instructions
- `node tests/v91-smoke.cjs`
- `node tests/v92-smoke.cjs`

## Limitations
- PDF text, math formulas, tables and geometry are **not reliably semantically recognized**. The screenshot preserves source appearance for review. The editable text is whatever PDF.js extracted; the teacher must check it.
- Image-only scanned PDF files are not OCRed, and no mathematical solution validator is built into this release.
- Overlapping or multi-column tasks and PDF text with unusual glyph encoding may still extract incorrectly.
- Similarity detection is a **heuristic**; it is not a proof of mathematical equivalence and never silently deletes tasks.
- Automatic AI replenishment from v90 remains disabled without an OpenAI API key and explicit opt-in; v92 does not change this or incur paid model calls.
- No new database schema/migrations or third-party PDF services.

## Manual regression checklist
1. In the Bank choose **Импорт PDF**, select a rights-cleared PDF (up to 20MB) and extract selected pages.
2. With a geometry or table question, click **Прикрепить формулу / чертёж из PDF**, drag a rectangle, confirm; check preview image on the task card.
3. Save to drafts and inspect the task in Task Builder: image, text, source file, PDF page and answer should remain.
4. For a scanned PDF, run **Извлечь задания** then **Задача со скана**, capture an image and save a private draft.
5. Confirm the draft is not automatically assigned to a learner or published in the shared bank.
6. Try publishing a PDF task with no answer; the builder must block. After adding a reviewed answer, explicitly confirm PDF fidelity.
7. Try an intentionally similar existing task, and a task missing a referenced picture; the importer should show a warning.
8. Check the application build marker `92.0-pdf-visual` after a GitHub Pages deploy.

**Release verification**: static JavaScript parsing and functional smoke tests passed on source files. An authenticated live browser import with real PDF and Storage upload was not performed by the assistant. Do not interpret smoke tests as end-to-end production validation.
