# Transcript Fixtures for Evaluator Tests

This directory contains standardized, hand-written mock interview transcript fixtures for testing and validating the transcript evaluation service (`evaluator.service.ts`).

Each fixture models a realistic 6–10 turn conversation between an interviewer (`AI`) and a candidate (`CANDIDATE`) for a **Software Engineer** role, conforming to the `@interview/contracts` `TurnSpeaker` schema.

---

## Fixture Overview

| Fixture File | Turn Count | Representative Quality | Primary Purpose |
| :--- | :---: | :--- | :--- |
| `excellent.json` | 8 | Top-tier candidate answers | High-benchmark responses with deep architectural and complexity analysis. |
| `good.json` | 8 | Competent candidate answers | Primary test fixture loaded in unit tests (`evaluator.test.ts`) for normal evaluation flows. |
| `average.json` | 8 | Mixed / intermediate answers | Realistic partial understanding, basic approaches with missing edge cases. |
| `weak.json` | 8 | Underprepared candidate answers | Surface-level answers, conceptual confusion, and minimal technical depth. |
| `empty-answers.json` | 6 | Interviewer questions with blank responses | Validates the guard condition throwing `'The transcript has no candidate answers to evaluate'`. |

---

## Detailed Transcript Profiles & Expected Rubric Scores

The production evaluator uses the 3 rubric categories defined in `evaluator.service.ts`, where each score is an integer on a **1 (poor) to 5 (excellent)** scale:
1. **Communication**: Answers are clear, concise and easy to follow; the candidate explains their thinking.
2. **Technical depth**: Answers show correct, specific knowledge for the role, including trade-offs, not just definitions.
3. **Structure**: Answers are organized (context, approach, result) and stay on the question asked.

### 1. `excellent.json`
- **Characteristics**:
  - Clear, precise technical explanations (e.g., token bucket algorithm with atomic Redis Lua scripts, composite B-tree index ordering `(user_id, created_at DESC)` in PostgreSQL, `EXPLAIN (ANALYZE, BUFFERS)`).
  - Explicit discussion of algorithmic time and space complexity ($O(1)$ operations, index seek costs).
  - Consideration of trade-offs, edge cases, fail-open strategies, and production observability.
- **Expected Representative Score Range**: **4.5 – 5.0** (primarily `5`s across Communication, Technical depth, and Structure).

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

---

## Important Testing Note: Unit Tests vs. Model Scoring

- **Deterministic Unit Tests**: In `evaluator.test.ts`, all LLM calls are mocked via the `generate` option in `evaluateTranscript()`. The unit tests do **not** invoke a live Gemini model or verify statistical score distributions. Instead, unit tests verify:
  1. JSON parsing and prompt construction (`buildEvaluationPrompt`).
  2. Input validation and contract conformity (`TurnSpeaker` schema validation).
  3. Pre-flight rejection of empty candidate answers (`empty-answers.json`).
  4. Failure handling (timeouts, invalid JSON, out-of-bounds scores).
- **Representative Scoring Expectations**: The numeric ranges listed above describe the expected evaluation score profile if these transcripts are submitted to a live Gemini model with the production prompt. They are indicative benchmarks for transcript quality, not guaranteed constant outputs across LLM generations.
