# Sprint 1 — Thu 24 Sep to Sun 27 Sep 2026

**Goal: a walking skeleton.** A candidate signs in, picks a role, holds a short voice
interview, ends it, and sees feedback written by an LLM. The transcript is stored.

**Hard stop: Sun 27 Sep, end of day.** Exams start 5 Oct. Mon 28 Sep – Sun 4 Oct is for bug
fixes only; nothing merges after Sun 4 Oct.

Every task below becomes a GitHub issue (Task template) with one assignee. Proof in the PR is
screenshots or a screen recording — see [CONTRIBUTING.md](../CONTRIBUTING.md).

## Teams and owners

| Team | Members | Tasks |
|---|---|---|
| Lead | Prayag (@prayag-kachhia) | L1–L7 (#2–#8) |
| Live session | Prayag, Vishwa (@Vishwa7399), Kishan (@kishan-savani-ops) | LS1, LS3: Vishwa · LS2, LS4: Kishan (#9–#12) |
| Feedback | Praneel (@Praneel2309), Shaurya (@Shaurya9989), Ved (@Patel-Ved-702), Rahi (@Rahi2310) | FB1: Praneel · FB2: Ved · FB3: Shaurya · FB4: Rahi (#13–#16) |
| Identity & profile | Prakriti (@PrakritiPandey24), Raj (@Raj-PaTel-007), Vismay (@vismay0101) | ID1: Raj · ID2: Prakriti · ID3: Vismay (#17–#19) |

Prakriti also owns documentation.

## Timeline

| Due | Lead | Live session | Feedback | Identity & profile |
|---|---|---|---|---|
| **Fri 25 Sep** | L1 contracts, L2 stub auth, L3 CI, L4 issues | | | |
| **Sat 26 Sep** | L7 approve rubric | LS1 voice spike (go / no-go) | FB1 results screen, FB4 rubric draft | ID1 database setup |
| **Sun 27 Sep, EOD** | L5 integration check, L6 integration and demo | LS2 create session, LS3 voice token, LS4 live screen, turns, end session | FB2 jobs table + worker, FB3 feedback job + endpoint, FB4 evaluator | ID2 sign-in screen, ID3 auth middleware |
| **Sun 4 Oct** | Merge freeze | | | |

Sunday's tasks depend on Saturday's (ID1 database, LS1 voice spike, L1 contracts, L2 stub
auth), and several depend on each other (LS2 → LS3 → LS4, FB2 → FB3, ID2 → ID3). Merge early
on Sunday so the next task can build on it; don't hold work back until the evening.

## Lead

- **L1 — Contracts (Fri 25).** Zod schemas in `packages/contracts` for session, transcript
  turn and feedback, so every team builds against the same shapes from day one.
- **L2 — Stub auth (Fri 25).** API middleware marked `STUB` that sets a fixed user id, so
  Live session and Feedback don't wait for ID3.
- **L3 — CI (Fri 25).** GitHub Actions running `bun run typecheck` and `bun run test` on every PR.
- **L4 — Issues (Fri 25).** Labels, the Sprint 1 milestone, the project board, and one issue
  per task below, each with an assignee.
- **L5 — Integration check (Sun 27, midday).** Everything due Saturday is merged and runs
  together against the stubs. Anything blocked is re-planned on the spot.
- **L6 — Integration and demo (Sun 27, EOD).** The full flow runs end to end on one machine.
- **L7 — Approve the rubric (Sat 26).** Sign off the generic rubric the Feedback team drafts
  for FB4. Per-role rubrics (OI-3) come later.

## Live session

**LS1 — Voice spike (Sat 26).** Throwaway code, not merged into the apps.
- A 60-second spoken conversation with the voice provider from the browser, using a
  short-lived token minted server-side.
- A written go / no-go: is transcript text available for both speakers, and where (browser
  or server)?
- Proof: screen recording of the conversation.
- **If no-go:** Sprint 1 ships a text-chat interview instead (the FR-30 fallback), and voice
  moves to Sprint 2. LS3 and LS4 change accordingly.

**LS2 — Create a session (Sun 27).**
- Given a signed-in candidate, when they pick a role, then a session is created and they
  move to the interview screen.
- Given an unknown role id, when a session is requested, then the API rejects it.
- The role picker moves from `App.tsx` into `features/sessions`. Sessions and turns tables.
- Proof: browser recording, database rows.

**LS3 — Voice token (Sun 27).**
- Given the candidate's own session, when a token is requested, then a short-lived token
  comes back.
- Given another candidate's session, then the API returns 404 (FR-27).
- The provider API key never appears in any response or in the web bundle (NFR-09).
- Proof: Network tab showing the token response.

**LS4 — Live screen, transcript turns, end session (Sun 27).**
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

**FB2 — Jobs table and worker (Sun 27).**
- `jobs` and feedback tables, with a migration.
- Given a queued job, the worker claims it with `SELECT … FOR UPDATE SKIP LOCKED`.
- Given two workers running, then no job is processed twice (a test proves it).
- Proof: terminal running two workers, job rows before and after.

**FB3 — Feedback job and endpoint (Sun 27).**
- Given a `session.ended` job, then the evaluator writes feedback for that session. Use a
  `STUB` evaluator until FB4 is merged.
- Given the candidate's own session, `GET` feedback returns pending until it's written, then
  the feedback.
- Given another candidate's session, then 404 (FR-27).
- Proof: browser recording from ending a session to seeing feedback.

**FB4 — Evaluator (rubric draft Sat 26, evaluator Sun 27).** Can start Saturday; it only needs
L1's contracts and a sample transcript, not the rest of the pipeline.
- A generic rubric for every role — for example communication, technical depth, structure —
  drafted by the team and approved by the lead (L7).
- `feedback/evaluator.ts` is the only file that calls the text LLM. Given a transcript and a
  role, it returns feedback matching the contract, scored against the rubric.
- It finishes well inside the 15-second budget (NFR-03) for a short interview.
- The LLM API key lives in `apps/api/.env` only and never reaches the browser.
- Given the LLM call fails or times out, then the job is marked failed and the transcript
  is untouched (NFR-04).
- Tests run against a sample transcript with the LLM call mocked; no test hits the real API.
- Proof: screenshot of real feedback for a sample transcript, terminal showing the tests.

## Identity & profile

**ID1 — Database setup (Sat 26). Blocks LS2, FB2 — do this first, ideally by Saturday midday.**
- A Supabase project; Prisma configured in `apps/api`; one command runs migrations.
- A `users` table; the API connects using credentials from `.env`, never committed.
- The README explains how a teammate gets their own database running.
- Proof: terminal running the migration, the table in Supabase.

**ID2 — Sign-in screen (Sun 27).**
- Given a signed-out visitor, then they see the sign-in screen and nothing else.
- Given they sign in with Supabase, then they reach the role picker.
- Every API request carries their token (update `apps/web/src/lib/api.ts`).
- The browser uses Supabase for sign-in only — no table queries.
- Proof: browser recording of signing in, Network tab showing the token on a request.

**ID3 — Auth middleware (Sun 27).** Replaces the L2 stub.
- Given a request with no token, or an invalid or expired one, then 401.
- Given a valid token, then the user id is available to route handlers.
- A shared helper so other modules return 404, not 403, for another user's resource (FR-27).
- Proof: terminal running the tests, Network tab showing 401 and 200.

## Where Sprint 1 ended up (28 Sep)

The Identity and Live session teams built one Express 5 + Prisma 5 app outside the repo. It
became the base (#23) in place of the Hono shell, so it also replaced L2's stub auth and
the Drizzle setup that ID1 described. See `docs/adr/0008-express-and-prisma.md`.

| Task | Where it landed |
|---|---|
| L1 contracts | #28 |
| L2 stub auth | not needed: real Supabase auth arrived with the base (#23) |
| L3 CI | #27. Protecting `main` needs GitHub Pro (free with the Student Pack) or a public repo |
| LS1 voice spike | GO, Gemini Live (#9 comment) |
| LS2, LS4, ID1–ID3 | the imported slices (#23) |
| LS3 voice token | #24 (API side). The browser-side Gemini adapter is still to do |
| FB1 results screen | #26 |
| FB2 jobs table + worker | #25 |
| FB3 feedback job + endpoint, FB4 evaluator | #29 |
| L5/L6 integration and demo, L7 rubric approval | the lead, with real Supabase and Gemini keys |

The live interview still uses the browser's speech recognition and synthesis until the Gemini
adapter lands. That's the planned fallback, so the demo flow works either way.

## Moved to Sprint 2 (after exams)

Per-role rubrics (OI-3) · feedback retry (NFR-04) · ESLint boundary rule and Prettier · GitHub
context for the profile (resume upload already exists) · deleting sessions and accounts (FR-28) · 30-day retention purge (NFR-11) ·
latency measurement (NFR-01, NFR-03).
