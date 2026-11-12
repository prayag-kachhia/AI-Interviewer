# Transcript Fixtures for Evaluator Tests

This directory contains standardized, hand-written mock interview transcript fixtures for testing and validating the transcript evaluation service (`evaluator.service.ts`).

Each fixture is a JSON array of 6–10 turns between an interviewer (`AI`) and a candidate (`CANDIDATE`), conforming to the `@interview/contracts` `TurnSpeaker` schema. Most fixtures have a matching `*.expected.json` file that names the role and gives the acceptable score range per category for the benchmark (`scripts/bench.ts`, see `docs/evaluation-benchmark.md`).

---

## Fixture Overview

The directory contains 27 transcript fixtures: 26 scored fixtures with matching expected-score files, plus `empty-answers.json`, which tests rejection of transcripts without candidate answers.

| Fixture File | Role | Difficulty | Turn Count | Representative Quality | Primary Purpose |
| :--- | :--- | :---: | :---: | :--- | :--- |
| `excellent.json` | Software Engineer | Advanced | 8 | Top-tier | Deep architectural and complexity analysis. |
| `good.json` | Software Engineer | Intermediate | 8 | Competent | Standard evaluation and normal interview flow. |
| `average.json` | Software Engineer | Intermediate | 8 | Mixed | Partial understanding and missing edge cases. |
| `weak.json` | Software Engineer | Basic | 8 | Underprepared | Surface-level answers and conceptual confusion. |
| `empty-answers.json` | Software Engineer | Basic | 6 | No candidate answers | Validates rejection of transcripts without candidate answers; no expected-score file. |
| `off-topic.json` | Software Engineer | Intermediate | 8 | Off-topic | Checks that irrelevant answers receive low scores. |
| `data-analyst-strong.json` | Data Analyst | Advanced | 8 | Top-tier | SQL window functions, deduplication, and analytical reasoning. |
| `data-analyst-weak.json` | Data Analyst | Basic | 8 | Underprepared | Vague SQL and missing data-quality checks. |
| `backend-developer-good.json` | Backend Developer | Advanced | 8 | Competent | Cursor pagination, JWT refresh/revocation, and trade-offs. |
| `backend-developer-average.json` | Backend Developer | Intermediate | 8 | Mixed | Workable but shallow backend designs. |
| `tech-stack-python.json` | Software Engineer | Advanced | 8 | Top-tier | Python implementation parity (PN-8). |
| `tech-stack-java.json` | Software Engineer | Advanced | 8 | Top-tier | Java implementation parity (PN-8). |
| `filler-heavy-correct.json` | Software Engineer | Intermediate | 8 | Competent, disfluent | Speech fillers should affect communication, not technical scores. |
| `filler-heavy-data-analyst.json` | Data Analyst | Intermediate | 8 | Competent, disfluent | Tests score separation for SQL and data-quality reasoning. |
| `difficulty-basic.json` | Software Engineer | Basic | 8 | Strong basic answers | Foundational algorithms, HTTP, and testing knowledge (PN-3). |
| `difficulty-advanced.json` | Software Engineer | Advanced | 8 | Strong advanced answers | Distributed systems, concurrency, and database reasoning (PN-3). |
| `concise-correct.json` | Software Engineer | Intermediate | 8 | Concise and accurate | Ensures concise answers are not penalized (S-6 / NFR-19). |
| `long-vague.json` | Software Engineer | Intermediate | 8 | Verbose and vague | Ensures verbosity does not inflate scores (S-6 / NFR-19). |
| `se-basic.json` | Software Engineer | Basic | 8 | Solid foundational answers | Recursion, binary search, modularity, and debugging (PN-4). |
| `se-intermediate.json` | Software Engineer | Intermediate | 8 | Practical trade-off answers | Algorithms, caching, concurrency, and testing (PN-4). |
| `se-advanced.json` | Software Engineer | Advanced | 8 | Production systems answers | Distributed rate limiting, consistent hashing, Saga, and latency (PN-4). |
| `da-basic.json` | Data Analyst | Basic | 8 | Foundational analytics answers | SQL joins, duplicates, NULLs, and distribution metrics (PN-4). |
| `da-intermediate.json` | Data Analyst | Intermediate | 8 | Practical analyst answers | Window functions, rolling averages, funnels, and cohorts (PN-4). |
| `da-advanced.json` | Data Analyst | Advanced | 8 | Rigorous statistical answers | Experiment design, sequential tests, CUPED, and data modeling (PN-4). |
| `backend-basic.json` | Backend Developer | Basic | 8 | Foundational backend answers | HTTP, idempotency, schema normalization, and connection pooling (PN-4). |
| `backend-intermediate.json` | Backend Developer | Intermediate | 8 | Practical backend engineering | Pagination, indexing, caching, and worker queues (PN-4). |
| `backend-advanced.json` | Backend Developer | Advanced | 8 | High-concurrency architecture | Distributed idempotency, PostgreSQL isolation, resilience, and migrations (PN-4). |

