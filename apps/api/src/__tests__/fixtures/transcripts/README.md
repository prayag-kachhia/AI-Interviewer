# Transcript Fixtures for Evaluator Tests

This directory contains standardized, hand-written mock interview transcript fixtures for testing and validating the transcript evaluation service (`evaluator.service.ts`).

Each fixture is a JSON array of 6–10 turns between an interviewer (`AI`) and a candidate (`CANDIDATE`), conforming to the `@interview/contracts` `TurnSpeaker` schema. Most fixtures have a matching `*.expected.json` file that names the role and gives the acceptable score range per category for the benchmark (`scripts/bench.ts`, see `docs/evaluation-benchmark.md`).

---

## Fixture Overview

| Fixture File | Role | Turn Count | Representative Quality | Primary Purpose |
| :--- | :--- | :---: | :--- | :--- |
| `excellent.json` | Software Engineer | 8 | Top-tier candidate answers | High-benchmark responses with deep architectural and complexity analysis. |
| `good.json` | Software Engineer | 8 | Competent candidate answers | Primary fixture loaded in unit tests (`evaluator.test.ts`, `evaluate-cli.test.ts`) for normal evaluation flows. |
| `average.json` | Software Engineer | 8 | Mixed / intermediate answers | Realistic partial understanding, basic approaches with missing edge cases. |
| `weak.json` | Software Engineer | 8 | Underprepared candidate answers | Surface-level answers, conceptual confusion, and minimal technical depth. |
| `empty-answers.json` | Software Engineer | 6 | Interviewer questions with blank responses | Validates the guard condition throwing `'The transcript has no candidate answers to evaluate'`. |
| `off-topic.json` | Software Engineer | 8 | Rambling, off-topic answers | Checks that answers which ignore the question score low. |
| `data-analyst-strong.json` | Data Analyst | 8 | Top-tier candidate answers | Precise SQL (window functions, deduplication) and a clear analytical method. |
| `data-analyst-weak.json` | Data Analyst | 8 | Underprepared candidate answers | Vague SQL, no window functions, no data-quality checks. |
| `backend-developer-good.json` | Backend Developer | 8 | Competent candidate answers | Cursor pagination, JWT refresh and revocation, trade-offs explained. |
| `backend-developer-average.json` | Backend Developer | 8 | Mixed / intermediate answers | Workable but shallow designs (offset pagination, basic JWT) without trade-offs. |
| `tech-stack-python.json` | Software Engineer | 8 | Top-tier candidate answers | Python stack: min-heap (heapq), asyncio queues, cyclic generational GC, pytest. |
| `tech-stack-java.json` | Software Engineer | 8 | Top-tier candidate answers | Java stack: PriorityQueue, BlockingQueue/ThreadPool, JVM GC (G1/ZGC), JUnit 5. |
| `difficulty-basic.json` | Software Engineer | 8 | Top-tier basic answers | Hash table mechanics, array vs linked list, HTTP status codes, unit testing basics. |
| `difficulty-advanced.json` | Software Engineer | 8 | Top-tier advanced answers | Distributed PN-Counter CRDTs, deadlock/data race triage, MVCC isolation anomalies, chaos engineering. |

---

## Rubric Categories

The production evaluator scores each fixture against the rubric of its role, defined in `rubrics.ts` (`getRubric(roleId)`). Each role has three categories, each scored as an integer on a **1 (poor) to 5 (excellent)** scale:
- **Software Engineer**: Problem Solving & Algorithms; Software Design & Architecture; Technical Communication.
- **Data Analyst**: SQL & Analytical Reasoning; Data Interpretation & Business Insights; Statistical Understanding & Data Quality.
- **Backend Developer**: API Design & Architecture; Database Modeling & Performance; System Reliability & Scalability.

> **Known issue:** the `*.expected.json` files still use the old shared categories (Communication, Technical depth, Structure), so their category names don't match these rubrics yet. The overall quality levels below still describe each transcript.

The "representative" ranges below are rough hand estimates of the average score. The benchmark checks the wider per-category ranges in each `*.expected.json`.

## Detailed Transcript Profiles & Expected Scores

### 1. `excellent.json`
- **Characteristics**:
  - Clear, precise technical explanations (e.g., token bucket algorithm with atomic Redis Lua scripts, composite B-tree index ordering `(user_id, created_at DESC)` in PostgreSQL, `EXPLAIN (ANALYZE, BUFFERS)`).
  - Explicit discussion of algorithmic time and space complexity ($O(1)$ operations, index seek costs).
  - Consideration of trade-offs, edge cases, fail-open strategies, and production observability.
- **Expected Representative Score Range**: **4.5 – 5.0** (primarily `5`s across all categories).

### 2. `good.json`
- **Characteristics**:
  - Answers are correct, relevant, and well-organized (e.g., asynchronous notification processing via message queues, dead-letter queues, exponential backoff with jitter, database idempotency keys).
  - Demonstrates practical engineering experience and sound problem-solving.
  - Occasional gaps in advanced edge-case exploration or deeper distributed system trade-offs compared to the excellent candidate.
