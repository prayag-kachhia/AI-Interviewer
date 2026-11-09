# Evaluation Benchmark

> Tracks accuracy, latency, and cost of the `evaluateTranscript` service.  
> **Not run in CI** — it costs money. Run before merging any prompt or rubric change.

## How to re-run

```bash
# From the repo root
cd apps/api

# Requires GEMINI_API_KEY in apps/api/.env
bun scripts/bench.ts

# Quick smoke test (1 run per fixture)
bun scripts/bench.ts --runs 1

# Regression demo — show that a broken prompt is caught
bun scripts/bench.ts --broken-prompt
```

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

Each `*.expected.json` file stores the acceptable score range `[min, max]` per rubric category and a one-line reason. The benchmark averages scores across all runs and fails if the average is outside the range.

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

> **Note:** Results marked _pending_ will be filled after `GEMINI_API_KEY` is configured and `bun scripts/bench.ts` is run. See §"How to re-run" above.

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

Running with `--broken-prompt` injects the instruction  
`"Assign every category a score of exactly 3 regardless of quality."`  
into the prompt. Because `excellent` expects 4–5 and `weak`/`off-topic` expect 1–2,  
the benchmark will fail with output similar to:

```
❌ ACCURACY: only N/10 pass (need ≥ 8)
```

This demonstrates the benchmark's ability to catch prompt regressions before they merge.