---
## Rubric Categories

The production evaluator scores each fixture against the rubric of its role, defined in `rubrics.ts` (`getRubric(roleId)`). Each role has three calibrated categories, each scored as an integer on a **1 (poor) to 5 (excellent)** scale:
- **Software Engineer**: Problem Solving & Algorithms; Software Design & Architecture; Technical Communication.
- **Data Analyst**: SQL & Analytical Reasoning; Data Interpretation & Business Insights; Statistical Understanding & Data Quality.
- **Backend Developer**: API Design & Architecture; Database Modeling & Performance; System Reliability & Scalability.

The benchmark (`scripts/bench.ts`) compares evaluated averages against the per-category `[min, max]` ranges specified in each fixture's matching `*.expected.json`.

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

### 8. Score Separation Fixtures (S-5 / FR-21 / NFR-19)
- **`filler-heavy-correct.json`**:
  - Role: Software Engineer.
  - Characteristics: Validates that pauses, speech fillers ("um", "uh", "like", "you know"), repetition, and verbal hesitation affect Communication only, never technical scores. The candidate describes an asynchronous notification service with message queues, exponential backoff with jitter, dead-letter queues, PostgreSQL idempotency keys, and Testcontainers integration tests with heavy disfluencies.
  - Expected ranges: Problem Solving & Algorithms (3–5), Software Design & Architecture (3–5), Technical Communication (1–3).
- **`filler-heavy-data-analyst.json`**:
  - Role: Data Analyst.
  - Characteristics: The candidate details SQL rolling 7-day average using CTE and `ROWS BETWEEN 6 PRECEDING AND CURRENT ROW`, deduplication via `ROW_NUMBER()` and `LAG`, structured metric decomposition (orders × AOV), multidimensional segmentation, and layered pipeline validation, spoken with frequent hesitation and fillers.
  - Expected ranges: SQL & Analytical Reasoning (4–5), Data Interpretation & Business Insights (4–5), Statistical Understanding & Data Quality (4–5). All three categories are technical/analytical; speech fillers and hesitation must never penalize technical depth or business interpretation.
### 9. Difficulty-Aware Expectations Fixtures (PN-3 / DR-05)
- **`difficulty-basic.json`**:
  - Foundational Software Engineer questions (hash table lookup & collision handling, array vs linked list memory and complexity, HTTP status codes 200/400/404/500, unit testing isolation).
  - Demonstrates that a fully correct, complete basic answer earns full marks (**5 / 5** across all categories) without penalization for omitting unasked advanced optimizations or distributed-system depth.
- **`difficulty-advanced.json`**:
  - Advanced Software Engineer questions (globally consistent distributed counters via PN-Counter CRDTs, deadlock/data race triage and lock-free CAS primitives, transaction isolation anomalies & MVCC snapshot mechanics, automated chaos engineering pipeline).
  - Evaluated against deeper expectations of distributed constraints, concurrency anomalies, and trade-offs. Expected: **4 – 5** across all categories.

