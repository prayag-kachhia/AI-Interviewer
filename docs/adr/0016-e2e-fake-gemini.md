# ADR-0016: End-to-End Test with a Fake Gemini Behind the SDK's Base URL

- **Status:** Accepted, 19 Nov 2026
- **Context:** P-14 (#200): prove the main flow works in a real browser, in CI, on every pull request

## Context

Unit tests mock Supabase, Prisma and Gemini, so they can't catch a break between the screens, the
API and the database: a renamed field, a route that no longer matches the web client, a screen
that never enables its button. We wanted one test that does what a candidate does: sign in,
upload a resume, run a typed interview, end it and read the feedback.

Three things make that hard in CI:
- **Gemini** is slow, costs money and gives different answers each time, so CI can't call it.
- **The database** must never be the shared Supabase one.
- **Sign-in** is Supabase Auth, which has no local copy here.

## Decision

1. **Playwright** drives Chromium against the real API and web app, started by
   `apps/web/playwright.config.ts`. One test, `e2e/golden-path.e2e.ts`, in typed mode so no
   microphone is needed.
2. **Gemini is replaced by a fake HTTP server** (`apps/web/e2e/fake-gemini.ts`), reached through
   `GOOGLE_GEMINI_BASE_URL`, an environment variable the `@google/genai` SDK already reads.
   - No production code knows the fake exists; there is no `if (test)` branch in any service.
   - Production can't use it by accident: the deploy replaces every environment variable and
     never sets this one.
   - The fake answers each kind of call (grading, insights, resume, next question) in the shape
     the real code validates. It reads the rubric categories from the request's schema and the
     questions from the transcript, so the real evaluator's checks, including the per-answer
     count, run against it unchanged.
3. **The database** is the CI job's own Postgres service, with every migration applied first.
4. **Sign-in** uses the real Supabase project, with a dedicated test account stored as the
   `E2E_EMAIL` and `E2E_PASSWORD` secrets. The API is given the public anon key, which is enough
   to verify tokens, so no service-role key enters CI.

## Consequences

**Positive**
- A PR that breaks the golden path fails CI, whichever layer it breaks.
- The real validation code runs on every PR: the contracts, the rubric checks, the per-answer
  pairing.
- No Gemini cost, and the test is repeatable.

**Negative**
- It doesn't test Gemini itself, the voice path or audio. The benchmark (`bench.ts`) and manual
  checks on the live site cover those.
- It depends on the Supabase project and the test account. If the account's password changes,
  update the `E2E_PASSWORD` secret.
- The fake must follow the real call shapes. If a service changes its schema, the fake may need
  the same change; the test failing is the signal.

## Alternatives Considered

- **A test-only flag in each service** (`if (process.env.FAKE_GEMINI)`). Simple, but it puts test
  code in production paths in four places.
- **Mocking at the network layer in the browser** (Playwright route interception). Gemini is
  called by the API, not the browser, so it can't be intercepted there.
- **A local Supabase** (Supabase CLI in Docker). Isolated, but much heavier to run in CI, and
  sign-in would no longer match production.
