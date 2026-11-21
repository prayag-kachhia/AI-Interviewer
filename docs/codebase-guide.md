# Codebase guide

This explains the whole project to someone who has never opened it. After reading it you should
be able to find the code for any feature, explain why it is built that way, and answer an
evaluator's questions about it.

For the formal architecture (diagrams, quality attributes) see [design.md](design.md). For why
the hard-to-reverse choices were made, see the ADRs in [adr/](adr/). Other guides:
- [guides/local-setup.md](guides/local-setup.md): run everything on your machine;
- [guides/voice.md](guides/voice.md): how the spoken interview works;
- [guides/add-a-role.md](guides/add-a-role.md): add an interview role;
- [operations.md](operations.md): deploys, secrets, costs and fixing production.

## 1. What the app does

A candidate signs in, uploads a resume, picks a role (Software Engineer, Data Analyst or Backend
Developer), and holds a 15-minute mock interview with an AI interviewer. The interview is spoken
(Gemini Live), with a browser-speech fallback and a typed mode. When it ends, a background worker
grades the transcript against the role's rubric and writes feedback: a score per category,
strengths, improvements, quotes from the candidate's answers, and feedback on each answer. The
candidate also gets a history with a progress graph, an improvement guide, and can download or
delete all their data. The owner sees platform statistics on an admin dashboard.

## 2. The repository

```
apps/
  api/                      Express 5 + Prisma 7 on Postgres (Supabase), run with Bun
    prisma/schema.prisma    every table, relation and cascade
    prisma/migrations/      one folder per change; never edit a committed one
    src/server.ts           mounts the routers, CORS, the error handler, starts the worker
    src/routes/             one file per resource: URLs, input checks, HTTP status codes
    src/services/           the logic and the database calls
    src/middleware/         auth.ts (sign-in check), adminAuth.ts (owner dashboard gate)
    src/worker.ts           the job worker (runs inside the API process)
    src/prompts/            the resume-parsing prompt
    src/data/resources.ts   curated learning resources for the improvement guide
    src/errors.ts           AppError, NotFoundError, getUserResourceOr404
    src/__tests__/          Vitest + Supertest; Gemini is always mocked
    scripts/                evaluate.ts, bench.ts (feedback quality), latency.ts (voice timing)
  web/                      React 19 + Vite + Tailwind CSS v4
    index.html              includes a tiny script that applies the theme before first paint
    src/App.tsx             the routes
    src/screens/<name>/     one folder per screen: component, hook, tests
    src/components/ui/      shared UI primitives (shadcn style): Button, Card, Alert, Dialog…
    src/components/         Navbar, Logo, Field, ThemeSwitcher, ProtectedRoute, AuthLayout…
    src/context/            AuthContext (Supabase sign-in), ThemeContext (three themes)
    src/lib/api.ts          every HTTP call to the API
    src/lib/voiceAdapter.ts the voice adapter interface and the browser-speech adapter
    src/lib/geminiLiveAdapter.ts   the Gemini Live adapter (WebSocket, microphone, playback)
    src/lib/audio.ts        microphone capture helpers and the playback queue
    src/styles.css          the theme variables and the Tailwind setup
    e2e/                    the Playwright golden-path test and its fake Gemini
packages/
  contracts/src/index.ts    Zod schemas and types shared by both apps (roles, session, turn, feedback)
docs/                       requirements, design, ADRs, the plan, these guides; old plans in archive/
.github/workflows/          ci.yml (every PR), deploy.yml (every merge to main)
spike/                      the first Gemini Live prototype; reference only, not part of the app
```

A change in `packages/contracts` affects both apps, so the lead reviews it.

## 3. Tech stack, and why

