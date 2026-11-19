# Running the project locally

## What you need

- **Bun** (the version in `.bun-version`) and **Node 24** (Vitest and the Prisma CLI run on Node).
- **Docker**, only if you change the database or want to run the database tests.
- The development values for the `.env` files, from Prayag.

## First run

```bash
bun install                                    # also generates the Prisma client
cp apps/api/.env.example apps/api/.env         # fill in the values
cp apps/web/.env.example apps/web/.env.local   # fill in the values
bun run dev                                    # API on http://localhost:3000, web on http://localhost:5173
```

Open http://localhost:5173. The landing page shows; sign up with your own test account.
http://localhost:3000/health should answer `{"status":"ok"}`.

**Your local app uses the shared Supabase database.** Use your own test account, and never delete
rows that aren't yours.

## The settings

**API** (`apps/api/.env`, server-only, never committed):

| Variable | What |
|---|---|
| `PORT` | 3000 by default |
| `WEB_ORIGIN` | the web app's address, for CORS (`http://localhost:5173`) |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Supabase project; the service-role key never reaches the browser |
| `DATABASE_URL` | Postgres connection string (the shared one, or a local one; see below) |
| `GEMINI_API_KEY` | needed for voice, feedback, next questions and insights |
| `GEMINI_EVAL_MODEL`, `GEMINI_RESUME_MODEL`, `GEMINI_LIVE_MODEL`, `GEMINI_INSIGHTS_MODEL` | optional model overrides |
| `ADMIN_EMAILS` | optional: comma-separated emails that can open `/admin` |
| `WORKER` | optional: `off` stops the API running a job worker |
| `TEST_DATABASE_URL` | optional, tests only: a throwaway Postgres for the database tests |

**Web** (`apps/web/.env.local`, everything here is public):
`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_API_URL` (`http://localhost:3000/api`).

### Without a Gemini key

Sign-in, setup, history and profile work. Resume upload falls back to the rule-based parser.
Voice interviews, feedback, next questions and the improvement guide fail, because they need
Gemini.

## Checking your code

```bash
bun run typecheck   # required: Bun and Vite run code without checking types
bun run test        # every API and web test; Gemini is always mocked
```

Add tests for what you change; use the existing ones next to the code as examples.

## Changing the database

**Never run `prisma migrate dev` or `prisma migrate reset` against the shared database: it can
wipe it.** Create migrations against a throwaway local Postgres:

```bash
docker run --name interview-pg -e POSTGRES_PASSWORD=postgres -p 5432:5432 -d postgres:16
cd apps/api
# 1. edit prisma/schema.prisma, then create the migration file:
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/postgres" bunx prisma migrate dev --create-only --name add_session_length
# 2. read the generated SQL in prisma/migrations/<timestamp>_add_session_length/migration.sql
# 3. apply it locally and regenerate the client:
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/postgres" bunx prisma migrate dev
bun run db:generate
```

Commit the migration folder with your schema change. When the PR merges, the deploy applies it to
production. Prefer changes that only add columns or tables.

## The database tests

The job-queue and deletion-cascade tests need a real Postgres. Point `TEST_DATABASE_URL` at a
throwaway one with the migrations applied, then run the tests:

```bash
docker run --name interview-test-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=interview_test -p 5433:5432 -d postgres:16
export TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5433/interview_test
DATABASE_URL=$TEST_DATABASE_URL bun run --filter @interview/api db:migrate
bun run test
```

CI runs them on every PR anyway.

## The end-to-end test

It runs the whole flow in Chromium: sign in, upload a resume, a typed interview, feedback. It
needs a throwaway Postgres with the migrations applied (as above), the Supabase URL and anon
key, and a test account:

```bash
cd apps/web
npx playwright install chromium        # once
export DATABASE_URL=postgresql://postgres:postgres@localhost:5433/interview_test
export SUPABASE_URL=...  SUPABASE_ANON_KEY=...   # the VITE_ values from .env.local
export E2E_EMAIL=...  E2E_PASSWORD=...           # a test account
bun run e2e
```

It starts its own fake Gemini, API (port 3100) and web app (port 5174), so it doesn't clash with
`bun run dev`. See [ADR-0016](../adr/0016-e2e-fake-gemini.md).

## Feedback and the worker

The API runs the job worker inside itself. End an interview and the results screen polls until
the feedback is ready. If it fails, look at the `jobs` table: `lastError` holds the reason. To run
a separate worker, set `WORKER=off` on the API and run `bun run --filter @interview/api worker`.

## Becoming an admin locally

Add your confirmed email to `ADMIN_EMAILS` in `apps/api/.env`, restart the API, sign in, and open
http://localhost:5173/admin. Anyone else gets a 404 page.

## Voice

See [voice.md](voice.md#testing-it).
