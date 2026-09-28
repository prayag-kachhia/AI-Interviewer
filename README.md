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
bun run test       # Vitest (API)
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
packages/contracts   @interview/contracts — Zod schemas + inferred types (Role so far)
apps/api             Express 5 + Prisma 5 on Supabase Postgres, run by Bun; tests with Vitest + Supertest
  src/routes         /api/auth, /api/resume, /api/sessions → src/controllers → src/services
  src/middleware     auth.ts validates the Supabase access token and links it to a users row
  prisma/            schema.prisma and the committed migrations
apps/web             React 19 + Vite + react-router
  src/lib            supabase.ts (sign-in only), api.ts (every API call; attaches the token)
  src/pages, src/features/{sessions,feedback,identity,profile}
```

## Rules

Full workflow, PR standard and review process: [CONTRIBUTING.md](CONTRIBUTING.md).
Current sprint, tasks and deadlines: [docs/sprint-1.md](docs/sprint-1.md).

- **Sign-in is Supabase only.** The browser signs in with Supabase and sends the access token as
  `Authorization: Bearer <token>`; `apps/api/src/middleware/auth.ts` validates it. There is no other
  login or token.
- **Web: import a feature only through its `index.ts`** (`apps/web/src/features/<name>/index.ts`).
- **Dependency direction:** `identity ← profile ← sessions ← feedback`. `sessions` never imports
  `feedback`; ending a session inserts a `session.ended` job instead.
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
- Supabase sign-in and the token check
- Prisma schema and migrations
- resume upload and analysis
- creating a session
- the live interview screen, with transcript turns and ending the session
- the provider voice-token endpoint (LS3)
- the job queue and feedback worker (FB2, FB3)
- the LLM evaluator with a generic rubric (FB4)
- the results screen (FB1)
- shared contracts
- CI on every PR

The live screen uses the browser's built-in speech recognition and synthesis until the Gemini
Live adapter is wired to the voice token.

Not yet done: the browser-side Gemini Live adapter; a protected `main` (needs GitHub Pro or a public repo); CODEOWNERS; a lint gate with the import rule,
and Prettier.
