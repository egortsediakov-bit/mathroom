# Mathroom v97 — keep drafts visible after deleting one task

## Bug
After a teacher filtered the personal bank to **Черновики · 20**, deleting one draft could make the remaining tasks disappear from the screen. They still existed: clicking **Черновики · 19** again displayed them.

Two issues contributed:
- The deletion handler called `renderBank`, rebuilding the entire screen instead of updating the visible list, which discarded local filter controls and scroll position.
- `loadTeacher()` can fetch only the first 1,000 `exercises` because of PostgREST's response cap. Mathroom's personal bank may have over 2,000 entries. Replacing the full bank with that smaller response can temporarily make recently added drafts appear missing.

## Fix
- Deleting a single task now **updates just the task list**, not the entire bank page.
- It remembers whether **Черновики** was selected and keeps that filter active.
- It merges the complete previously loaded bank with the post-delete response while excluding only the deleted exercise ID.
- The visible draft counter updates from **20 → 19**. The active state is explicit: **✓ Черновики · 19 (показаны)**.
- Search, grade and difficulty filters stay untouched.
- No database migration and no change to the actual delete query. Deleting requires the same confirmation as before.
- Errors from Supabase still prevent the UI from removing the item optimistically.

## Regression test
Run `node tests/v97-bank-draft-delete.cjs`.

The test simulates a bank with 2,012 items, of which 20 are drafts located past the first 1,000 records. After deleting one draft with a simulated truncated reload, it verifies that 19 drafts remain, the bank still contains 2,011 entries, the draft filter stays enabled and only the list is redrawn.

## Browser check
1. Open **Банк задач → Черновики**.
2. Delete **one** of the displayed drafts.
3. Verify that remaining drafts continue to appear, the count decreases by exactly 1 and the browser stays in the same list position.
4. Press the highlighted draft toggle to switch to all tasks if desired.

No actual user records were removed during automated testing. The authenticated browser experience still needs to be confirmed manually.