### 10. Concise vs. Verbose Answers Fixtures (S-6 / NFR-19)
- **`concise-correct.json`**:
  - Four Software Engineer technical interview questions (in-memory LRU cache, financial API idempotency, optimistic vs pessimistic locking, external API testing).
  - The candidate gives concise, dense, technically complete answers (hash map + doubly linked list with O(1) ops, UUID idempotency keys + unique DB constraint, version checks vs SELECT FOR UPDATE, MSW/nock/WireMock mocking).
  - Expected ranges: Problem Solving & Algorithms (4–5), Software Design & Architecture (4–5), Technical Communication (4–5).
- **`long-vague.json`**:
  - The exact same four Software Engineer technical interview questions.
  - The candidate responds with lengthy (~2.5x word count), conversational, rambling answers that repeat truisms, omit crucial mechanisms, and propose flawed patterns (linear timestamp scanning, frontend-only button disabling, manual Postman tests).
  - Expected ranges: Problem Solving & Algorithms (1–3), Software Design & Architecture (1–3), Technical Communication (1–3).
  - Acceptance criteria (S-6):
    - Overall score parity: concise answers score at least as well as long vague answers (`conciseAvg >= longVagueAvg`).
    - Technical score parity: concise answers match or exceed long vague answers in non-communication technical categories (`conciseTechnicalAvg >= longVagueTechnicalAvg`).
    - Technical quality threshold: concise answers achieve a high technical average (`conciseTechnicalAvg >= 3.50 / 5.00`).
### 11. Cross-Role Validation Test Set Fixtures (PN-4 / DR-05)

#### Software Engineer
- **`se-basic.json`** (Basic): Recursion vs iteration stack frame mechanics, binary search O(log N) divide-and-conquer, DRY & Single Responsibility modularity, systematic debugging. Expected: **4 – 5** across categories.
- **`se-intermediate.json`** (Intermediate): Two Sum algorithmic trade-offs (brute force vs sorted two-pointer vs hash map), thread-safe LRU cache with Doubly Linked List and Hash Map, optimistic vs pessimistic locking, automated test pyramid. Expected: **4 – 5** across categories.
- **`se-advanced.json`** (Advanced): Multi-tier decentralized rate limiting with fail-open fallback, consistent hashing rings with virtual nodes, Saga pattern with transactional outbox, p99 tail latency triage and CFS quota throttling. Expected: **4 – 5** across categories.

#### Data Analyst
- **`da-basic.json`** (Basic): SQL join mechanics (INNER/LEFT/FULL OUTER), WHERE vs HAVING execution order, duplicate and NULL identification/imputation, mean vs median in skewed distributions for non-technical stakeholders. Expected: **4 – 5** across categories.
- **`da-intermediate.json`** (Intermediate): MoM growth with LAG, 7-day rolling average with explicit ROWS BETWEEN framing, 3-dimensional conversion funnel decomposition, cohort retention matrix, pipeline validation invariants. Expected: **4 – 5** across categories.
- **`da-advanced.json`** (Advanced): A/B test power sizing, sequential testing with alpha-spending, CUPED variance reduction, Simpson's Paradox resolution, Kimball dimensional modeling (fact/snapshot/SCD2), DAU vs MRR divergence analysis. Expected: **4 – 5** across categories.

#### Backend Developer
- **`backend-basic.json`** (Basic): Standard HTTP verbs and idempotency rules, normalized relational blog schema with foreign keys, Argon2id/bcrypt work factors, connection pooling reuse preventing thread exhaustion. Expected: **4 – 5** across categories.
- **`backend-intermediate.json`** (Intermediate): Keyset/cursor-based pagination preventing O(N) degradation, B-Tree leftmost prefix composite indexing, Cache-Aside with stampede and penetration defenses, asynchronous queues with DLQs. Expected: **4 – 5** across categories.
- **`backend-advanced.json`** (Advanced): Idempotent payment processing protocol, PostgreSQL transaction isolation levels (SSI vs write skew), circuit breakers with bulkheads, zero-downtime expand-contract schema migrations with lock_timeout. Expected: **4 – 5** across categories.

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