| Piece | Choice | Why |
|---|---|---|
| Runtime | Bun | One fast tool to install, run and test TypeScript ([ADR-0009](adr/0009-bun-runtime.md)) |
| API | Express 5 + Prisma 7 | What two teams had working by Sprint 1 ([ADR-0008](adr/0008-express-and-prisma.md)) |
| Database | Postgres on Supabase | Transactions and cascades for interview data ([ADR-0010](adr/0010-context-storage.md)) |
| Sign-in | Supabase Auth | Email, Google and password reset without storing passwords ourselves |
| Web | React 19 + Vite + Tailwind CSS v4 | One design system with three themes ([ADR-0011](adr/0011-design-system.md)) |
| Voice | Gemini Live, browser speech fallback | Low latency; audio goes straight to Google ([ADR-0014](adr/0014-voice-transport.md)) |
| Grading | Gemini (`gemini-3.8-flash`), structured JSON | Rubric scores that the code can validate |
| Shared types | Zod in `packages/contracts` | One definition gives types and runtime checks in both apps |
| Hosting | Cloud Run (API) + Firebase Hosting (web) | Pay only while used ([ADR-0015](adr/0015-scale-to-zero.md)) |

## 4. How a request flows

```
screen or hook ─▶ lib/api.ts ─▶ routes/<resource>.ts ─▶ services/<x>.service.ts ─▶ Prisma ─▶ Postgres
                  (adds the      (auth, input check,     (logic, ownership,
                   sign-in token) status codes)           transactions)
```

- **Web:** `lib/api.ts` is one axios instance. It reads the Supabase session and sends
  `Authorization: Bearer <token>` on every call. No screen calls `fetch` directly.
- **API:** routes stay thin. They validate input (mostly with the Zod schemas from contracts),
  call a service, and pick the status code. Services throw `NotFoundError` or another `AppError`;
  the error handler in `server.ts` turns it into JSON and never leaks a stack trace.

### Every API route

| Mount | File | Endpoints |
|---|---|---|
| `/api/auth` | `routes/auth.ts` | `GET /me` (profile, `isAdmin`), `DELETE /account` |
| `/api/resume` | `routes/resume.ts` | `POST /analyze` (PDF, 5 MB), `GET /latest`, `GET /:id` |
| `/api/sessions` | `routes/sessions.ts` | `GET /roles`, `POST /`, `GET /`, `GET /:id`, `GET /:id/turns`, `POST /:id/turns`, `POST /:id/end`, `PATCH /:id/keep`, `POST /:id/voice-token`, `POST /:id/next-question`, `DELETE /:id` |
| `/api/sessions` | `routes/feedback.ts` | `GET /:id/feedback`, `POST /:id/feedback/retry` |
| `/api/insights` | `routes/insights.ts` | `GET /`, `PATCH /progress` (and `GET /:userId`, which only ever answers for yourself) |
| `/api/me` | `routes/me.ts` | `GET /export` (all your data as JSON) |
| `/api/admin` | `routes/admin.ts` | `GET /stats` (owner dashboard) |
| | `server.ts` | `GET /health` |

## 5. The data model

| Model (table) | What it holds | Relations |
|---|---|---|
| `User` (`users`) | `supabaseUserId`, `email`, `name` | owns resumes, sessions and an improvement plan; deleting a user cascades to all of them |
| `Resume` | file name, extracted text, parsed profile (JSON stored as text) | belongs to a user; a session that used it keeps working if it's deleted (SetNull) |
| `Session` (`sessions`) | role, company, level, focus, mode (`voice`/`typed`), job description, `status` (`LIVE`/`ENDED`), `keep`, start and end times, end reason | belongs to a user; owns turns, jobs and feedback (cascade) |
| `Turn` (`turns`) | `turnIndex`, speaker (`AI`/`CANDIDATE`), text, server timestamp, `latencyMs` (on AI turns) | unique on `(sessionId, turnIndex)` |
| `Job` (`jobs`) | type, status, attempts, lock, last error | optional session; the daily purge job has none |
| `Feedback` (`feedback`) | status (`pending`/`ready`/`failed`), summary, scores and per-answer feedback (JSON), error | one per session |
| `ImprovementPlan` (`improvement_plans`) | topic scores and the action plan (JSON) | one per user |

