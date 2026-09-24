# Contributing

How we work on this repo. Setup and layout are in the [README](README.md).

The short version: **you own every line you submit.** Use whatever tools you like, including
AI assistants, but if you can't explain your change, it doesn't get merged.

## Before you start

1. **Have a task with your name on it.** Every task is a GitHub issue made from the Task
   template, assigned to one person, with a milestone that sets its deadline. If there isn't
   one, ask the lead.
2. **Read the story's acceptance criteria.** The content & research pair writes them as
   Given/When/Then statements. Your tests must cover them. If they're missing or unclear,
   ask before building — don't guess.
3. **Check whether you need a new contract.** Request and response shapes live in
   `packages/contracts`. If your task needs a new one, it goes in the same PR as the code that
   uses it.

## Architecture rules

- **Import a module only through its `index.ts`.** Inside a module, use relative imports.
  `@/modules/*/*` and `@/features/*/*` are off limits from outside.
- **Dependency direction:** `identity ← profile ← sessions ← feedback`. `sessions` never
  imports `feedback`; it emits a `session.ended` job instead.
- **Contracts are the only definition of a shape.** Don't write a type by hand that duplicates
  one. The API parses what it sends; the web parses what it receives (`getJson`).
- **The browser never sees provider API keys** and never queries Supabase tables directly.
- **Vendor code is quarantined:** only `sessions/voice-provider.ts` talks to the voice provider,
  only `feedback/evaluator.ts` calls the evaluation LLM.
- **Placeholder code is marked `STUB`** with the owning slice named.

## Making a change

- Branch from `main`: `<module>/<short-task>`, e.g. `sessions/transcript-turns`.
- Commit with [Conventional Commits](https://www.conventionalcommits.org), scoped by module:
  `feat(sessions): post transcript turns`, `fix(feedback): retry after final failure`.
- Before pushing:

  ```bash
  bun run typecheck   # Bun runs TypeScript without checking types, so this is required
  bun run test
  ```

## What makes a PR mergeable

- **One task, small.** Under ~300 changed lines, not counting `bun.lock`. Split bigger work.
- **Stays in your lane.** Only your module or feature, plus `packages/contracts` if needed.
  Found a problem elsewhere? Open an issue or a separate PR.
- **Tests encode the acceptance criteria.** Test names should read like the criteria. Every bug
  fix comes with a test that failed before the fix.
- **No new dependencies without the lead's approval** in the PR.
- **Proof is screenshots, not text.** Attach what the issue's "Proof required" section asks
  for: the feature working in the browser, its failure or empty state, and the Network tab,
  database or terminal as needed. A short screen recording is even better. Pasted output
  doesn't count.

### Automatic rejections

- Code unrelated to the task
- Unused exports, files, or parameters
- An abstraction with one caller "for later"
- `any`, `as` casts, or `@ts-ignore` without a comment explaining why
- A `catch` that swallows the error
- Comments that restate what the code does
- Placeholder code not marked `STUB`
- A hand-written type that duplicates a contract

## Review

- **Every PR is reviewed by someone from a different pair.** Changes to `packages/contracts`,
  any `package.json`, or `bun.lock` also need the lead.
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
