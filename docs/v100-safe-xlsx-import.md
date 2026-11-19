# Mathroom v100 — safe XLSX import, rendered math, solutions, generator drafts

## Before v100

The old script js/task-bank-xlsx-import-v300.js loaded READY directly into public.exercises, dropped the solution field, and offered no safe preview. v100 replaces that script in index.html but leaves the old source file in Git history for rollback.

## New pipeline

- js/xlsx-import-core-v100.js: deterministic, no-eval row normalization; textbook-style KaTeX formatting for simple fractions, mixed numbers, equations, powers and roots.
- js/task-bank-xlsx-import-v100.js: preview, selection, duplicate checking, paginated list, rights confirmation, and explicit private-draft import.
- css/xlsx-import-v100.css: Mathroom/Kotomatika-branded UI and visible source review block in Task Builder.

On initial file selection Mathroom only reads the file and checks IDs: it does NOT write database records. New valid tasks are preselected in the preview; templates are opt-in. The user must confirm rights and the final action. All inserted exercises have is_draft:true, settings.shared:false and settings.allow_tests:false. Existing exercises are never overwritten or removed.

The upload creates/uses the signed-in teacher's topics, deduplicates by task_id and exact condition, writes in batches of up to 80, and avoids duplicating successfully uploaded rows on retries.

## Workbook format

Required READY columns: task_id, grade (1–11), topic, task_text.
Optional READY columns: answer, solution, hints, difficulty, difficulty_score, section, verification_note, review_status, confidence, source, source_file, source_url, license, pdf_page, exercise_no.

Optional sheet РЕШЕНИЯ supplies missing worked solutions by task_id.

Optional sheet ШАБЛОНЫ contains legacy descriptive templates. They can be imported as personal drafts only after explicit selection. Source template text, variables, restrictions and formula are preserved in builder_meta.xlsx_import.template_review and displayed to the teacher. These records are NOT automatically activated as working generators.

Optional sheet GENERATORS or TEMPLATES supports machine-readable rows with template_id, grade, topic, template_text with {{...}} placeholders, variables_json (array of 1–12 variable specs), answer_template and optional template_solution, integer_answers and template_condition_filter. Valid machine-readable templates have builder_meta.template_vars for Mathroom's own generator engine; even these require teacher review and start as drafts. Unsafe or malformed expressions are rejected.

Literal fractions are typeset but generator placeholders remain intact. Example:
  Вычислите: 2 1/6 − 5/9.
becomes:
  Вычислите: \(2\frac{1}{6} - \frac{5}{9}\).
Original plain text is preserved in builder_meta.xlsx_import.original_condition. All solutions are available in builder_meta.solution and survive subsequent Task Builder edits.

## Review, safety and verification

Task Builder retains XLSX metadata, exposes the descriptive source of imported templates and requires teacher confirmation on promotion from draft. No API key, paid AI, SQL schema change or scheduled job is required.

Pilot workbook Kotomatika_6klass_v100_56_zadach.xlsx: 56 tasks, 79 microtopics, 8 legacy descriptive templates plus 3 new parameterized generators. Original conditions were not rewritten; difficulty labels were recalibrated, and 8 new harder tasks added. New advanced task answers were independently recalculated; each task still requires human sign-off before publication.

Tests run:
- node tests/v100-xlsx-import.cjs
- node tests/v99-math-check.cjs
- node tests/v98-pdf-duplicates.cjs
- node tests/v97-bank-draft-delete.cjs
- node tests/v95-pdf-review.cjs
- node tests/v94-pdf-draft-save.cjs

Automated validation uses mocked browser/Supabase calls and does not touch live teacher data. A real authenticated UI import must be checked before importing the full pilot book. Test first with two selected tasks from READY, verify their rendered fractions, answers and solutions, then try a single template.
