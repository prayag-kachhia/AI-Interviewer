# AI-Interviewer

AI interview practice platform (IT314, DA-IICT). Bun workspace monorepo, TypeScript end to end.

## Setup

Requires [Bun](https://bun.com) 1.4 or later.

```bash
bun install
bun run dev        # API on http://localhost:3000, web on http://localhost:5173
```

Open http://localhost:5173 — you should see a list of three roles loaded from the API.

Before opening a PR:

```bash
bun run typecheck  # Bun runs TypeScript without checking types, so this is required
bun run test
```

Defaults work without any `.env`. To override, copy `apps/api/.env.example` to `apps/api/.env`
and `apps/web/.env.example` to `apps/web/.env.local`.

## Layout

```
packages/contracts   @interview/contracts — Zod schemas + inferred types shared by API and web
apps/api             Hono on Bun. src/modules/{identity,profile,sessions,feedback}
apps/web             React + Vite. src/features/{identity,profile,sessions,feedback}
```

## Rules

- **Import a module only through its `index.ts`.** Inside a module, use relative imports.
  (`@/modules/*/*` and `@/features/*/*` imports will be blocked by ESLint once lint is set up.)
- **Dependency direction:** `identity ← profile ← sessions ← feedback`. `sessions` never imports `feedback`.
- **Shared request/response shapes live in `packages/contracts`.** Change a contract in the same PR as the code that needs it.
- **The browser never sees provider API keys**, and never queries Supabase tables directly.
- Mark placeholder code `STUB` with the owning slice named.
- Conventional Commits scoped by module: `feat(sessions): …`.

## Status

Done: workspace, shared strict tsconfig, contracts (`Role`), API shell (`/health`, stubbed `/roles`),
web shell (fetches and validates `/roles`).

Not yet done (Platform owns): ESLint with the boundary rule, Prettier, a single `check` script,
CI on every PR, protected `main`, CODEOWNERS.