Schema changes are new migrations created against a local Postgres; see
[guides/local-setup.md](guides/local-setup.md#changing-the-database). The deploy applies them to
production automatically.

## 6. Sign-in and who can see what

- **Sign-in is Supabase Auth** (email and password, Google). The browser talks to Supabase; our
  API never sees a password.
- **Every API request** goes through `middleware/auth.ts` (`authenticate`). It asks Supabase
  whether the token is valid, finds or creates the matching row in our `users` table, and sets
  `req.user`. Handlers use `req.user.id`, never a user id from the request.
- **Another user's resource answers 404, never 403** (FR-27), so nobody can learn that an id
  exists. Use `getOwnedSession(id, userId)` (`session.service.ts`) for sessions and
  `getUserResourceOr404` (`errors.ts`) for other resources.
- **The owner dashboard** (`/admin`, `GET /api/admin/stats`) is open only to confirmed emails
  listed in `ADMIN_EMAILS`. Everyone else gets 404, signed in or not.
- **Secrets stay on the server.** `GEMINI_API_KEY` and `SUPABASE_SERVICE_ROLE_KEY` live only in
  the API's environment. The browser gets only `VITE_` values, which are public by design.

## 7. One interview, end to end

1. **Setup** (`screens/new-interview/`). The candidate picks a role, optional focus areas,
   company, level and a job description, and voice or typed. Voice mode shows a microphone check
   with a device picker (`MicCheck.tsx`). `POST /api/sessions` creates the session (status LIVE)
   and links the newest resume.
2. **The briefing** (`briefing.service.ts briefingFor`). One function writes the interviewer's
   instructions: the role persona, the setup choices, a resume summary, the job description
   (marked as data, not instructions), three timed phases, guardrails, and the questions from
   the candidate's last 3 sessions so they aren't repeated. Every mode uses it, so the
   interviewer behaves the same everywhere.
3. **Voice** (`screens/interview-room/useInterview.ts`, `lib/geminiLiveAdapter.ts`). The room
   asks the API for a single-use Gemini Live token (`POST /:id/voice-token`). The token locks the
   model, voice and briefing, and the API key never leaves the server. The browser then talks to
   Gemini directly over a WebSocket. Details: [guides/voice.md](guides/voice.md).
4. **Fallbacks.** If Gemini Live fails, the room switches to the browser's own speech
   recognition and voices, and asks the API for each next question (`POST /:id/next-question`,
   `interviewer.service.ts`). Typed mode uses the same endpoint with a text box.
5. **Saving the transcript.** Each finished turn is saved with `POST /:id/turns`. The server sets
   the timestamp and the turn number, so the transcript can't be reordered or back-dated.
6. **Ending.** The candidate clicks End (with an optional reason) or the 15-minute timer runs
   out. `POST /:id/end` marks the session ENDED **and** queues a `session.ended` job in one
   database transaction.
7. **Grading** (`feedback.service.ts` → `evaluator.service.ts`). The worker sends the transcript
   and the role's rubric (`rubrics.ts`) to Gemini, asks for structured JSON, and checks the reply:
   exactly the rubric's categories, scores 1–5, and per-answer feedback that matches the
   questions asked. Gemini gets up to 60 seconds; feedback quality matters more than speed.
8. **Results** (`screens/results/`). The screen polls `GET /:id/feedback` every 3 seconds until
   it's ready, and offers Try again if grading failed. It shows a radar chart, the categories,
   per-answer feedback, the transcript, a Markdown download, Keep (exempt from the 30-day
   cleanup) and Delete.

## 8. The job queue and worker

- **Jobs live in the `jobs` table**, not in memory, so nothing is lost when the server restarts
  or Cloud Run stops the instance ([ADR-0013](adr/0013-job-queue.md)).
- **Three job types:** `session.ended` (grade an interview), `insights.refresh` (update the
  improvement guide after each graded interview) and `retention.purge` (once a day: delete ended,
  un-kept sessions older than 30 days).
- **Claiming** uses `FOR UPDATE SKIP LOCKED`, so several workers never take the same job. A job
  locked for more than 5 minutes is taken over.
- **Retries:** a temporary error (rate limit, 5xx, timeout) is retried, up to 3 attempts in all.
  Then the job is marked failed; a failed `session.ended` job writes failed feedback, so the
  candidate sees Try again instead of waiting forever.
- **Where it runs:** inside the API process (`server.ts`), unless `WORKER=off`. `bun run worker`
  starts another one.

## 9. Resume and the improvement guide

- **Resume** (`routes/resume.ts`): `pdf-parse` extracts the text, then Gemini turns it into a
  profile (`gemini.service.ts`). Without a key, or if Gemini fails, a rule-based parser takes
  over (`heuristic.service.ts`). A document that doesn't look like a resume gets 400. Every upload
  is a new row; the newest one is used.
- **Improvement guide** (`insights.service.ts`, `screens/guide/`): after each graded interview,
  Gemini scores 7 topics (DBMS, OOP, OS, CN, DSA, SQL, System Design) from the last 5 sessions,
  and the plan picks curated resources for the weakest ones. Candidates tick actions off.

## 10. The web app

- **Routes** (`App.tsx`): `/` is the landing page; `/login`, `/reset-password` and
  `/verify-email` are public. `/dashboard`, `/new-interview`, `/interview/:id`,
  `/interview/:id/feedback`, `/history`, `/guide`, `/profile` and `/admin` need sign-in
  (`ProtectedRoute`).
- **Design system:** Tailwind CSS v4 utility classes plus the primitives in `components/ui/`. No
  hand-written stylesheet and no fixed inline styles ([ADR-0011](adr/0011-design-system.md)).
- **Themes:** Swiss (light), Haute (dark, bronze) and Graphite (dark, emerald). Each is a block of
  CSS variables in `styles.css`; `ThemeContext` switches the class on `<html>`, and the script in
  `index.html` applies the saved theme before the first paint. Screens need no per-theme code.
  `styles.contrast.test.ts` checks each theme's colours meet WCAG AA.
- **Accessibility:** every screen has an automated axe test (`vitest-axe`), and keyboard focus is
  visible in every theme.

## 11. Testing

| What | Where | Run with |
|---|---|---|
| API unit and route tests | `apps/api/src/__tests__/` | `bun run test` |
| Database tests (job queue, deletion cascade) | same folder; they run when `TEST_DATABASE_URL` is set | `bun run test` with a local Postgres |
| Web component tests and axe accessibility checks | next to each screen, `*.test.tsx` | `bun run test` |
| End-to-end golden path in a real browser | `apps/web/e2e/` | `bun run --filter @interview/web e2e` |
| Feedback quality (expected scores, spread across runs) | `apps/api/scripts/bench.ts` | `bun run --filter @interview/api bench` |
| Voice response time | `apps/api/scripts/latency.ts` | `bun run --filter @interview/api latency` |

Tests never call the real Gemini API. Unit tests inject a fake `generate` function. The
end-to-end test points the Gemini SDK at a fake server (`apps/web/e2e/fake-gemini.ts`) through
`GOOGLE_GEMINI_BASE_URL`, so no production code knows about it ([ADR-0016](adr/0016-e2e-fake-gemini.md)).

## 12. CI and deploy

- **CI** (`.github/workflows/ci.yml`, every PR and push): typecheck, migrations on a throwaway
  Postgres, all tests, the web build, a Docker build that checks the API starts, and the
  end-to-end test.
- **Deploy** (`.github/workflows/deploy.yml`, every merge to main): migrations on production,
  then the API to Cloud Run (`asia-south1`), then the web app to Firebase Hosting. Settings, costs
  and troubleshooting: [operations.md](operations.md).

## 13. Where to make a change

| I want to… | Change |
|---|---|
| Add an API endpoint | `routes/<resource>.ts` + a service function + a test in `__tests__/`, then the call in `web/src/lib/api.ts` |
| Add a field both apps use | `packages/contracts/src/index.ts` (lead review), then both apps |
| Change the database | `schema.prisma` + a new migration (local Postgres only) + `bun run --filter @interview/api db:generate` |
| Change what the interviewer asks | `briefing.service.ts` (every mode uses it) |
| Change how answers are graded | `rubrics.ts` (categories) or `evaluator.service.ts` (prompt, checks); then run `bench` |
| Add an interview role | [guides/add-a-role.md](guides/add-a-role.md) |
| Add a screen | a folder in `web/src/screens/` and a route in `App.tsx`, built from `components/ui` |
| Change colours, fonts or corners | the theme blocks in `web/src/styles.css`, never a screen |
| Change a production setting | `deploy.yml` (it replaces every environment variable on each deploy) |

## 14. Known gaps (be honest about these)

From the 19 Nov review:
- **Abandoned interviews stay LIVE.** Nothing on the server ends a session the candidate walked
  away from, so it is never graded and never purged.
- **A hidden tab keeps streaming** the microphone to Gemini Live.
- **No rate limits** on the endpoints that call Gemini (S-9, #167).
- **Grading ignores the chosen level** (entry, mid, senior), and typed mode never gets the
  2-minute wrap-up cue.
- **A Gemini rate-limit error** uses up all 3 attempts within seconds, because retries have no
  delay.
- **Long interviews take more than 15 seconds to grade** (NFR-03 is Partial); quality was put
  first.

## 15. Likely evaluation questions

**"Why is the voice not going through your server?"**
Latency (NFR-01: under 5 s) and cost. The server only mints a single-use, short-lived token, so
the API key never reaches the browser (NFR-09).

**"What happens if the LLM is down when an interview ends?"**
The session still ends, and the transcript is safe. The feedback and the job are marked failed
with the error, and the results screen shows Try again, which queues the job again without
re-interviewing (NFR-04).

**"How do you stop two workers grading the same interview?"**
`SELECT … FOR UPDATE SKIP LOCKED` in a transaction. The first worker locks the row, and the
others skip it. A CI test runs two workers on a real Postgres and checks no job is claimed twice.

**"How do you stop one user reading another user's interview?"**
Every query filters by `id AND userId` (`getOwnedSession`), and the user id comes from the
verified token, never the request. Another user's session returns 404, so it doesn't even reveal
that the id exists (FR-27).

**"Why ending + job in one transaction?"**
So there's never an ended session without a grading job, or a job for a session that didn't end.

**"Why Zod contracts?"**
One definition gives compile-time types and runtime validation in both apps. If the API changes a
shape, the typecheck fails everywhere that uses it.

**"How do you know it works?"**
Vitest tests for every route and service (Supabase, Prisma and Gemini mocked), tests on a real
Postgres for the queue and the delete cascades, Testing Library and axe tests for every screen,
and an end-to-end test that signs in and runs a whole interview in a real browser. CI runs them
all on every PR, and a red check means no merge.

**"How did you check feedback is consistent?"**
`bench.ts` grades 26 hand-written transcripts 5 times each. Every rubric category stayed within
1 point across runs ([evaluation-benchmark.md](evaluation-benchmark.md)).

**"What did each person build?"**
See [final-sprints.md](final-sprints.md) and the task tables in [archive/](archive/). Each PR
names its task and author.

## 16. Questions by area

Each team should be able to answer its own block without notes, and know where the code is.

### Identity & profile (sign-in, users, resume)

**How does a user sign in? Does our API see the password?**
No. The browser calls Supabase directly (`signInWithPassword`, or `signInWithOAuth` for Google,
in `context/AuthContext.tsx`). Supabase checks the password and returns an access token (a JWT).
Our API only ever receives that token.

**How does the API know who is calling?**
`middleware/auth.ts` runs before every protected route:
1. It reads the `Authorization: Bearer <token>` header and asks Supabase whether the token is
   valid (`supabase.auth.getUser`).
2. It finds our `users` row by `supabaseUserId`, links a row with the same email, or creates one.
3. It sets `req.user`.

No token, or an invalid one, gets 401.

**Why keep our own `users` table if Supabase already has users?**
Our tables (sessions, resumes) need a normal foreign key to a user in our own database. The
`users` row is our copy of the Supabase user, linked by `supabaseUserId`.

**What happens when the token expires?**
The Supabase client refreshes the session automatically, and `lib/api.ts` reads the current
session before every request. "Stay signed in" chooses between local and session storage
(`lib/authStorage.ts`). The API keeps no session state, so nothing on the server expires.

**How does resume analysis work?**
`POST /api/resume/analyze`: multer keeps the PDF in memory (5 MB limit), `pdf.service.ts`
extracts the text, and `gemini.service.ts` asks Gemini for a JSON profile, validated against the
`CandidateProfile` contract. Without a key, or if Gemini fails, `heuristic.service.ts` parses it
with rules. Text that doesn't look like a resume gets 400.

**Why does a scanned PDF fail?**
A scanned PDF is an image with no text layer, and there's no OCR, so there is no text to read.

**What does "delete account" do?**
`DELETE /api/auth/account` deletes the user's `users` row, which cascades to their resumes,
sessions, turns, jobs, feedback and plan, and deletes their Supabase identity inside the same
database transaction. If Supabase refuses, the transaction rolls back and nothing is deleted.

**Can the browser read another user's data straight from Supabase?**
No. The browser uses Supabase only to sign in. All data goes through our API, which checks
ownership on every query.

### Live session (sessions, turns, voice)

**What happens when the candidate starts an interview?**
`POST /api/sessions` checks the setup against the `CreateSessionInput` contract (role, focus that
belongs to the role, company, level, job description) and inserts a LIVE session linked to the
newest resume. The browser opens `/interview/:sessionId`.

**Why are turns saved one by one, not at the end?**
So nothing already said is lost if the tab closes or the connection drops.

**What does the API check when a turn arrives?**
`speaker` must be `AI` or `CANDIDATE` and `text` non-empty and at most 4,000 characters (else
400); the session must be the caller's (else 404) and still LIVE (else 409). The server sets the
timestamp and the next `turnIndex`, so a client can't invent timings or reorder turns.

**How does ending work, and why one transaction?**
`endSession` marks the session ENDED and inserts a `session.ended` job in the same transaction.
Either both are saved or neither is.

**How does the voice work?**
The room connects `GeminiLiveVoiceAdapter` first, with a single-use token whose briefing is built
on the server. If that fails, it falls back to `BrowserWebSpeechVoiceAdapter`, which speaks and
listens with the browser's speech APIs and gets each question from `POST /:id/next-question`.
See [guides/voice.md](guides/voice.md).

**What is the briefing?**
The interviewer's system instructions, built per session by `briefingFor`: a persona for the
role, three timed phases (warm-up, deep-dive, pressure-test), the setup choices, the resume
summary, the job description, recent questions to avoid, and guardrails against prompt injection
and off-topic talk.

**Why is there a `VoiceSessionAdapter` interface?**
The room reaches the voice provider only through it (`connect`, `startListening`, `setMuted`,
`sendText`, `disconnect`…), so Gemini Live and browser speech are interchangeable, and the
fallback is a swap, not a rewrite.

**Why doesn't the audio go through our server?**
The interviewer must start answering within 5 seconds (NFR-01); relaying audio would add delay
and cost. The voice-token endpoint returns a token that works once, must be used within 2
minutes and expires after 30. Our Gemini key never reaches the browser (NFR-09).

**Why does the AI wait before saying "Take your time"?**
The room starts its 9-second silence timer only after the AI's audio has finished playing, not
when Gemini finishes generating it, and Gemini waits for 2 seconds of silence before treating an
answer as finished (#315).

**Which browsers work?**
Gemini Live works in any modern browser with a microphone. The browser-speech fallback needs
Chrome or Edge. Typed mode works everywhere.

### Feedback (job queue, worker, evaluator, results)

**Why is feedback generated in the background?**
The LLM can take many seconds or fail. Doing it inside the "end" request would make ending slow
and lose the work on a crash. Ending only writes a job row; a worker does the slow part, and the
browser polls for the result.

**Why a Postgres table as the queue and not Redis?**
One less service to run and pay for. `FOR UPDATE SKIP LOCKED` gives a safe queue, and the job is
saved in the same transaction as ending the session, which a separate Redis couldn't guarantee.

**Where does the worker run, now that Cloud Run scales to zero?**
Inside the API process. Cloud Run keeps the CPU on while an instance is up, and the Results page
keeps polling while feedback is pending, which keeps an instance up. If an instance stops
mid-job, the job's lock goes stale after 5 minutes and the next instance takes it over
([ADR-0015](adr/0015-scale-to-zero.md)).

**What if the worker crashes in the middle of a job?**
The job stays `processing` with a `lockedAt` time. After 5 minutes another worker picks it up,
at most 3 attempts in total. Then it's marked failed, so it can't loop forever.

**What if the LLM is down or slow?**
The evaluator gives Gemini up to 60 seconds. A slow or failed call is retried up to 3 attempts;
after that the feedback is marked failed with the reason, the transcript is untouched, and Try
again re-queues it (409 unless the feedback failed).

**Why 60 seconds and not 15?**
Per-answer feedback makes the output grow with every answer: a full interview with 10–20 answers
takes longer than 12 seconds, and on 18 Nov every such job failed. We chose complete, good
feedback over the 15-second target (NFR-03 is marked Partial).

**How do you make sure the LLM's answer is valid?**
Gemini is asked for structured output whose categories can only be the role's rubric
categories. Zod then checks every score is 1–5 with a comment, strengths, improvements and a
quote; every category appears exactly once; and per-answer feedback lines up with the questions.
Anything that fails is a failed evaluation.

**What is the rubric?**
Each role has its own categories in `rubrics.ts` (Software Engineer: Problem Solving &
Algorithms, Software Design & Architecture, Technical Communication), scored 1–5.

**Why a pinned model name instead of "latest"?**
An alias changes when Google releases a new model, so the same interview could score differently
next month. `deploy.yml` pins every model in production.

**Why polling and not WebSockets?**
For one result, polling every 3 seconds is simple, works through any proxy, and needs no extra
server.

**How do you test this without calling Gemini?**
The evaluator and the interviewer accept a `generate` function that tests replace. The queue
tests run against a real Postgres in CI. The end-to-end test uses a fake Gemini server. To check
the real model, run `scripts/evaluate.ts` or the benchmark by hand.

### Platform and process

**Why one repository with three packages?**
The API, the web app and the shared contracts change together. One PR can change a shape and
both of its users, and CI checks all three at once.

**The plan said Hono and Drizzle; why Express and Prisma?**
By the Sprint 1 deadline, two teams had a working app on Express and Prisma, while the planned
Hono shell was about 30 lines. The lead kept the working code ([ADR-0008](adr/0008-express-and-prisma.md)).
It's our main example of plan versus reality.

**What does CI check on every pull request?**
Install with the exact lockfile, typecheck every package, apply all migrations to a fresh
Postgres, run every test, build the web app, build the API's Docker image and check it starts,
and run the end-to-end test in a real browser.

**How is the app deployed?**
On every merge to `main`, GitHub Actions applies migrations, deploys the API to Cloud Run, checks
`/health`, then builds and publishes the web app to Firebase Hosting ([operations.md](operations.md)).

**Where are the secrets, and how does GitHub get into Google Cloud?**
The database URL, the Gemini key and the Supabase service key are in Google Secret Manager.
GitHub signs in with Workload Identity Federation, which gives short-lived access only to this
repository's `main` branch, so no Google key is stored in GitHub.

**Why does the API scale to zero?**
With one instance always on, Cloud Run billed about 720 hours a month for a handful of
interviews. Now it stops about 15 minutes after the last request; the trade-off is a few seconds'
cold start for the first visitor ([ADR-0015](adr/0015-scale-to-zero.md)).

**How do you change the database schema safely?**
Edit `schema.prisma` and add a new migration in the same PR, made against a local Postgres; never
edit a committed one. CI applies all migrations to a fresh database, and the deploy applies them
to production before the new API starts. Prefer changes that only add columns or tables.

**How do you undo a bad deploy?**
Revert the PR; the revert is a new merge, so everything redeploys. For an instant fix, send
Cloud Run traffic back to the previous revision.

**How is work divided and reviewed?**
One GitHub issue per task with one owner, one PR per task, CI must pass, and a review partner
approves. The author must be able to explain every line.

## Glossary

| Term | Meaning |
|---|---|
| JWT / access token | A signed string from Supabase proving who the user is; sent as `Bearer` |
| Migration | A SQL file that changes the schema; applied in order, never edited |
| Prisma client | The generated, typed database API (`prisma.session.create(...)`) |
| Transaction | Several database writes that all happen or none do |
| `FOR UPDATE SKIP LOCKED` | Lock the row I read, and skip rows someone else has locked |
| Upsert | Insert, or update if it already exists |
| CORS | The browser rule that blocks calls to another site unless that site allows it |
| Contract | A Zod schema in `packages/contracts` shared by API and web |
| Briefing | The interviewer's system instructions, built on the server per session |
| Structured output | Asking Gemini to reply in a fixed JSON schema |
| Ephemeral token | A short-lived, limited-use credential minted by our server for the browser |
| Cascade layers | CSS layers whose order decides which rule wins, whatever the selector |
| ADR | Architecture Decision Record: a short note on why a hard-to-reverse choice was made |
