<!--
PR title: Conventional Commit scoped by module, e.g. feat(sessions): post transcript turns
See CONTRIBUTING.md.
-->

Closes #<!-- issue number -->

## What I checked

<!-- A line or two: what you ran or clicked, and anything the issue's "Proof required" section asks for. -->

## Checklist

- [ ] Every acceptance criterion in the issue is met and has a test
- [ ] One task, under ~300 changed lines excluding `bun.lock`
- [ ] Changes stay in my part of the app (plus `packages/contracts` or a new migration if the task needs it)
- [ ] `bun run typecheck` and `bun run test` pass
- [ ] No new dependency, or the lead has approved it in this PR
- [ ] No `.env` file, database file, `dist/` or `node_modules/` in the diff
- [ ] Schema changes come with a new Prisma migration; no committed migration was edited
- [ ] Placeholder code is marked `STUB` with the owning slice named
- [ ] I can walk through every line of this diff without tools
