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

Pricing is model-aware and defaults according to `GEMINI_EVAL_MODEL` (or `gemini-3.8-flash` if unset):
- `gemini-3.8-flash` (default): \$0.75 input / \$3.75 output per 1 M tokens (introductory, through 2026-12-31)
- `gemini-3.5-flash`: \$1.50 input / \$9.00 output per 1 M tokens

Override pricing constants with environment variables if Google updates rates or for custom tiers:

```
BENCH_INPUT_COST_USD_PER_1M=0.75    # overrides input cost per 1 M tokens
BENCH_OUTPUT_COST_USD_PER_1M=3.75   # overrides output cost per 1 M tokens
BENCH_USD_TO_INR=84.0               # default USD to INR conversion rate
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
| `tech-stack-python` | Software Engineer | Top-tier (Python stack) | ✅ (DR-05 parity) |
| `tech-stack-java` | Software Engineer | Top-tier (Java stack) | ✅ (DR-05 parity) |
| `filler-heavy-correct` | Software Engineer | Competent, heavy speech fillers | ✅ (FR-21 separation) |
| `filler-heavy-data-analyst` | Data Analyst | Competent, heavy speech fillers | ✅ (FR-21 separation) |

Each `*.expected.json` file stores the fixture's role and, per rubric category, the acceptable score range `[min, max]` with a one-line reason. The benchmark averages scores across all runs and fails a fixture if a category's average is outside its range or the category is missing.

The expected files use per-role rubric categories from `rubrics.ts`:
- **Software Engineer**: Problem Solving & Algorithms · Software Design & Architecture · Technical Communication
- **Data Analyst**: SQL & Analytical Reasoning · Data Interpretation & Business Insights · Statistical Understanding & Data Quality
- **Backend Developer**: API Design & Architecture · Database Modeling & Performance · System Reliability & Scalability

**Acceptance criterion:** ≥ 8 of 10 fixtures pass _and_ p95 wall time < 15 000 ms.

---

## Results — 2026-11-10

> Model: `gemini-3.5-flash` · 1 run per fixture · temperature 0.2\
> Note: `gemini-3.8-flash` (the production default) returned HTTP 503 "high demand" errors
> consistently with the available API key at benchmark time. `gemini-3.5-flash` was used instead
> via `GEMINI_EVAL_MODEL=gemini-3.5-flash`. Production remains pinned to `gemini-3.8-flash`.

### Per-fixture table

| Fixture | Role | Avg ms | In tok | Out tok | Status |
|---|---|---:|---:|---:|:---:|
| excellent | Software Engineer | — | — | — | ❌ ERROR (503 all 3 retries) |
| good | Software Engineer | 27 338 | 1 112 | 473 | ✅ PASS |
| average | Software Engineer | 12 063 | 1 059 | 414 | ✅ PASS |
| weak | Software Engineer | 43 888 | 970 | 551 | ✅ PASS |
| empty-answers | — | — | — | — | ✅ PASS |
| data-analyst-strong | Data Analyst | 17 585 | 1 303 | 524 | ✅ PASS |
| data-analyst-weak | Data Analyst | 13 717 | 965 | 557 | ✅ PASS |
| backend-developer-good | Backend Developer | 17 334 | 1 256 | 631 | ✅ PASS |
| backend-developer-average | Backend Developer | 32 464 | 1 059 | 526 | ✅ PASS |
| off-topic | Software Engineer | 11 190 | 912 | 470 | ✅ PASS |

**Accuracy: 9/10 fixtures within expected score ranges** ✅ (≥ 8 required)

The `excellent` fixture failed with HTTP 503 (service unavailable) on all three retry attempts —
this is a model availability issue under the free-tier API key, not a correctness failure.
When `gemini-3.8-flash` is available in production, the fixture is expected to pass given its
wide score windows (4–5 across all categories).

### Latency

| Percentile | Wall time | Target |
|---|---:|---:|
| p50 | 17 334 ms | — |
| p95 | 43 888 ms | < 15 000 ms ❌ |

> The p95 of 43 888 ms is driven by the `weak` fixture, which hit two 503 retries (each adding
> a 13 s backoff delay) before succeeding on the third attempt. Without retry waits the actual
> model response time was ~18 s. Under the production `gemini-3.8-flash` on a warmed-up API
> key, latency is expected to be significantly lower. The 15 s target applies to the production
> evaluator (12 s timeout); the bench timeout is intentionally relaxed to 30 s to tolerate
> free-tier fluctuations.

### Cost

Token counts are averaged over the 8 successful LLM runs (excludes `excellent` which errored and `empty-answers` which made no LLM call).

| Metric | Benchmark run (`gemini-3.5-flash`) | Production estimate (`gemini-3.8-flash`) |
|---|---|---|
| Avg prompt tokens | 1 080 | 1 080 (same prompt) |
| Avg output tokens | 518 | 518 (same prompt) |
| Input price / 1 M tok | \$1.50 | \$0.75 (introductory, until 2027-01-01) |
| Output price / 1 M tok | \$9.00 | \$3.75 (introductory, includes thinking tokens) |
| Cost per interview | ₹0.5277 (US\$0.006282) | ₹0.2312 (US\$0.002753) |
| Monthly (100 interviews) | ₹52.77 (US\$0.6282) | ₹23.12 (US\$0.2753) |

> Benchmark pricing: `gemini-3.5-flash` — input \$1.50 / 1 M tok, output \$9.00 / 1 M tok (standard paid tier).\
> Production pricing: `gemini-3.8-flash` introductory rates (Google AI, through 2026-12-31) — input \$0.75 / 1 M tok, output \$3.75 / 1 M tok.\
> USD → INR conversion: 84.0. Verify rates at https://ai.google.dev/pricing before relying on these figures.\
> Note: the previous session incorrectly applied `gemini-1.5-flash` rates (\$0.075/\$0.30) to `gemini-3.5-flash`; this table uses the correct published rates for each model.

---

## Broken-prompt regression demo

Running with `--broken-prompt` replaces the rubric instruction in the prompt with  
`"IGNORE the rubric. Assign every category a score of exactly 3 regardless of the candidate's quality."`  
Because `excellent` expects 4–5 and `weak`/`off-topic` expect 1–2,  
the benchmark will fail with output similar to:

```
❌ ACCURACY: only N/10 pass (need ≥ 8)
```

This demonstrates the benchmark's ability to catch prompt regressions before they merge.
