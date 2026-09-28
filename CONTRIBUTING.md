# Contributing

How we work on this repo. Setup and layout are in the [README](README.md).

The short version: **you own every line you submit.** Use whatever tools you like, including
AI assistants, but if you can't explain your change, it doesn't get merged.

## Before you start

1. **Have a task with your name on it.** Every task is a GitHub issue made from the Task
   template, assigned to one person, with a milestone that sets its deadline. If there isn't
   one, ask the lead.
2. **Read the story's acceptance criteria.** Whoever creates the task (by default the
   lead) writes them as Given/When/Then statements. Your tests must cover them. If they're missing or unclear,
   ask before building — don't guess.
3. **Check whether you need a new contract.** Shapes the API and web share belong in
   `packages/contracts`. The imported code still declares its shapes in
   `apps/api/src/types/index.ts` and `apps/web/src/types/index.ts`. If your task needs a new
   shape, add it in the same PR as the code that uses it, and never add a second copy of one that
   already exists.

## Architecture rules

- **Web: import a feature only through `apps/web/src/features/<name>/index.ts`.** Inside a
  feature, use relative imports.
- **API: code is organised by layer.** `routes/` wires middleware to `controllers/`, controllers
  call `services/`, and `middleware/auth.ts` and `utils/db.ts` (the Prisma client) are shared.
- **Dependency direction:** `identity ← profile ← sessions ← feedback`. `sessions` never
  imports `feedback`; it inserts a `session.ended` job in the same transaction that ends the session instead.
- **The web calls the API only through `apps/web/src/lib/api.ts`**, which attaches the Supabase
  access token.
- **The browser never sees provider API keys** and never queries Supabase tables directly.
- **Sign-in is Supabase only.** The browser signs in with Supabase, and the API accepts only a
  Supabase access token (`apps/api/src/middleware/auth.ts`). Don't add another login, password
  endpoint or token format.
- **Vendor code is quarantined:** only `apps/api/src/services/gemini.service.ts` calls Gemini for
  resume analysis. The voice-provider token code (LS3) and the evaluation LLM (FB4) each get one
  file of their own under `apps/api/src/services/`, and nothing else calls those providers.
- **Placeholder code is marked `STUB`** with the owning slice named.

## Making a change

- Branch from `main`: `<module>/<short-task>`, e.g. `sessions/transcript-turns`.
- Commit with [Conventional Commits](https://www.conventionalcommits.org), scoped by module:
  `feat(sessions): post transcript turns`, `fix(feedback): retry after final failure`.
- Before pushing:

  ```bash
  bun run typecheck   # Bun (API) and Vite (web) don't check types, so this is required
  bun run test
  ```

- Changing `apps/api/prisma/schema.prisma`? Add a new migration in the same PR, and run
  `bun run --filter @interview/api db:generate`. Never edit a migration that is already committed,
  and never run `prisma migrate dev` or `prisma migrate reset` against the shared Supabase database.

## What makes a PR mergeable

- **One task, small.** Under ~300 changed lines, not counting `bun.lock`. Split bigger work.
- **Stays in your lane.** Only your part of the app (your routes, controllers and services in
  `apps/api`, your feature or pages in `apps/web`), plus `packages/contracts` or a new migration
  if the task needs it.
  Found a problem elsewhere? Open an issue or a separate PR.
- **Tests encode the acceptance criteria.** Test names should read like the criteria. Every bug
  fix comes with a test that failed before the fix.
- **No new dependencies without the lead's approval** in the PR.
- **Proof is screenshots, not text.** Attach what the issue's "Proof required" section asks
  for: the feature working in the browser, its failure or empty state, and the Network tab,
  database or terminal as needed. A short screen recording is even better. Pasted output
  doesn't count.

### Automatic rejections

These apply to the lines your PR adds or changes; code imported from the slices predates them.

- Code unrelated to the task
- Unused exports, files, or parameters
- An abstraction with one caller "for later"
- `any`, `as` casts, or `@ts-ignore` without a comment explaining why
- A `catch` that swallows the error
- Comments that restate what the code does
- Placeholder code not marked `STUB`
- A hand-written type that duplicates a contract
- A committed `.env` file, database file, `dist/` or `node_modules/`

## Review

- **Every PR is reviewed by someone from a different pair.** Changes to `packages/contracts`,
  `apps/api/prisma/` (schema or migrations), any `package.json`, or `bun.lock` also need the lead.
- **Reviewers check behaviour, not just style:** does it meet the acceptance criteria, does it
  respect the architecture rules, would you know how to debug it?
- **Ask the author, don't fix it for them.** If something is unclear, ask them to explain it.

## Walkthroughs

On integration days, the lead picks a part of each merged PR and asks the author to walk
through it without tools: what it does, why it's written that way, and how it would fail.
This isn't a trick — it's how we make sure at least two people understand every part of the
system. A PR whose author can't explain it is closed, not patched by the reviewer.

## Using AI tools

Allowed. The walkthrough is where understanding is checked, so be ready to explain anything a
tool wrote for you. Some habits that help:

- Ask it to explain code before you accept it, and run the change yourself in small steps.
- Don't trust a tool's claim that something works; run it and screenshot it yourself.
- Don't let it touch files outside your task. Point it at this file so it knows the rules;
  whether or not it follows them, they still apply to you.
