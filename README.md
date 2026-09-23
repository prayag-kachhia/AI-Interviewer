# interviewer

AI interview practice platform (IT314, DA-IICT). Bun workspace monorepo.

## Setup

Requires [Bun](https://bun.com) 1.4 or later.

```bash
bun install
bun run typecheck
```

## Layout

- `packages/contracts` — `@interview/contracts`: Zod schemas and inferred types shared by the API and web app.
- `apps/` — the API and web app (not yet created).
