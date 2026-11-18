# Mathroom v93 — PDF text-layout fix and task-by-task topic suggestions
Date: 2026-11-18

## Bug reproduced and fixed

Mathroom's own `mathroom_v92_test_tasks.pdf` was incorrectly reported as having no numbered text tasks. The PDF is valid and contains a selectable text layer on pages 1, 2 and 4. Its task numbers are typeset in a separate left-side badge; the task text begins about 43 points to the right and 9 points above the badge's baseline.

Previously, `js/pdf-import-v91.js` required a string like `1. Решите уравнение…`. The new `js/pdf-layout-v93.js` groups PDF.js text items by layout coordinates and pairs isolated numbers with adjacent task bodies. It also retains support for inline `1. Task…` numbering. Large gaps and generic page labels are excluded from each task's text.

### Expected extraction from the four-page test PDF
- Page 1: tasks 1, 2, 3.
- Page 2: tasks 4, 5, 6.
- Page 3: 0 text tasks, because this page is an image-only scan; use **＋ Задача со скана**.
- Page 4: tasks 9, 10, 11. Task 9 duplicates task 1, and task 11 contains a corrupt symbol; both deserve manual review rather than automatic publishing.

## Automatic topic selection

`js/pdf-topics-v93.js` runs locally in the browser and compares each extracted task to the actual `S.topics` list belonging to the signed-in teacher. It handles named math concepts using explainable keyword/rule matching, with a cautious lexical fallback for other familiar curriculum topic names.

Examples:
- Linear equations → grade 7 / «Линейное уравнение с одной переменной».
- Expressions with squares → grade 7 / «Формулы сокращённого умножения».
- Isosceles triangle → grade 7 / «Свойства равнобедренного треугольника».
- Arithmetic mean → grade 6 / «Среднее арифметическое».
- Rectangle area → grade 3 / «Площадь прямоугольника и квадрата» in the available curriculum.

**Important**: suggested grades are heuristic, **not verified curricular grade requirements**. The match percentage is an algorithm score, **not a calibrated probability**. Unreadable or ambiguous problems are left for teacher classification.

### UI behavior
- The top-level grade is **Определять автоматически** by default. It is only a hint to the matcher.
- The top-level topic is optional; it serves as a fallback only when the matcher cannot decide.
- Each task gets its own grade and topic dropdowns and a **✦ Определить по условию** button.
- Any suggestion can be changed; changing grade clears a previous topic choice.
- Saving selected tasks is blocked when any selected task has no valid topic/grade pairing.
- Exercises are inserted **individually** with their chosen `topic_id`, grade and classification provenance; every imported exercise is a **private draft**.
- Duplicate screening works across the hydrated private bank, not only a single topic or the first 1000 rows.
- No AI API key is needed; no information is sent to another AI service.

## Tests
`node tests/v93-pdf-auto-topics.cjs`

The test fixture reproduces the layout and source text of the four-page PDF, covers nine text tasks, stripped sidenotes, four reliable topic assignments, the original `1. Text` format and missing/garbled formula cases. Also retain:
- `node tests/v91-smoke.cjs`
- `node tests/v92-smoke.cjs`

## Manual browser check
1. Open Bank → PDF Import and select `mathroom_v92_test_tasks.pdf`.
2. Leave grade as **Определять автоматически**, leave fallback topic empty, set pages 1–4 and click **Извлечь задания**.
3. Confirm 9 text tasks found, plus the image-only scan page 3.
4. Verify individual grade/topic suggestions on 1/2/4/5/6 and leave item 3 unclassified until its mathematical figure is reviewed.
5. Change the grade/topic of a problem and verify the change is saved only for that exercise.
6. Import two **rights-cleared, checked** tasks to private drafts and check `exercises.topic_id` differs accordingly.
7. Confirm that the scan cropper and existing task builder still work. Do not publish unverified sample problems.

## Limitations
- This parser is optimized for isolated badge numbers and inline numbering. Unusual multi-column PDF layouts, handwritten scans, nested exercises or graphical numbers may still need manual cropping or OCR.
- Auto-topic matching is heuristic and currently operates on selectable text only; it cannot infer the mathematical content of an image-only formula without OCR/vision.
- The default grade/level of a given exercise is a suggested curriculum match, **not a statement of the correct difficulty or school year**.
- No changes to Supabase schema, RLS or server-side AI functions were needed.