- **Expected Representative Score Range**: **3.5 – 4.3** (solid `4`s across categories, occasionally `3` where depth is standard).

### 3. `average.json`
- **Characteristics**:
  - Demonstrates fundamental knowledge (e.g., knows Redis is fast, knows relational transactions lock rows, knows localStorage for anonymous carts).
  - Solutions are partially correct but lack depth (e.g., stores whole JSON strings in Redis without considering hash structures, lacks clarity on Redis persistence or race-condition locking mechanisms).
  - Misses edge cases and offers incomplete complexity reasoning.
- **Expected Representative Score Range**: **2.5 – 3.3** (predominantly `3`s, dipping to `2` on technical depth).

### 4. `weak.json`
- **Characteristics**:
  - Short, vague answers with minimal technical substance (e.g., proposing base64 images in database text columns or server disks).
  - Relies on superficial validation (file extension checks) and struggles to articulate backend security or scaling concepts.
  - Politely acknowledges lack of knowledge rather than fabricating answers.
- **Expected Representative Score Range**: **1.0 – 2.0** (`1`s and `2`s across categories).

### 5. `empty-answers.json`
- **Characteristics & Purpose**:
  - Contains valid interviewer turns followed by candidate turns that contain only empty strings (`""`) or whitespace (`"   "`, `"\t\n  "`).
  - Proves that the evaluator rejects transcripts where the candidate provided no substantive responses without invoking the LLM provider.
- **Expected Result**: **No numerical score** (the evaluator rejects with `Error: The transcript has no candidate answers to evaluate`).

### 6. Role-specific and edge-case fixtures
- **`off-topic.json`**: the candidate talks about teamwork and the internet instead of answering a URL-shortener design question. Expected **1 – 2** in every category.
- **`data-analyst-strong.json`** / **`data-analyst-weak.json`**: the same Data Analyst questions answered well (expected **4 – 5**) and poorly (expected **1 – 3**).
- **`backend-developer-good.json`** / **`backend-developer-average.json`**: the same Backend Developer questions answered well (expected **3 – 5**) and adequately (expected **2 – 4**).

### 7. Technology-Independent Scoring Fixtures (PN-8 / DR-05)
- **`tech-stack-python.json`** vs. **`tech-stack-java.json`**:
  - The exact same four Software Engineer technical interview questions (algorithmic top-K elements, asynchronous worker queue design, runtime memory management & GC, automated testing strategy).
  - One candidate responds using Python (with `heapq`, `asyncio.Queue`, reference counting & generational GC tuning, `pytest`).
  - The other candidate responds using Java (with `PriorityQueue`, `BlockingQueue` & `ThreadPoolExecutor`, JVM generational GC & G1/ZGC, `JUnit 5`).
  - Both candidates exhibit equivalent technical correctness, algorithmic depth ($O(N + U \log K)$), system architecture principles, and communication clarity.
  - Acceptance criterion (DR-05): both variants score within 1.0 point of each other across all categories. Expected: **4 – 5** in every category for both fixtures.

### 8. Difficulty-Aware Expectations Fixtures (PN-3 / DR-05)
- **`difficulty-basic.json`**:
  - Foundational Software Engineer questions (hash table lookup & collision handling, array vs linked list memory and complexity, HTTP status codes 200/400/404/500, unit testing isolation).
  - Demonstrates that a fully correct, complete basic answer earns full marks (**5 / 5** across all categories) without penalization for omitting unasked advanced optimizations or distributed-system depth.
- **`difficulty-advanced.json`**:
  - Advanced Software Engineer questions (globally consistent distributed counters via PN-Counter CRDTs, deadlock/data race triage and lock-free CAS primitives, transaction isolation anomalies & MVCC snapshot mechanics, automated chaos engineering pipeline).
  - Evaluated against deeper expectations of distributed constraints, concurrency anomalies, and trade-offs. Expected: **4 – 5** across all categories.

The exact range per category is in each fixture's `*.expected.json`.

---

## Important Testing Note: Unit Tests vs. Model Scoring

- **Deterministic Unit Tests**: In `evaluator.test.ts`, all LLM calls are mocked via the `generate` option in `evaluateTranscript()`. The unit tests do **not** invoke a live Gemini model or verify statistical score distributions. Instead, unit tests verify:
  1. JSON parsing and prompt construction (`buildEvaluationPrompt`).
  2. Input validation and contract conformity (`TurnSpeaker` schema validation) for the first five fixtures above.
  3. Pre-flight rejection of empty candidate answers (`empty-answers.json`).
  4. Failure handling (timeouts, invalid JSON, out-of-bounds scores, missing categories, unknown roles).
- **CLI Tests**: `evaluate-cli.test.ts` loads `good.json` to test the `scripts/evaluate.ts` command.
- **Representative Scoring Expectations**: The numeric ranges listed above describe the expected evaluation score profile if these transcripts are submitted to a live Gemini model with the production prompt (`bun scripts/bench.ts` or `bun scripts/evaluate.ts <file> --role <role>`). They are indicative benchmarks for transcript quality, not guaranteed constant outputs across LLM generations.
