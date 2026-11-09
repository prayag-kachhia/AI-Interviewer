# AI-Interviewer

AI interview practice platform (IT314, DA-IICT). Bun workspace monorepo, TypeScript end to end.

## Setup

Requires [Bun](https://bun.com) 1.4 or later and [Node.js](https://nodejs.org) 22 LTS. The API runs
on Bun; Vite, Vitest and the Prisma CLI run on Node. You also need the team Supabase project's URL
and keys: ask the lead, and never paste them in chat or commit them.

```bash
bun install                                     # also runs `prisma generate` for apps/api
cp apps/api/.env.example apps/api/.env          # Supabase URL + service-role key, DATABASE_URL, GEMINI_API_KEY
cp apps/web/.env.example apps/web/.env.local    # Supabase URL + anon (publishable) key
bun run dev        # API on http://localhost:3000, web on http://localhost:5173
```

Replace every placeholder in both files. The API does not start without `SUPABASE_URL`, and the web
app shows a blank page without `VITE_SUPABASE_URL`.

Open http://localhost:5173. You should land on the sign-in screen. Sign in or sign up with Supabase,
then pick a role to start an interview. http://localhost:3000/health answers `status: ok` when the
API is up.

Before opening a PR:

```bash
bun run typecheck  # Bun (API) and Vite (web) don't check types, so this is required
bun run test       # Vitest (API and web)
```

After changing `apps/api/prisma/schema.prisma`, run `bun run --filter @interview/api db:generate`.
`bun run --filter @interview/api db:migrate` applies the committed migrations (`prisma migrate deploy`).

## Environment

- `apps/api/.env` holds server-only secrets. `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL` and
  `GEMINI_API_KEY` must never reach the browser.
- `apps/web/.env.local`: only `VITE_`-prefixed variables reach the browser. It holds the Supabase URL,
  the anon (publishable) key and `VITE_API_URL` (default `http://localhost:3000/api`), nothing secret.
- Only the `.env.example` files are committed.

## Layout

```
packages/contracts   @interview/contracts — Zod schemas + inferred types (roles, sessions, turns, feedback)
apps/api             Express 5 + Prisma 7 on Supabase Postgres, run by Bun; tests with Vitest + Supertest
  src/routes         one file per resource: /api/auth, /api/resume, /api/sessions (feedback too) → src/services
  src/services       logic, database and the Gemini calls (resume, briefing, evaluator, interviewer)
  src/worker.ts      the feedback job worker; runs inside the API process
  src/middleware     auth.ts validates the Supabase access token and links it to a users row
  prisma/            schema.prisma and the committed migrations
apps/web             React 19 + Vite + react-router
  src/lib            supabase.ts (sign-in only), api.ts (every API call; attaches the token), voice adapters
  src/screens        one folder per screen: the component, its hook and its tests
```

## Rules

Full workflow, PR standard and review process: [CONTRIBUTING.md](CONTRIBUTING.md).
New to the code? Read [docs/codebase-guide.md](docs/codebase-guide.md) first.
Current plan, tasks and owners: [docs/final-sprints.md](docs/final-sprints.md). Requirements and where each is built: [docs/requirements.md](docs/requirements.md).

- **Sign-in is Supabase only.** The browser signs in with Supabase and sends the access token as
  `Authorization: Bearer <token>`; `apps/api/src/middleware/auth.ts` validates it. There is no other
  login or token.
- **One definition per shape.** New request/response shapes shared by API and web go in
  `packages/contracts`. Don't add a second copy of a shape that already exists in
  `apps/api/src/types` or `apps/web/src/types`. Change a contract in the same PR as the code that needs it.
- **Database changes are new Prisma migrations** in `apps/api/prisma/migrations`. Never edit a
  committed migration.
- **The browser never sees provider API keys or the Supabase service-role key**, and never queries
  Supabase tables directly.
- **Never commit** `.env` files, `*.db`, `dist/` or `node_modules/`.
- Mark placeholder code `STUB` with the owning slice named.
- Conventional Commits scoped by module: `feat(sessions): …`.

## Status

Done:
- Supabase sign-in (email and Google), the token check and account deletion
- resume upload and analysis
- resume-aware interview sessions, with a history list and deleting an interview
- the live interview screen, with transcript turns and ending the session
- the interviewer briefing: role, resume, three timed phases and guardrails, locked into the voice token
- the server-side next-question endpoint for typed mode
- the job queue and feedback worker, with per-role rubrics, structured output and a retry for failed feedback
- the results screen: scores, strengths, improvements, a quote per category, and the transcript
- the Gemini Live adapter, with session resumption
- shared contracts, and CI and deploy on every PR and merge

The live screen still uses the browser's built-in speech recognition and synthesis; wiring the
Gemini Live adapter into the room is planned (VI-8).

Not yet done: past questions in the briefing, the interview countdown and the reconnect banner (open
PRs); a protected `main`; CODEOWNERS; a lint gate and Prettier.
