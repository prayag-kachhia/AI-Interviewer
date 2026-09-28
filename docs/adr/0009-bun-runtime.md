# ADR-0009: Bun as the runtime and package manager

- **Status:** Accepted, 28 Sep 2026
- **Supersedes:** ADR-0006's choice of Node as the runtime

## Decision

Bun (1.4 or later) installs dependencies (`bun.lock` is the only lockfile), runs the workspace
scripts, and runs the API (`bun --watch src/server.ts`). Vite, Vitest and the Prisma CLI still
run on Node 22, which is why the README asks for both.

## Consequences

- Bun loads `apps/api/.env` before any module runs, and the API relies on that. Running it
  under Node instead needs `import 'dotenv/config'` as the first line of `server.ts`.
- Bun doesn't typecheck, so `bun run typecheck` (tsc) is required before every PR, and CI runs it.
