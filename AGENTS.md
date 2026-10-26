# AGENTS.md: context for AI coding assistants

AI Interviewer: a candidate signs in, uploads a resume, picks a role, holds a spoken mock interview
with an AI interviewer, and gets written feedback. It's a student team project (IT314, DA-IICT).
The current plan, with who owns what, is in `docs/sprint-3.md`.

## Layout

- `apps/api`: Express 5 + Prisma 5 on Supabase Postgres, run with Bun.
  - `src/routes/` (URLs) → `src/controllers/` (check the input, choose the HTTP status) →
    `src/services/` (logic and database) → `prisma/schema.prisma` (tables).
  - `src/worker.ts`: the feedback job worker. It runs inside the API process.
  - `src/__tests__/`: Vitest + Supertest. Gemini is always mocked.
- `apps/web`: React 19 + Vite + react-router.
  - `src/features/<name>/`: each feature's screens. Import a feature only through its `index.ts`.
  - `src/lib/api.ts`: every HTTP call to the API.
  - `src/lib/voiceAdapter.ts`: the browser-speech voice adapter and the `VoiceSessionAdapter` interface.
  - `src/context/AuthContext.tsx`: Supabase sign-in.
- `packages/contracts`: Zod schemas shared by both apps (roles, session, turn, feedback). A change
  here affects both apps.
- `spike/`: the Gemini Live prototype. Reference only; not part of the apps.

A typical request goes: screen → `lib/api.ts` → route → controller → service → Prisma model.

## Commands

```bash
bun install
bun run dev         # API on :3000, web on :5173
bun run typecheck   # required: Bun and Vite don't check types
bun run test
bun run --filter @interview/api db:generate   # after editing schema.prisma
```

## Rules

- Stay inside the files of the feature you were asked to build. If you need to change another
  feature's files or `packages/contracts`, say so in your plan first.
- Another user's resource returns **404, not 403** (FR-27). Use `getOwnedSession(id, userId)` in
  `session.service.ts`.
- API keys (`GEMINI_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) live only in `apps/api/.env` and must
  never reach the browser or a response. Only `VITE_`-prefixed values reach the web app.
- Database changes are new Prisma migrations. Never edit a committed migration. **Never run
  `prisma migrate dev` or `prisma migrate reset` against the shared Supabase database**; create
  migrations against a local Postgres (see `docs/sprint-3.md` §6).
- Never commit `.env` files, `dist/`, `node_modules/` or database files.
- Gemini models: feedback and resume use `gemini-3.8-flash` (overridable by env); Gemini Live must
  use `gemini-3.8-live`.
- Add or update tests for what you change. Run `bun run typecheck` and `bun run test` before finishing.
- Match the surrounding code's style. Keep changes small: a PR should stay under about 300 lines.
- Commit messages use Conventional Commits, e.g. `feat(feedback): add per-role rubrics`.
