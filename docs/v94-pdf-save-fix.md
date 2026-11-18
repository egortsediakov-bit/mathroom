# Mathroom v94 — PDF draft saving fix
Date: 2026-11-18

## Confirmed bug
In v93, `js/pdf-import-v91.js` selected all automatically extracted problems by default. Its save handler rejected the **entire selection** when any task had no valid topic/grade match or when an image-only task lacked its crop. One such task blocked all other correctly matched tasks.

The v93 stress PDF intentionally contains mixed math, image-based questions and broken characters, so it frequently triggers this issue. The previous screenshot also showed an unchecked rights confirmation: this separately prevents saving, by design.

## v94 fix
- Added `js/pdf-draft-save-v94.js` to partition the teacher's selection into:
  - **ready**: nonempty condition or attached image, valid per-task grade and topic, no existing duplicate;
  - **pending**: no topic/grade or an image-only task missing its crop;
  - **duplicates**: already imported exercises or repeated statements in the selection.
- The save button now states **«Сохранить готовые задачи: N»** and is enabled whenever **at least one task** is ready, even if other selected tasks need review.
- A persistent status beneath the results explains why tasks can't be saved and lists the first pending task numbers/pages.
- Only ready tasks are saved as *private drafts*, with existing topic assignments, answers and PDF provenance intact. Pending tasks remain in the import modal for continued review; they do not disappear or get assigned an arbitrary topic.
- Rights confirmation is still mandatory, now with an explicit inline status and focus on the relevant checkbox when clicked.
- If Supabase rejects an insert, show the actual per-task error while retaining prior successful saves; retries do not recreate completed entries.
- Does not alter Supabase schema, RLS, shared library, existing exercises, PDF capture or paid AI generation.

## Tests
`node tests/v94-pdf-draft-save.cjs` checks:
1. One classified equation plus one unclassified diagram: save exactly one private draft without blocking.
2. Pending tasks remain visible after a partial save.
3. Unchecked rights box results in no database writes and a helpful message.
4. Simulated one-time Supabase denial produces a visible error; retry creates only one draft.
5. Existing PDF parser and topic-classifier modules still load.

## Manual test
- Reload Mathroom with **Ctrl+F5**, Bank → Import PDF.
- Upload `mathroom_v93_stress_test.pdf`; set class to auto, pages 1–6 and extract.
- Under extracted tasks, look at the new notice: **Готово к сохранению: N** and warnings about unassigned or scan-only tasks.
- Check the rights-use checkbox.
- Click **Сохранить готовые задачи: N** and confirm. Saved tasks become private drafts.
- Assign the remaining tasks their class/topic (or add their image crop), then save them in a second pass.

**Note:** Static/source-level regression tests passed. An authenticated browser session using the actual user account has not yet been exercised by the assistant. If a real Supabase error persists, the new inline message will identify it.
