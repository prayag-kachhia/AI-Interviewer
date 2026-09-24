# Sprint 1 — Thu 24 Sep to Wed 30 Sep 2026

**Goal: a walking skeleton.** A candidate signs in, picks a role, holds a short voice
interview, ends it, and sees feedback. The transcript is stored. Feedback is a `STUB` this
sprint — the real evaluator comes after exams.

**Hard stop: Wed 30 Sep.** Exams start 5 Oct. Thu 1 – Sun 4 Oct is for bug fixes only;
nothing merges after Sun 4 Oct.

Every task below becomes a GitHub issue (Task template) with one assignee. Proof in the PR is
screenshots or a screen recording — see [CONTRIBUTING.md](../CONTRIBUTING.md).

## Timeline

| Due | Lead | Live session | Feedback | Identity & profile |
|---|---|---|---|---|
| **Fri 25 Sep** | L1 contracts, L2 stub auth, L3 CI, L4 issues | | | |
| **Sat 26 Sep** | | LS1 voice spike (go / no-go) | FB1 results screen | ID1 database setup |
| **Mon 28 Sep** | L5 integration check | LS2 create session, LS3 voice token | FB2 jobs table + worker | ID2 sign-in screen |
| **Tue 29 Sep** | | LS4 live screen, turns, end session | FB3 feedback job + endpoint | ID3 auth middleware |
| **Wed 30 Sep** | L6 integration and demo | | | |
| **Sun 4 Oct** | Merge freeze | | | |

Tasks due the same day on one team can run in parallel — split them between team members.

## Lead

- **L1 — Contracts (Fri 25).** Zod schemas in `packages/contracts` for session, transcript
  turn and feedback, so every team builds against the same shapes from day one.
- **L2 — Stub auth (Fri 25).** API middleware marked `STUB` that sets a fixed user id, so
  Live session and Feedback don't wait for ID3.
- **L3 — CI (Fri 25).** GitHub Actions running `bun run typecheck` and `bun run test` on every PR.
- **L4 — Issues (Fri 25).** Labels, the Sprint 1 milestone, the project board, and one issue
  per task below, each with an assignee.
- **L5 — Integration check (Mon 28).** Everything so far is merged and runs together against
  the stubs. Anything blocked is re-planned the same day.
- **L6 — Integration and demo (Wed 30).** The full flow runs end to end on one machine.

## Live session

**LS1 — Voice spike (Sat 26).** Throwaway code, not merged into the apps.
- A 60-second spoken conversation with the voice provider from the browser, using a
  short-lived token minted server-side.
- A written go / no-go: is transcript text available for both speakers, and where (browser
  or server)?
- Proof: screen recording of the conversation.
- **If no-go:** Sprint 1 ships a text-chat interview instead (the FR-30 fallback), and voice
  moves to Sprint 2. LS3 and LS4 change accordingly.

**LS2 — Create a session (Mon 28).**
- Given a signed-in candidate, when they pick a role, then a session is created and they
  move to the interview screen.
- Given an unknown role id, when a session is requested, then the API rejects it.
- The role picker moves from `App.tsx` into `features/sessions`. Sessions and turns tables.
- Proof: browser recording, database rows.

**LS3 — Voice token (Mon 28).**
- Given the candidate's own session, when a token is requested, then a short-lived token
  comes back.
- Given another candidate's session, then the API returns 404 (FR-27).
- The provider API key never appears in any response or in the web bundle (NFR-09).
- Proof: Network tab showing the token response.

**LS4 — Live screen, transcript turns, end session (Tue 29).**
- Given a live interview, when either side finishes speaking, then the turn is posted to
  the API and stored.
- Given a turn timestamped later than the session's elapsed time, then the API rejects it.
- Given the candidate ends the session, then it is marked ended and a `session.ended` job
  is inserted in the same transaction.
- Proof: browser recording of a short interview, turns and job rows in the database.

## Feedback

**FB1 — Results screen (Sat 26).** Built against fake data until FB3 lands.
- Given feedback is pending, then the screen shows it's being prepared and keeps polling.
- Given feedback is ready, then it's displayed.
- Given feedback failed, then the screen says so (retry comes in Sprint 2).
- Proof: screenshots of all three states.

**FB2 — Jobs table and worker (Mon 28).**
- `jobs` and feedback tables, with a migration.
- Given a queued job, the worker claims it with `SELECT … FOR UPDATE SKIP LOCKED`.
- Given two workers running, then no job is processed twice (a test proves it).
- Proof: terminal running two workers, job rows before and after.

**FB3 — Feedback job and endpoint (Tue 29).**
- Given a `session.ended` job, then the `STUB` evaluator writes feedback for that session.
- Given the candidate's own session, `GET` feedback returns pending until it's written, then
  the feedback.
- Given another candidate's session, then 404 (FR-27).
- Proof: browser recording from ending a session to seeing feedback.

## Identity & profile

**ID1 — Database setup (Sat 26). Blocks LS2, FB2 — do this first.**
- A Supabase project; Drizzle configured in `apps/api`; one command runs migrations.
- A `users` table; the API connects using credentials from `.env`, never committed.
- The README explains how a teammate gets their own database running.
- Proof: terminal running the migration, the table in Supabase.

**ID2 — Sign-in screen (Mon 28).**
- Given a signed-out visitor, then they see the sign-in screen and nothing else.
- Given they sign in with Supabase, then they reach the role picker.
- Every API request carries their token (update `apps/web/src/lib/api.ts`).
- The browser uses Supabase for sign-in only — no table queries.
- Proof: browser recording of signing in, Network tab showing the token on a request.

**ID3 — Auth middleware (Tue 29).** Replaces the L2 stub.
- Given a request with no token, or an invalid or expired one, then 401.
- Given a valid token, then the user id is available to route handlers.
- A shared helper so other modules return 404, not 403, for another user's resource (FR-27).
- Proof: terminal running the tests, Network tab showing 401 and 200.

## Moved to Sprint 2 (after exams)

Real LLM evaluation · feedback retry (NFR-04) · ESLint boundary rule and Prettier · profile
(resume, GitHub context) · deleting sessions (FR-28) · 30-day retention purge (NFR-11) ·
latency measurement (NFR-01, NFR-03).
