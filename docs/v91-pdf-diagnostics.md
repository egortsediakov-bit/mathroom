# Mathroom v91 — PDF intake and diagnosed mistakes
Date: 2026-11-18

## Scope

### Import from a PDF text layer
From **Bank → Import PDF** or **Sources and supply → Import PDF**:

- Select a local PDF (max 20 MiB), grade, existing topic, difficulty and up to **25 PDF pages** per extraction.
- The browser uses the existing PDF.js library; extracted PDF bytes are **not uploaded** to Supabase.
- Detect numbered problems, extract up to 60 fragments per import, preserve extracted wording, and let the teacher edit or skip every fragment.
- Detect exact normalized duplicates within the selected topic and within the current extraction.
- Require a teacher confirmation of rights to use the material.
- Save selected fragments **only as private draft exercises** (never publish or assign automatically); each one stores source filename, PDF page, exercise number and provenance in `builder_meta`.
- Teacher edits the draft in the existing Task Builder to check formatting, diagrams and answers; only then may it be published. The builder retains PDF provenance and custom task tags.
- Publishing verified PDF tasks to the shared library asks for another rights/accuracy confirmation.

**Limits:** OCR is not included; scanned/image-only and multi-column PDFs can fail to parse. Mathematical diagrams, tables and PDF notation are not reconstructed with guaranteed fidelity. This is a teacher-reviewed intake workflow, **not** unsupervised harvesting of copyrighted books.

### Diagnostic recommendations by graded mistakes
- `js/error-diagnostics-v91.js` reads scored homework items for the selected teacher's student under existing Supabase RLS.
- Resolves the task topic from its explicit smart-set metadata, linked exercise, or parent homework.
- Aggregates correct/incorrect answers by topic and, where present, by `skill:`, `навык:`, `подтема:` tags or `builder_meta.subtopic` / task category.
- When at least 2 checked items are available for a topic, it prioritizes actual checked homework evidence over the latest aggregate progress snapshot.
- Adaptive recommendations display the counts and reasons behind the chosen weak topics. The student data is **not sent to an external AI provider**.
- Without graded evidence or a valid snapshot, the UI does not invent a mastery score.

### Protection
- Unreviewed drafts are excluded from smart sets by the existing `is_draft` filter.
- Drafts and tasks without an answer cannot be shared through the bank publishing UI.
- No new database tables or data migrations.
- Existing v90 task supply cron remains opt-in and off by default. It cannot generate paid work until `OPENAI_API_KEY` is configured in Supabase.

## Smoke test
`node tests/v91-smoke.cjs` checks numbered-PDF segmentation, topic/skill mistake aggregation, and adaptive prioritization. Tested against v91 repository sources during integration.

## Review checklist before live use
1. Open the Bank screen after GitHub Pages deploy completes; verify the new Import PDF button opens.
2. Upload a *rights-cleared* sample PDF with selectable text and check that exercise text, numbers and page provenance are correct.
3. Save 1–2 items to private drafts; verify they cannot appear in assignments/shared library until reviewed.
4. Edit in Task Builder and verify source filename/page and the PDF tag persist after multiple saves.
5. Review at least one homework item, then check the Adaptive picker shows real error counts and skills where tagged.
6. Check AI generation remains off until a separate API-key setup and small controlled trial.

## Operational warning
Neither **candidate extraction** nor **AI validation confidence** constitutes mathematical correctness. Proofs, diagrams, ambiguous tasks and licensing require a human review before teaching/publication.
