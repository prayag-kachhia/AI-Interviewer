# ADR-0008: Express and Prisma for the API, Vitest for tests

- **Status:** Accepted, 28 Sep 2026
- **Supersedes:** the Hono API shell (no ADR was written for it) and the recommendation to use
  Drizzle and `bun test`

## Context

The plan was a Hono API with Drizzle and `bun test`. By the Sprint 1 deadline, the Identity and
Live session teams had built one working app on Express 5, Prisma 5 and Vitest instead. It
covered Supabase sign-in, resume analysis, sessions, transcript turns, and ending a session with a
`session.ended` job. The Hono and Drizzle work in the repo was a shell of about 30 lines. Exams
start on 5 Oct.

## Decision

The Express + Prisma app becomes `apps/api` and `apps/web` in the Bun workspace (#23).
- **Express 5** is the API framework, organised as routes → controllers → services.
- **Prisma 5** owns the schema and migrations (`apps/api/prisma/`). The job queue claims work
  with raw SQL (`FOR UPDATE SKIP LOCKED`) through Prisma's parameterised `$queryRaw`.
- **Vitest** runs the tests in both apps: Supertest for the API; jsdom and Testing Library for
  the web app.

## Consequences

- The working code is kept, and its authors can still walk through it.
- Porting the Hono and Drizzle pull requests (#20, #21, #22) cost about a day.
- Shared shapes stay in `packages/contracts`. The API typechecks with bundler resolution so the
  CommonJS app can import the ESM package.
- Revisit after exams if there's a reason to. Moving to another framework means rewriting the
  routes, controllers and tests, so do it only for a concrete need.
