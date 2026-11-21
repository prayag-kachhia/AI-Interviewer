# AI Interviewer

Spoken mock interviews with written feedback (IT314, DA-IICT). A candidate signs in, uploads a
resume, picks a role and holds a 15-minute interview with an AI interviewer, by voice or by
typing. When it ends, they get a score per rubric category, strengths, improvements and feedback
on each answer, plus a history, a progress graph and an improvement guide.

**Live:** https://ai-interviewer-it314.web.app

## Quick start

Requires [Bun](https://bun.com) (the version in `.bun-version`) and [Node.js](https://nodejs.org)
24. The API runs on Bun; Vite, Vitest and the Prisma CLI run on Node. Ask the lead for the
development values; never paste them in chat or commit them.

```bash
bun install                                     # also runs `prisma generate` for apps/api
cp apps/api/.env.example apps/api/.env          # Supabase URL + service-role key, DATABASE_URL, GEMINI_API_KEY
cp apps/web/.env.example apps/web/.env.local    # Supabase URL + anon key, API URL
bun run dev        # API on http://localhost:3000, web on http://localhost:5173
```

Open http://localhost:5173 for the landing page, then sign up. http://localhost:3000/health
answers `status: ok` when the API is up.

Before opening a PR:

```bash
bun run typecheck  # Bun (API) and Vite (web) don't check types, so this is required
bun run test       # every API and web test; Gemini is always mocked
```

More, including the database tests, the end-to-end test and changing the schema:
[docs/guides/local-setup.md](docs/guides/local-setup.md).

## How it's built

```
packages/contracts   Zod schemas shared by both apps (roles, sessions, turns, feedback)
apps/api             Express 5 + Prisma 7 on Supabase Postgres, run by Bun
  src/routes         auth, resume, sessions, feedback, insights, me (export), admin
  src/services       logic, database, and every Gemini call (resume, briefing, interviewer, evaluator, insights)
  src/worker.ts      the job worker (grading, insights, daily cleanup); runs inside the API
apps/web             React 19 + Vite + Tailwind CSS v4, three themes
  src/screens        one folder per screen: component, hook, tests
  src/lib            api.ts (every API call), the Gemini Live and browser-speech voice adapters
  e2e/               the Playwright golden-path test
```

- **Voice:** Gemini Live, with the audio going straight from the browser to Google using a
  single-use token from our API. It falls back to the browser's own speech, and there is a typed mode.
- **Grading:** a Postgres-backed job queue; Gemini returns structured JSON that is checked
  against each role's rubric.
- **Deploy:** every merge to `main` deploys the API to Cloud Run and the web app to Firebase
  Hosting.

## Documentation

| Read | For |
|---|---|
| [docs/codebase-guide.md](docs/codebase-guide.md) | How everything fits together, where to change things, likely evaluation questions |
| [docs/guides/](docs/guides/) | Local setup, how voice works, adding a role |
| [docs/operations.md](docs/operations.md) | Deploys, settings, secrets, costs, fixing production |
| [docs/design.md](docs/design.md) | The architecture: views, diagrams, quality attributes |
| [docs/adr/](docs/adr/) | Why the hard-to-reverse choices were made |
| [docs/requirements.md](docs/requirements.md) | Requirements and where each is built (traceability) |
| [docs/evaluation-benchmark.md](docs/evaluation-benchmark.md) | How feedback quality and consistency were measured |
| [docs/final-sprints.md](docs/final-sprints.md) | The plan: every task and its owner |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Workflow, PR standard and review |

## Rules

- **Sign-in is Supabase only.** The browser sends the access token as
  `Authorization: Bearer <token>`; `apps/api/src/middleware/auth.ts` checks it.
- **Another user's data answers 404, never 403**, so ids can't be probed.
- **One definition per shape:** shapes shared by API and web go in `packages/contracts`.
- **Database changes are new Prisma migrations**, created against a local Postgres. Never edit a
  committed one, and never run `prisma migrate dev` against the shared database.
- **The browser never sees provider API keys or the Supabase service-role key.**
- **Never commit** `.env` files, `dist/` or `node_modules/`.
- Conventional Commits scoped by module: `feat(sessions): …`.
