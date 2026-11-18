# Mathroom v96 — PDF import layout and warning cleanup

- PDF importer modal is constrained to the visible viewport; card content, selects, and text areas have explicit `max-width:100%` and `min-width:0` so the **Тема задачи** selector cannot push the form sideways.
- On viewports below 1050px, task-level **Класс задачи** and **Тема задачи** stack vertically instead of clipping the second field.
- Missing answer no longer creates an orange import-quality warning, because a draft is *allowed* to have no answer. Publishing remains subject to Task Builder validation.
- Genuine warnings for missing illustrations (including Russian cases such as **по рисунку**), corrupt mathematical glyphs, extremely short conditions, and near-duplicates are kept.
- The post-save review screen from v95 and saved draft deletion in the Bank are unchanged.

Tests: `node tests/v96-pdf-layout.cjs`; `node tests/v95-pdf-review.cjs`. Both passed on source-code and mocked interactions. Browser layout under the user's authenticated session remains to be confirmed manually.

Manual check: refresh Mathroom with Ctrl+F5, open Bank → PDF Import, try a PDF with tasks without answers. Observe that only meaningful import issues show orange warnings, and class/topic dropdowns are visible at narrow browser widths.
