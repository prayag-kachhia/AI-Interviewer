# ADR-0013: Postgres Job Queue for Asynchronous Tasks

- **Status:** Accepted, 8 Nov 2026
- **Context:** #112, #129, #181 (V-2)
- **Extends:** ADR-0008 (Express and Prisma for the API)

## Context

Mock interview evaluation involves calling Google Gemini (via `@google/genai`), which takes multiple seconds (up to the 12-second evaluation timeout). Executing long-running LLM inferences directly inside the synchronous HTTP request/response cycle introduces latency, risks HTTP connection timeouts, and exposes background execution to container restarts and scaling events.

A dedicated background task execution strategy is required to evaluate session feedback, extract topic insights, and clean up historical session data according to retention policies.

## The #112 and #129 History

In PR #112, an attempt was made to eliminate the PostgreSQL job queue and background worker process in favor of direct in-process asynchronous evaluation (fire-and-forget promises invoked immediately after session completion). The motivation was simplifying operations by dropping the `jobs` table, the worker loop, and related boilerplate.

However, direct evaluation suffered from several critical flaws:
1. **Unsafe across restarts and deploys:** If a Cloud Run container restarted, scaled down to zero, or crashed while an evaluation promise was executing, the evaluation was terminated abruptly. The session's feedback remained permanently stuck in `pending` status without any record or trigger to resume it.
2. **Lack of retryability:** Transient LLM rate limits (429), timeouts, or network errors could not be safely retried without custom in-memory retry mechanisms that would also be wiped out upon process exit.
3. **Loss of isolation:** Evaluating directly inside the API process tightly coupled CPU/memory consumption of LLM operations with the web server handling interactive candidate requests.

In PR #129, the architecture was rebuilt to restore and keep the Postgres job queue (`jobs` table). PR #129 kept the queue restart-safe and added failure tracking (`Feedback.error`) and a retry endpoint (`POST /api/sessions/:id/feedback/retry`).

## Decision

We retain and extend the PostgreSQL-backed job queue architecture managed through Prisma:

1. **`SELECT ... FOR UPDATE SKIP LOCKED`:**
   Workers claim pending tasks using Prisma's parameterized `$queryRaw` with `FOR UPDATE SKIP LOCKED`. This guarantees:
   - Zero duplicate job processing across concurrent workers or horizontally scaled API/worker instances.
   - Non-blocking claims without table locks or deadlock contention.
   - Seamless concurrency between the API server and dedicated worker processes (`bun run worker`).

2. **Crash Resilience and Stale Job Reclamation:**
   If a worker crashes or becomes unresponsive while processing a job, the claim transaction releases, but the job status remains `processing`. The claiming query checks for jobs with `status = 'processing'` and `lockedAt < NOW() - INTERVAL '5 minutes'`. These stale jobs are automatically reclaimed up to `MAX_ATTEMPTS` (3) times. If a job repeatedly fails or exhausts attempts, it transitions to `failed` and records `lastError`, preventing infinite loops (NFR-04).

3. **Database-Backed Simplicity:**
   PostgreSQL already serves as our primary persistent store. Using Postgres for job queuing avoids introducing separate stateful dependencies (such as Redis, RabbitMQ, SQS, or Celery), drastically simplifying local development and production deployments.

## Why Three Job Types

With the introduction of topic weaknesses and retention requirements, the queue now supports three distinct job types:

1. **`session.ended`:**
   Enqueued when an interview concludes or when a failed evaluation is retried. The worker claims the job, evaluates the stored interview transcript against role-specific rubrics using Gemini, and saves structured feedback (`summary` and `scores`).
2. **`insights.refresh`:**
   Enqueued automatically when a session's feedback reaches `ready` status. The worker processes recent transcripts and feedback across the candidate's interviews and prompts Gemini (JSON mode, Zod-validated) to map demonstrated performance to 7 core technical topics (DBMS, OOP, OS, CN, DSA, SQL, System Design). The resulting scores are persisted in the `ImprovementPlan` table for the user. Decoupling insights generation from the initial feedback evaluation ensures the candidate receives their interview feedback promptly without waiting for cross-session topic synthesis.
3. **`retention.purge`:**
   A scheduled daily background job that deletes interview recordings and transcripts older than 30 days unless explicitly marked for retention by the candidate (satisfying NFR-11 and FR-29). Because the `Job.sessionId` foreign key is optional, jobs that are not scoped to a single session can safely share the same queue table.

## Consequences

- All asynchronous processing remains durable, retryable, and resilient to application restarts.
- The `jobs` table cleanly accommodates multi-tenant and system-wide asynchronous workflows via the optional `sessionId` and JSON `payload`.
- Worker loops in `apps/api/src/worker.ts` and `apps/api/src/server.ts` dispatch claimed jobs by `job.type` to dedicated service handlers.

