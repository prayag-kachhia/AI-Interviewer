# Transcript fixtures

Hand-written mock interviews for the **Software Engineer** role, one per quality level, so the
evaluator, the benchmark, and the results screen can all test against the same material. Each
file is a JSON array of `{ "speaker": "AI" | "CANDIDATE", "text": string }` turns, alternating
interviewer questions with candidate answers.

| File | What it represents | Expected rubric scores (1–5) |
| --- | --- | --- |
| `excellent.json` | Specific, structured answers with trade-offs, metrics, and clear reasoning. | ~4.5–5.0 in every category |
| `good.json` | Solid, relevant answers that explain the approach but stop short of deep trade-offs. | ~3.5–4.5 |
| `average.json` | Adequate but thin answers; some vague or incomplete reasoning. | ~2.5–3.5 |
| `weak.json` | Very short, vague answers with little technical content. | ~1.0–2.0 |
| `empty-answers.json` | Interviewer questions with blank candidate turns; no answer to score. | N/A — the evaluator rejects it with "no candidate answers" before scoring |

The score ranges are what a reasonable rubric-based evaluator should land in; the exact numbers
depend on the model and the rubric. `empty-answers.json` exists to exercise the "nothing to
evaluate" path.
