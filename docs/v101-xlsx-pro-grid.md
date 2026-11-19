# Mathroom v101 — Excel importer aligned with Kotomatika Pro Grid

Date: 2026-11-19

## Scope

Visual and interaction update of the existing v100 XLSX importer, scoped to the importer panel. Database schema, PDF importer, teacher bank and save semantics are unchanged.

### Visual design
- Pro Grid black/white/orange hero with a task-bank icon, consistent with the main Bank header.
- Three-stage flow indicator: choose workbook, review tasks, save private drafts.
- Summary strip with counts of total entries, selected entries, templates and excluded entries.
- Cleaner task cards with grade/difficulty tags, original math notation typeset via existing KaTeX, an answer row, and expandable worked solution.
- Footer for consent to rights and final draft-save action, aligned with existing Kotomatika branding.
- Mobile layout, keyboard focus styles and dark mode.

### Solution toggle
Each problem's native details/summary now displays:
- **Показать решение** when closed;
- **Скрыть решение** when expanded.

This uses CSS-visible spans rather than a JS global listener, and does not replace the solution text or alter the saved content.

### 66 versus 67 entries
The 6th-grade pilot workbook was independently inspected: it contains **56 READY tasks + 8 descriptive templates + 3 executable generators = 67 unique IDs**.

The original importer *deliberately* selects only the 56 tasks by default because templates require manual approval. Other reasons for 66 accessible entries include previously imported IDs or an invalid row.

v101 adds **✓ Все задачи и шаблоны** to select all eligible entries (67 of 67 for the pristine workbook), and a visible per-record exclusion report:
- If a record is simply unchecked, its ID appears as not selected.
- If it was marked ineligible due to a repeated import ID, duplicate content or validation error, its ID and the exact reason are displayed.
- Duplicate records are not silently force-imported and previously saved tasks are not overwritten.

**Только задачи**, **Снять выбор** and **＋ Добавить шаблоны** remain available.

### QA
- tests/v101-xlsx-select-all.cjs — mocked 67-record workbook verifies all 67 become selected; mocked existing ID verifies 66 eligible and identifies the excluded ID; checks solution toggle style.
- tests/v101-xlsx-design.cjs — Pro Grid DOM and CSS contract.
- tests/v100-xlsx-import.cjs — existing XLSX math, solutions, drafts, template and duplicate regression.

Automated tests run without production writes, in mock/browser-contract environments. The authenticated production browser layout and user file import remain to be verified.

## Manual browser verification

1. Open https://mathroom.kotomatika.ru in Bank Tasks, Ctrl+F5.
2. Upload Kotomatika_6klass_v100_56_zadach.xlsx (67 records).
3. Confirm 56 tasks selected by default; click **✓ Все задачи и шаблоны**; expect 67 selected if all are new.
4. If only 66 can be chosen, inspect the notice above the cards for the specific missing record and reason.
5. Expand a sample solution; the label must change to **Скрыть решение**, and change back when collapsed.
6. Check mobile width and dark mode, then import one or two records as drafts to verify save semantics.
