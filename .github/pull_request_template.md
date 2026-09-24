<!--
PR title: Conventional Commit scoped by module, e.g. feat(sessions): post transcript turns
Proof is screenshots or a short screen recording, dragged into this box. Pasted text doesn't count.
See CONTRIBUTING.md.
-->

Closes #<!-- issue number -->

## Proof

<!-- Attach everything the issue's "Proof required" section asks for. -->

**Working in the browser:**

**Failure or empty state:**

**Network tab / database / terminal (as the issue asks):**

## Checklist

- [ ] Every acceptance criterion in the issue is met and has a test
- [ ] One task, under ~300 changed lines excluding `bun.lock`
- [ ] Changes stay in my module/feature (plus `packages/contracts` if the task needs a new shape)
- [ ] `bun run typecheck` and `bun run test` pass
- [ ] No new dependency, or the lead has approved it in this PR
- [ ] Placeholder code is marked `STUB` with the owning slice named
- [ ] I can walk through every line of this diff without tools
