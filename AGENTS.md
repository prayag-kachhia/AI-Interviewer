# AGENTS.md: context for AI coding assistants

AI Interviewer: a candidate signs in, uploads a resume, picks a role, holds a spoken mock interview
with an AI interviewer, and gets written feedback. It's a student team project (IT314, DA-IICT).
The current plan, with who owns what, is in `docs/final-sprints.md`. How the code fits together is
in `docs/codebase-guide.md`.

## Layout

- `apps/api`: Express 5 + Prisma 7 on Supabase Postgres, run with Bun.
  - `src/routes/` (one file per resource: `auth`, `resume`, `sessions`, `feedback`, `insights`,
    `me`, `admin`; URLs, input checks, HTTP statuses) → `src/services/` (logic and database) →
    `prisma/schema.prisma` (tables).
  - `src/middleware/auth.ts`: checks the Supabase token and sets `req.user`. `adminAuth.ts` gates
    the owner dashboard (`ADMIN_EMAILS`, 404 for everyone else).
  - `src/db.ts` is the Prisma client. `src/errors.ts` holds `AppError`, `NotFoundError` and
    `getUserResourceOr404`.
  - Gemini is called only from services: `gemini.service.ts` (resume), `interviewer.service.ts`
    (next question), `evaluator.service.ts` (grading), `insights.service.ts` (improvement guide).
    `briefing.service.ts` writes the interviewer's instructions for every mode, and
    `voice-provider.service.ts` mints the Gemini Live token.
  - `src/worker.ts`: the job worker (`session.ended`, `insights.refresh`, `retention.purge`). It
    runs inside the API process; jobs are rows in the `jobs` table.
  - `src/__tests__/`: Vitest + Supertest. Gemini is always mocked.
  - `scripts/`: `evaluate.ts`, `bench.ts` (feedback quality), `latency.ts` (voice response time).
- `apps/web`: React 19 + Vite + react-router + Tailwind CSS v4.
  - `src/screens/<name>/`: one folder per screen, holding its component, hook and tests.
  - `src/components/ui/`: the shared UI primitives. Build screens from these and the theme's
    Tailwind classes; no hand-written CSS and no fixed inline styles.
  - `src/styles.css`: the three themes (Swiss, Haute, Graphite) as CSS variables.
    `src/context/ThemeContext.tsx` switches them; a script in `index.html` applies the saved theme
    before first paint, and `themeScript.test.tsx` keeps the two in step.
  - `src/lib/api.ts`: every HTTP call to the API.
  - `src/lib/voiceAdapter.ts`: the `VoiceSessionAdapter` interface and the browser-speech adapter.
  - `src/lib/geminiLiveAdapter.ts`: the Gemini Live adapter. The room connects it first and falls
    back to the browser-speech adapter if it fails.
  - `src/context/AuthContext.tsx`: Supabase sign-in.
  - `e2e/`: the Playwright golden-path test and its fake Gemini (`fake-gemini.ts`).
- `packages/contracts`: Zod schemas shared by both apps (roles, session, turn, feedback). A change
  here affects both apps.
- `spike/`: the Gemini Live prototype. Reference only; not part of the apps.

A typical request goes: screen → `lib/api.ts` → route → service → Prisma model.

## Commands

```bash
bun install
bun run dev         # API on :3000, web on :5173
bun run typecheck   # required: Bun and Vite don't check types
bun run test
bun run --filter @interview/api db:generate   # after editing schema.prisma
bun run --filter @interview/web e2e           # end-to-end test (see docs/guides/local-setup.md)
```

## Rules

- Stay inside the files of the feature you were asked to build. If you need to change another
  feature's files or `packages/contracts`, say so in your plan first.
- Another user's resource returns **404, not 403** (FR-27). Use `getOwnedSession(id, userId)` in
  `session.service.ts`, or `getUserResourceOr404` in `errors.ts`.
- API keys (`GEMINI_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) live only in `apps/api/.env` and must
  never reach the browser or a response. Only `VITE_`-prefixed values reach the web app.
- Database changes are new Prisma migrations. Never edit a committed migration. **Never run
  `prisma migrate dev` or `prisma migrate reset` against the shared Supabase database**; create
  migrations against a local Postgres (see `docs/guides/local-setup.md`).
- Never commit `.env` files, `dist/`, `node_modules/` or database files.
- Gemini models: feedback, resume, insights and the next-question endpoint use `gemini-3.8-flash`;
  Gemini Live must use `gemini-3.8-live`. Production pins them in `.github/workflows/deploy.yml`,
  whose `--set-env-vars` replaces every variable on each deploy.
- Add or update tests for what you change. Run `bun run typecheck` and `bun run test` before finishing.
- Match the surrounding code's style. Keep changes small: a PR should stay under about 300 lines.
- Commit messages use Conventional Commits, e.g. `feat(feedback): add per-role rubrics`.
