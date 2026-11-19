# Mathroom v99 — deterministic mathematics verification for PDF tasks

Date: 2026-11-19

## What is new

A fully local `MathroomMathCheckV99` arithmetic engine now checks answers for a deliberately narrow, verifiable subset of school mathematics:

- Directly stated arithmetic expressions, including parentheses, fractions written as `/`, simple integer powers, negative numbers, implicit multiplication and decimal commas.
- Equations introduced with «Решите уравнение…» or «Найдите корень уравнения…» when the equation contains exactly one variable `x` and is demonstrably linear.
- It compares the expected numeric value with a teacher-entered answer and classifies it as `match`, `mismatch`, `missing` or `unsupported`.
- When the answer is missing, it offers a computed value **without auto-populating or publishing** the problem.

## Safety / scope limitations

The checker has no `eval`, arbitrary JS execution, external API calls, or unrestricted mathematical parser. It tokenizes a strict set of characters and computes only supported operators. It refuses nonlinear equations, divisions by zero, complex symbols, equations with non-unique solutions, multi-answer text and problems with graphical source material. Complex geometry, probability, trigonometry, OCR extraction and symbolic equivalence are **not supported**.

**A positive answer match does not prove the task was extracted correctly**: the teacher must still compare it with the original PDF and validate mathematical assumptions and any illustrations.

## PDF importer

- Cards now show a separate Mathroom arithmetic status: **match / mismatch / missing answer / unsupported**.
- Edits to either the answer or the condition update the status immediately.
- `builder_meta.pdf_import.math_check` records the computed result and algorithm version when saving a private draft.
- Mathematical mismatches **do not block saving a private draft**. The teacher can correct them in the Task Builder before publication.

## Task Builder

- The existing **Проверить задачу** audit now includes an independent calculation check for standard/numeric tasks that have exactly one answer and no images, tables, geometry or templates.
- A conflicting answer is a **critical error** that blocks publication until corrected. Missing or unsupported checks do not claim verification; existing mandatory-answer validation still applies.
- After saving or promoting an imported PDF draft, its local calculation status is updated in source metadata.

## Tests

```sh
node tests/v99-math-check.cjs
node tests/v98-pdf-duplicates.cjs
node tests/v95-pdf-review.cjs
node tests/v94-pdf-draft-save.cjs
```

The v99 test covers arithmetic precedence, unary minus, decimal fractions, unique linear roots, unsupported nonlinear/unbounded expressions, zero division, large-number rounding, malicious text rejection and a mocked PDF review that updates the displayed status when the answer is edited.

## Manual verification

1. In Mathroom → **Банк задач → Импорт PDF**, import a page containing `Решите уравнение: 3(2x − 1) = 4x + 9.`.
2. With empty answer, observe **Расчёт выполнен, ответа пока нет** and the suggestion `6`.
3. Enter `5`; observe the disagreement warning. Enter `6`; observe a calculated match.
4. Save as a private draft, open in **Конструктор задач** and deliberately change the answer to `5`.
5. Click **Проверить задачу** and verify the error blocks publishing, while **Сохранить в черновики** still works.
6. Try a quadratic equation and a problem containing a diagram; neither should receive a green mathematical verification claim.

No Supabase schema, RLS, scheduled jobs, paid model calls, or existing exercises were modified in this release. Tests passed at source/mock level; live user-session verification is still required.
