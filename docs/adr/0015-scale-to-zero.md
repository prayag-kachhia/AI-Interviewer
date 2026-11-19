# ADR-0015: Let the API Scale to Zero, and Put Guardrails on Spend

- **Status:** Accepted, 18 Nov 2026
- **Context:** NFR-16 (cost), NFR-03 and NFR-04 (feedback), ADR-0013 (job queue)

## Context

The feedback worker runs inside the API process. Cloud Run normally pauses the CPU between
requests, which would freeze the worker, so the API was deployed with `--no-cpu-throttling --min 1`:
one instance with its CPU on, around the clock.

On 18 Nov the Google Cloud bill had reached about ₹3,000. Cloud Monitoring showed **723 billed
instance-hours in 30 days**, about 24 hours every day, while the app had about 5 interviews a day.
Gemini, the part that does the actual work, was about ₹230 of it. Almost the whole bill was an
idle server.

Two smaller leaks showed up at the same time:
- **Grading timed out on every full-length interview.** The 12-second limit, sent to Google as
  the server deadline, was too short once per-answer feedback made the output grow with every
  answer. Each failure was retried 3 times, and candidates pressed Try again, so one interview
  could be graded up to 12 times and still fail.
- **Every deploy left a ~200 MB image behind**: 98 images, about 20 GB.

## Decision

1. **Deploy with `--min 0`, keeping `--no-cpu-throttling`.** Cloud Run stops the last instance
   about 15 minutes after the last request. While an instance is up, its CPU stays on, so the
   worker keeps running between requests.
2. **The grading timeout is 60 seconds** (`EVALUATION_TIMEOUT_MS`). Feedback quality matters more
   than the 15-second target, so NFR-03 is marked Partial. A test guards the value.
3. **An Artifact Registry cleanup policy** keeps the 10 newest images, enough to roll back several
   deploys.
4. **A ₹500 monthly budget** on the billing account emails the billing admins at 50%, 90%, 100%
   and on a forecast overrun.

## Why the worker still works with no instance

- **Jobs are rows in Postgres**, not in memory, so a stopped instance loses nothing (ADR-0013).
- **Something always keeps an instance up while feedback is pending:** the Results page polls the
  API every 3 seconds.
- **A job interrupted mid-way** keeps a lock time; after 5 minutes the next instance takes it over.
- **The daily retention purge** is queued by the first instance to start each day, instead of
  exactly at midnight.

## Consequences

**Positive**
- The Cloud Run bill goes from about ₹3,000 a month to roughly what the app is actually used for.
- Full-length interviews get their feedback, and no grading call is wasted on a deadline that
  can't be met.

**Negative**
- **Cold start:** the first visitor after a quiet spell waits a few seconds.
- **Feedback for a candidate who leaves the Results page at once** waits until the next request
  wakes an instance. The job is safe in the database, but it isn't processed while nothing is
  running.
- **Long interviews take more than 15 seconds to grade.**

## Alternatives Considered

- **Keep `--min 1`.** Simplest, but about ₹3,000 a month for an app used a few times a day.
- **Request-based billing (CPU only during requests) plus Cloud Tasks or Cloud Scheduler** to call
  a "process jobs" endpoint. Cheapest at rest, but a second moving part, and the worker would
  have to fit inside a request.
- **A separate always-on worker** (Cloud Run job or a small VM). It keeps the same idle cost we
  were trying to remove.
