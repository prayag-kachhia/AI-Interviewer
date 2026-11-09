# Evaluation Benchmark

> Tracks accuracy, latency, and cost of the `evaluateTranscript` service.  
> **Not run in CI** — it costs money. Run before merging any prompt or rubric change.

## How to re-run

```bash
# From the repo root
cd apps/api

# Requires GEMINI_API_KEY in apps/api/.env
bun scripts/bench.ts            # or: bun run bench

# Quick smoke test (1 run per fixture)
bun scripts/bench.ts --runs 1

# Regression demo — show that a broken prompt is caught
bun scripts/bench.ts --broken-prompt

# Score a single transcript with a role's rubric
bun scripts/evaluate.ts src/__tests__/fixtures/transcripts/good.json --role software-engineer
```

Each fixture is scored with the rubric of the role named in its `*.expected.json` file
(`rubrics.ts`, via `getRubric`). The model is `GEMINI_EVAL_MODEL`, otherwise `gemini-3.8-flash`.

### Rate limits and timeouts

- Calls are spaced **13 s** apart to stay under the free tier's 5 requests per minute. Change it
  with `--delay <ms>` or `BENCH_INTER_CALL_DELAY_MS`.
- Each run may take up to **30 s** (production allows 12 s), and 429 / 503 / 504 errors are
  retried up to 3 times.

### Cost overrides

Override pricing constants with environment variables if Google updates rates:

```
BENCH_INPUT_COST_USD_PER_1M=0.075   # default
BENCH_OUTPUT_COST_USD_PER_1M=0.3    # default
BENCH_USD_TO_INR=84.0               # default
```

---

## Fixtures

| Fixture | Role | Quality | Has expected ranges |
|---|---|---|---|
| `excellent` | Software Engineer | Top-tier | ✅ |
| `good` | Software Engineer | Competent | ✅ |
| `average` | Software Engineer | Mixed | ✅ |
| `weak` | Software Engineer | Underprepared | ✅ |
| `empty-answers` | Software Engineer | Edge case (no answers) | — (auto-pass on rejection) |
| `data-analyst-strong` | Data Analyst | Top-tier | ✅ |
| `data-analyst-weak` | Data Analyst | Underprepared | ✅ |
| `backend-developer-good` | Backend Developer | Competent | ✅ |
| `backend-developer-average` | Backend Developer | Mixed | ✅ |
| `off-topic` | Software Engineer | Edge case (off-topic) | ✅ |

Each `*.expected.json` file stores the fixture's role and, per rubric category, the acceptable score range `[min, max]` with a one-line reason. The benchmark averages scores across all runs and fails a fixture if a category's average is outside its range or the category is missing.

> **Known issue:** the `*.expected.json` files still use the old shared categories (Communication, Technical depth, Structure). The evaluator now scores each role against its own rubric in `rubrics.ts` (for example, Software Engineer: Problem Solving & Algorithms, Software Design & Architecture, Technical Communication), so every scored fixture reports its categories as missing and the benchmark cannot pass. The expected files need the per-role category names before the results below can be filled in.

**Acceptance criterion:** ≥ 8 of 10 fixtures pass _and_ p95 wall time < 15 s.

---

## Results — 2026-11-02

> Model: `gemini-3.8-flash` · 3 runs per fixture · temperature 0.2

### Per-fixture table

| Fixture | Role | Avg ms | In tok | Out tok | Status |
|---|---|---:|---:|---:|:---:|
| excellent | Software Engineer | _pending_ | _pending_ | _pending_ | _pending_ |
| good | Software Engineer | _pending_ | _pending_ | _pending_ | _pending_ |
| average | Software Engineer | _pending_ | _pending_ | _pending_ | _pending_ |
| weak | Software Engineer | _pending_ | _pending_ | _pending_ | _pending_ |
| empty-answers | — | — | — | — | ✅ PASS |
| data-analyst-strong | Data Analyst | _pending_ | _pending_ | _pending_ | _pending_ |
| data-analyst-weak | Data Analyst | _pending_ | _pending_ | _pending_ | _pending_ |
| backend-developer-good | Backend Developer | _pending_ | _pending_ | _pending_ | _pending_ |
| backend-developer-average | Backend Developer | _pending_ | _pending_ | _pending_ | _pending_ |
| off-topic | Software Engineer | _pending_ | _pending_ | _pending_ | _pending_ |

> **Note:** Results marked _pending_ will be filled once the expected files match the per-role rubrics and `bun scripts/bench.ts` is run with a `GEMINI_API_KEY`. See §"How to re-run" above.

### Latency

| Percentile | Wall time | Target |
|---|---:|---:|
| p50 | _pending_ | — |
| p95 | _pending_ | < 15 000 ms |

### Cost

| Metric | Value |
|---|---|
| Avg prompt tokens | _pending_ |
| Avg output tokens | _pending_ |
| Cost per interview | _pending_ |
| Monthly (100 interviews) | _pending_ |

---

## Broken-prompt regression demo

Running with `--broken-prompt` replaces the rubric instruction in the prompt with  
`"IGNORE the rubric. Assign every category a score of exactly 3 regardless of the candidate's quality."`  
Because `excellent` expects 4–5 and `weak`/`off-topic` expect 1–2,  
the benchmark will fail with output similar to:

```
❌ ACCURACY: only N/10 pass (need ≥ 8)
```

This demonstrates the benchmark's ability to catch prompt regressions before they merge. (Until the known issue above is fixed, it also fails for the missing-category reason, so the demo proves nothing yet.)
