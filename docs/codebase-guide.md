# Codebase guide

This explains the whole project to someone who has never opened it. After reading it you
should be able to run the app, find the code for any feature, explain why it is built that
way, and answer an evaluator's questions about it.

Read it in order the first time. Sections 1–4 are the big picture, 5 follows one interview
through the code, 6–13 go file by file, and 14–16 cover tests, CI, configuration and the
known gaps. Section 17 is a list of likely evaluation questions with answers.

---

## 1. What the product does

A candidate signs in, picks a job role, and holds a **spoken mock interview** with an AI
interviewer. When they end it, an LLM reads the transcript and writes **structured
feedback**: a short summary and a 1–5 score with a comment for three rubric categories
(Communication, Technical depth, Structure). Candidates can also upload a PDF resume, which is
parsed into a structured profile.

It is a practice tool, not a hiring platform: there are no employer accounts.

## 2. The big picture

```
 Browser (React app, apps/web)
   │  1. sign in ──────────────────────────────> Supabase Auth  (issues a JWT access token)
   │  2. every API call carries "Authorization: Bearer <token>"
   ▼
 API (Express on Bun, apps/api) ──── Prisma ────> Postgres (Supabase)
   │   routes → controllers → services             users, Resume, sessions, turns, jobs, feedback
   │
   ├── feedback worker (same process): claims "session.ended" jobs from the jobs table
   │        └──> Gemini text model: evaluates the transcript (evaluator.service.ts)
   └── voice token endpoint: asks Google for a short-lived token (voice-provider.service.ts)
                                   │
 Browser ── audio over WebSocket ──┘──> Gemini Live (planned, Sprint 2 V1; today: browser speech)
```

Three ideas carry the whole design:

1. **The browser never holds a provider key.** Sign-in is done by Supabase, and the API only
   *checks* the token. Gemini is called from the server, or, for live voice, with a
   single-use token the server mints (NFR-09).
2. **Shared shapes live in one place.** `packages/contracts` holds Zod schemas used by both
   apps, so the API and the web app can't silently disagree about a response's shape.
3. **Slow work happens in the background.** Ending an interview only writes a `jobs` row. A
   worker picks it up, calls the LLM, and writes feedback. The browser polls. A slow or
   failing LLM never blocks a request, and never loses the transcript (NFR-03, NFR-04).

## 3. Repository layout

```
.github/
  workflows/ci.yml            CI: install, typecheck, migrate a throwaway DB, test, build (every PR)
  pull_request_template.md    the checklist every PR fills in
  ISSUE_TEMPLATE/task.yml     the form every task issue is made from
docs/
  sprint-1.md, sprint-2.md    plans, owners, deadlines
  adr/                        architecture decision records (why we chose X)
  codebase-guide.md           this file
packages/contracts/           @interview/contracts — Zod schemas + types shared by API and web
apps/api/                     @interview/api — Express 5 + Prisma 5, run by Bun
  prisma/schema.prisma        the database tables
  prisma/migrations/          the history of schema changes, applied in order
  src/server.ts               creates the Express app, mounts routes, starts the worker
  src/worker.ts               the background feedback worker loop
  src/routes/                 URL → middleware → controller
  src/controllers/            HTTP in/out: read params, call a service, pick a status code
  src/services/               the real work: database, Gemini, the job queue
  src/middleware/auth.ts      checks the Supabase token on every protected route
  src/utils/                  the Prisma client, the NotFoundError helper
  src/__tests__/              Vitest + Supertest tests
apps/web/                     @interview/web — React 19 + Vite + react-router
  src/main.tsx, App.tsx       entry point and the route table
  src/pages/                  one component per screen
  src/features/               newer screens grouped by feature (feedback/, sessions/, …)
  src/context/                AuthContext (who is signed in), ThemeContext (light/dark)
  src/lib/                    api.ts (every API call), supabase.ts, voiceAdapter.ts, questionProvider.ts
  src/types/                  web-only types (most shared ones come from contracts)
package.json, bun.lock        the workspace: scripts dev / typecheck / test, one lockfile
tsconfig.base.json            shared strict TypeScript settings
```

## 4. Tech stack, and why

| Piece | Choice | Why |
|---|---|---|
| Language | TypeScript everywhere | One language for the whole team; types catch mistakes between API and web |
| Runtime, package manager | Bun | Fast installs, runs TypeScript directly, one lockfile ([ADR-0009](adr/0009-bun-runtime.md)) |
| API framework | Express 5 | What the teams built in; widely known ([ADR-0008](adr/0008-express-and-prisma.md)) |
| Database access | Prisma 5 | Typed queries, migrations as files ([ADR-0008](adr/0008-express-and-prisma.md)) |
| Database, sign-in | Supabase (Postgres + Auth) | Managed Postgres and email/password auth without running our own |
| Web | React 19, Vite, react-router | Standard; Vite gives fast dev builds |
| Shared shapes | Zod 4 | Runtime validation and TypeScript types from one definition |
| LLM | Google Gemini | One provider for evaluation, resume parsing and live voice |
| Tests | Vitest (+ Supertest, Testing Library, jsdom) | Same runner in both apps |
| CI | GitHub Actions | Runs on every PR, free for this repo |

**Bun runs the code but doesn't check types.** That's why `bun run typecheck` (the TypeScript
compiler, `tsc`) is required before every PR, and CI runs it.

## 5. One interview, end to end

Follow these steps with the files open; it's the fastest way to learn the codebase.

**Step 1 — Sign in.** `pages/Login.tsx` calls `signIn` from `context/AuthContext.tsx`, which
calls `supabase.auth.signInWithPassword` directly from the browser. Our API never sees the
password. Supabase returns a session with an **access token** (a JWT).

**Step 2 — Every request is authenticated.**
- *Browser:* `lib/api.ts` creates an axios client. Its interceptor reads the current
  Supabase session and adds `Authorization: Bearer <token>` to every request.
- *API:* `middleware/auth.ts` runs before each protected route.
  1. It asks Supabase whether the token is valid (`supabase.auth.getUser(token)`). Invalid →
     **401**.
  2. It finds our own `users` row by `supabaseUserId`. If there isn't one, it links an
     existing row with the same email, or creates one.
  3. It puts `{ id, email, name }` on `req.user`. Every later step uses `req.user.id`, never an
     id sent by the browser.

**Step 3 — Pick a role, create a session (LS2).**
- *Browser:* `pages/NewInterview.tsx` shows `ROLES` from `@interview/contracts`, refreshed from
  `GET /api/sessions/roles`.
- *API:*
  1. Choosing a role calls `POST /api/sessions` with `{ roleId }`.
  2. `session.service.ts → createSession` checks the id against `ROLES`. Unknown → **400**.
  3. It inserts a `sessions` row (`status = LIVE`).
  4. The browser navigates to `/interview/:sessionId`.

**Step 4 — The interview (LS4).** `pages/InterviewRoom.tsx` is the biggest screen.
- *Setup:* it loads the session (`GET /api/sessions/:id`) and creates a voice adapter
  (`lib/voiceAdapter.ts`).
- *Today's voice:* `BrowserWebSpeechVoiceAdapter` uses the browser's own speech synthesis
  (the AI's voice) and speech recognition (the candidate's words).
- *Today's questions:* they come from a fixed per-role script in `lib/questionProvider.ts`
  (`DeterministicQuestionProvider`). The second question quotes something the candidate said.
- *Each finished turn:* `postTurn` sends `{ speaker: 'AI' | 'CANDIDATE', text, timestampSec }`
  to `POST /api/sessions/:id/turns`.
- *Checks in `session.service.ts → addTurn`:*
  - The session must be yours (otherwise **404**) and still LIVE (otherwise **409**).
  - `timestampSec` can't be later than the session's elapsed time (otherwise **400**), which
    stops a client inventing turns.
  - Turns are stored one by one, so a dropped connection loses nothing already said.
- *Fallback:* if the browser has no speech recognition, the room shows a text box instead.

**Step 5 — End the interview.**
1. The End button calls `POST /api/sessions/:id/end`.
2. `session.service.ts → endSession` does two things **in one database transaction**: it marks
   the session `ENDED`, and it inserts a `jobs` row `{ type: 'session.ended', status: 'pending' }`.
   Either both happen or neither does, so an ended session always has its feedback job.
3. Ending twice is harmless: the second call does nothing.
4. The browser goes to `/interview/:sessionId/feedback`.

The sessions code never calls the feedback code. The job row is the only link between them.

**Step 6 — The worker writes feedback (FB2–FB4).**
1. `worker.ts → runWorker` runs inside the API process: `server.ts` starts it unless
   `WORKER=off`.
2. Every second it calls `job-queue.service.ts → processNextJob`.
3. `claimNextJob` runs `SELECT … FOR UPDATE SKIP LOCKED` inside a transaction. The row is
   locked, and any other worker skips locked rows, so **two workers never get the same job**.
   It marks the job `processing` and counts an attempt.
4. The handler, `feedback.service.ts → handleSessionEnded`, loads the turns and calls
   `evaluator.service.ts → evaluateTranscript`:
   - It builds a prompt with the role, the rubric and the transcript.
   - It calls Gemini asking for JSON, with a **12-second timeout** (inside the 15-second
     budget, NFR-03).
   - It validates the reply with Zod: each score is an integer 1–5, and every rubric category
     must appear exactly once.
5. On success → `saveFeedback(status 'ready')`, and the job becomes `completed`.
6. On failure → `saveFeedback(status 'failed')`, and the job becomes `failed` with the error
   saved. The turns are never touched (NFR-04).
7. A job stuck in `processing` for 5 minutes (a crashed worker) is retried up to 3 times, then
   marked failed.

**Step 7 — Results (FB1).** `features/feedback/ResultsPage.tsx` reads the session id from the
URL. `useFeedback.ts` calls `GET /api/sessions/:id/feedback` straight away, then every 3
seconds while the status is `pending`, and stops on `ready` or `failed`. `ResultsScreen.tsx`
shows "preparing", the error, or the summary and scores.

## 6. API reference (every route)

Every `/api/...` route requires a Supabase token, otherwise **401**. "Yours" means
another user's resource answers **404, never 403** (FR-27), so nobody can even tell whether an
id exists.

| Method and path | Controller → service | What it does | Errors |
|---|---|---|---|
| `GET /health` | `server.ts` | Liveness check, no auth | – |
| `GET /api/auth/me` | `auth.controller.getMe` | Your app user (and links it on first call) | 401 |
| `DELETE /api/auth/account` | `auth.controller.deleteAccount` | Deletes your resumes, user row and Supabase identity | 401; currently 500 if you have sessions (A1 fixes it) |
| `POST /api/resume/analyze` | `resume.controller.analyzeResume` → pdf, gemini services | Upload a PDF (field `resume`, max 5 MB) → text → structured profile → saved | 400 not a PDF / no text |
| `GET /api/resume/latest` | `resume.controller.getLatestResume` | Your newest analysed resume | 404 |
| `GET /api/resume/:id` | `resume.controller.getResumeById` | One of your resumes | 404 |
| `GET /api/sessions/roles` | `session.controller.getRoles` | The role list (`ROLES`) | – |
| `POST /api/sessions` | `postSession` → `createSession` | Start a session for `{ roleId }` | 400 unknown role |
| `GET /api/sessions/:id` | `getSessionById` | Your session with its turns | 404 |
| `GET /api/sessions/:id/turns` | `getTurns` → `listTurns` | Your session's turns in order | 404 |
| `POST /api/sessions/:id/turns` | `postTurn` → `addTurn` | Store one turn `{ speaker, text, timestampSec }` | 400 invalid / future timestamp, 404, 409 ended |
| `POST /api/sessions/:id/end` | `postEndSession` → `endSession` | End it and queue the feedback job (one transaction) | 404 |
| `POST /api/sessions/:id/voice-token` | `postVoiceToken` → `mintVoiceToken` | Single-use Gemini Live token for your LIVE session | 404, 409 ended, 500 provider failure (details only in the server log) |
| `GET /api/sessions/:id/feedback` | `feedback.controller.getFeedback` → `getFeedbackForSession` | `pending` until written, then the feedback | 404 |

Every response has the same envelope: `{ success: boolean, data?: …, message?: string }`.

## 7. The database (`apps/api/prisma/schema.prisma`)

| Table | Key columns | Meaning |
|---|---|---|
| `users` | `id`, `supabaseUserId` (unique), `email` (unique), `name`, `passwordHash` | Our copy of each Supabase user. `passwordHash` is always the placeholder `'supabase-auth'`: passwords live only in Supabase |
| `Resume` | `userId`, `fileName`, `extractedText`, `parsedProfile` (JSON as text) | Each analysed upload; the newest one is "the" profile |
| `sessions` | `userId`, `role`, `status` (`LIVE`/`ENDED`), `startedAt`, `endedAt` | One interview |
| `turns` | `sessionId`, `turnIndex`, `speaker` (`AI`/`CANDIDATE`), `text`, `timestampSec` | The transcript, one row per turn. Audio is never stored |
| `jobs` | `type`, `sessionId` (optional), `payload`, `status` (`pending`/`processing`/`completed`/`failed`), `attempts`, `lockedBy`, `lockedAt`, `lastError` | The background job queue (Postgres instead of Redis) |
| `feedback` | `sessionId` (unique), `status` (`pending`/`ready`/`failed`), `summary`, `scores` (JSON) | One evaluation per session |

**Migrations** (`prisma/migrations/`), applied in order by `prisma migrate deploy`:
1. `20260925182010_init_postgresql`: users and Resume
2. `20260926064512_ls2_ls4_sessions_turns_jobs`: sessions, turns, jobs
3. `20260928090000_fb2_job_queue_and_feedback`: queue columns and the feedback table

**Rule:** never edit a committed migration. Change `schema.prisma`, then create a new migration
in the same PR, and run `bun run --filter @interview/api db:generate` to refresh the typed
client. The `postinstall` script also runs `prisma generate` on every `bun install`.

## 8. API, file by file (`apps/api/src`)

**Entry points**
- `server.ts`:
  - creates the Express app; CORS allows only `WEB_ORIGIN`, with the Vite dev server as the
    default
  - parses JSON bodies and mounts the routers under `/api/auth`, `/api/resume` and
    `/api/sessions`
  - starts listening and starts one worker, except in tests (`NODE_ENV=test`)
- `worker.ts`: `runWorker(id)` loops forever over `processNextJob` for `session.ended` jobs. When
  idle it sleeps for 1 second; it logs errors and keeps going. `bun run worker` starts extra
  workers as separate processes.

**Middleware and utils**
- `middleware/auth.ts`: the token check (step 2). The only place that decides who you are.
- `utils/db.ts`: the single shared `PrismaClient`.
- `utils/resource.ts`: `NotFoundError`. Services throw it, and controllers turn it into 404.
- `types/index.ts`:
  - `CandidateProfile`, the shape of a parsed resume
  - `AuthUser`
  - adds the `user` field to Express's `Request` type
- `constants/roles.ts`: `isValidRoleId`, checked against `ROLES` from contracts.

**Routes and controllers.** Routes only wire URL → `authenticate` → controller. Controllers read
`req.params`/`req.body`, call one service, and map service errors to status codes:
- `auth.routes.ts` / `auth.controller.ts`: `me` and `account` deletion.
- `resume.routes.ts` / `resume.controller.ts`: upload (multer keeps the file in memory, 5 MB
  limit), latest, by id.
- `session.routes.ts` / `session.controller.ts`: roles, create, get, turns, end, voice token.
- `feedback.routes.ts` / `feedback.controller.ts`: get feedback. It is mounted under
  `/api/sessions` too.

**Services (the real logic)**
- `session.service.ts`:
  - `createSession`
  - `getOwnedSession`: always queries `id AND userId`. This one function gives every endpoint
    its 404-not-403 behaviour.
  - `listTurns`, `addTurn` (ownership, LIVE check, timestamp check)
  - `endSession` (the transaction)
  - the error classes `InvalidRoleError`, `InvalidTimestampError` and `SessionEndedError`
- `job-queue.service.ts`:
  - `enqueueJob`
  - `claimNextJob` (`FOR UPDATE SKIP LOCKED`, stale-lock recovery, `MAX_ATTEMPTS = 3`)
  - `completeJob`, `failJob`
  - `processNextJob`: claim → run the handler → mark completed, or failed and rethrow
- `feedback.service.ts`:
  - `saveFeedback`: an upsert, so a retry overwrites instead of duplicating
  - `getFeedbackForSession`: ownership, then `pending` if there's no row yet
  - `handleSessionEnded`: the job handler
- `evaluator.service.ts`: **the only file that calls the evaluation LLM.**
  - `RUBRIC`, `buildEvaluationPrompt`, `evaluateTranscript`
  - the timeout, and the Zod validation of the reply
  - the model is `GEMINI_EVAL_MODEL`, otherwise the pinned `gemini-3.8-flash`, via the `@google/genai` SDK
- `voice-provider.service.ts`: **the only file that talks to the voice provider.**
  `mintVoiceToken` POSTs to Google's `auth_tokens` endpoint with the server's key. The token
  allows one session, expires in 30 minutes, and has to be used within 2.
- `pdf.service.ts`: PDF bytes → text (`pdf-parse`).
- `gemini.service.ts`: resume text → `CandidateProfile` via Gemini (JSON output). If there's no
  key, or the call fails, it falls back to…
- `heuristic.service.ts`: a rule-based resume parser: a skills list, section headings and
  regexes for email and phone.
- `question.service.ts`: a server copy of the interview question script. Only a test uses it
  today; see section 16.

**Prompts.** `prompts/resume.prompt.ts` is the resume-parsing prompt. It asks for JSON, and
tells the model to extract only what's present and use empty values for missing fields.

## 9. Web, file by file (`apps/web/src`)

**Entry and routing**
- `main.tsx`: mounts `<App />`.
- `App.tsx`: providers (`ThemeProvider`, `AuthProvider`), the `Navbar`, and the route table:

| Path | Screen | Protected |
|---|---|---|
| `/` | redirects to `/dashboard` | – |
| `/login` | `pages/Login.tsx` | no |
| `/dashboard` | `pages/Dashboard.tsx` | yes |
| `/profile` | `pages/Profile.tsx` | yes |
| `/role-picker`, `/interview/new` | `NewInterview` (role picker) | yes |
| `/interview/:sessionId` | `pages/InterviewRoom.tsx` | yes |
| `/interview/:sessionId/feedback` | `features/feedback/ResultsPage.tsx` | yes |

- `components/ProtectedRoute.tsx`: shows "Loading…" while the session is restored, sends
  signed-out users to `/login`, and otherwise renders the page.
- `components/Navbar.tsx`: links (Dashboard, Profile), sign-out, theme toggle.

**State**
- `context/AuthContext.tsx`: the signed-in user, and `signIn`, `signUp`, `signOut`,
  `deleteAccount`.
  - It restores the Supabase session on load, and listens for sign-in and sign-out events.
  - After signing in it calls `GET /api/auth/me`, so the user's row exists on our side.
  - If Supabase requires email confirmation, sign-up returns without a session, and the user is
    asked to confirm first.
- `context/ThemeContext.tsx`: light/dark theme, saved in `localStorage`.

**lib**
- `lib/supabase.ts`: creates the browser Supabase client from `VITE_SUPABASE_URL` and
  `VITE_SUPABASE_ANON_KEY`. `isSupabaseConfigured` warns when they're missing.
- `lib/api.ts`: **every API call goes through here.** It's an axios client with the token
  interceptor, with one function per endpoint: resume, me, account, roles, sessions, turns,
  end, feedback. `getFeedback` and the role picker validate responses with the contracts.
- `lib/voiceAdapter.ts`: the `VoiceSessionAdapter` interface (`connect`, `speakAiQuestion`,
  `startListening`, `finishCandidateTurn`, `setMuted`, `disconnect`), plus today's
  implementation, `BrowserWebSpeechVoiceAdapter`.
  - It shows a microphone level meter, and it treats a pause in speech as the end of the
    candidate's turn.
  - `InterviewRoom` only talks to the interface. That's why the Gemini Live adapter (V1) can
    replace it without rewriting the room.
- `lib/questionProvider.ts`: the per-role question scripts and `getNextQuestion`, which never
  repeats a question and quotes the candidate's last answer in question 2. With Gemini Live,
  the AI asks the questions itself, and this becomes the fallback.

**Pages**
- `Login.tsx`: sign in / sign up forms, error messages, redirects.
- `Dashboard.tsx`: greeting, resume upload and analysis, "start interview", quick stats.
- `Profile.tsx`: the parsed resume profile (skills, education, projects…), and deleting the
  account.
- `NewInterview.tsx`: role cards → `createSession` → the interview room.
- `InterviewRoom.tsx`:
  - the live screen: timer, AI and candidate states, mute, "finish speaking", replay question
  - the transcript list, the end button, the text fallback
  - it posts every turn, and moves to the results screen on end
- `RolePicker.tsx`: a small re-export kept for the old route name.

**features/**: newer code grouped by feature, imported only through each `index.ts`.
- `feedback/`:
  - `ResultsPage`: the route component
  - `ResultsScreen`: three states, pending / ready / failed
  - `useFeedback`: the polling hook
  - `feedbackApi`: the seam that tests replace
- `sessions/`: re-exports the role picker and interview room.
- `identity/`, `profile/`: placeholders for future feature code.

**`types/index.ts`:** web-only types (resume, API envelopes, voice states). Session and Turn
types come from `@interview/contracts`.

## 10. Contracts (`packages/contracts/src/index.ts`)

| Export | Used for |
|---|---|
| `Role`, `RoleList`, `ROLES` | The one role list (STUB until roles move into the database) |
| `Session`, `SessionStatus`, `Turn`, `TurnSpeaker` | Session and transcript shapes on the web side |
| `VoiceToken` | The voice-token response |
| `Feedback`, `FeedbackStatus`, `FeedbackScore` | The feedback response, and the evaluator's output check |

Each export is a Zod schema plus a TypeScript type of the same name. `Feedback.parse(x)`
validates at runtime, and the type `Feedback` is used at compile time. A shape that both apps
use goes here, in the same PR as the code that needs it.

## 11. Authentication, in detail

- **Passwords never reach our API.** Supabase stores them and runs sign-in.
- **Two kinds of key.** The **anon (publishable) key** is in the browser and is public by
  design: it only allows what Supabase's rules allow. The **service-role key** is server-only
  and must never appear in `apps/web` or a `VITE_` variable.
- **The API trusts only the token.** It validates the token with Supabase on every protected
  request, and takes the user id from it, never from the request body.
- **Our users table.** It exists so our own tables (sessions, resumes) can reference a user with
  a normal foreign key. Its link to Supabase is `supabaseUserId`.
- **The browser never queries Supabase tables directly.** All data goes through the API, so
  every access rule lives in one place: the services.

## 12. Voice

- **Today:** the browser's speech synthesis and recognition, behind `VoiceSessionAdapter`, with
  scripted questions. It works in Chrome and Edge, and the text fallback covers other browsers.
- **Next (Sprint 2):**
  - V1: a `GeminiLiveVoiceAdapter`. The browser asks our API for a token
    (`POST /api/sessions/:id/voice-token`), then streams audio directly to Gemini Live over a
    WebSocket. Gemini returns the AI's audio and transcriptions of both speakers, which become
    turns as today.
  - V2: the interviewer's instructions (role, structure, time limit) are built on the server and
    locked into the token, so the browser can't change them.
  - P1: those instructions also include the candidate's resume.
- **Why audio skips our server:** the 2-second response target (NFR-01). A hop through our API
  would add delay, and the key stays private because the browser only has a single-use token.
  The research spike is on the `sessions/voice-spike` branch.

## 13. Feedback pipeline, in detail

- **Why a queue at all?** The LLM can take seconds or fail. Doing it inside the "end" request
  would make ending slow, and lose work on a crash. A job row in the same transaction as
  "end" guarantees the work is recorded.
- **Why Postgres and not Redis?** One less service to run. `FOR UPDATE SKIP LOCKED` gives
  safe concurrent workers on plain Postgres.
- **The job's lifecycle:** `pending` → `processing` (locked, attempts + 1) → `completed`, or
  `failed` with `lastError` saved. If the worker dies, the job is retried after 5 minutes, up to
  3 attempts.
- **The feedback row's lifecycle:** none (the API reports `pending`) → `ready` or `failed`.
- **The rubric** is in `evaluator.service.ts` (`RUBRIC`). Changing it needs the lead's
  approval. Per-role rubrics are a later item (OI-3).

## 14. Tests

Run everything with `bun run test` from the repository root.

| File | Covers |
|---|---|
| `api/__tests__/app.test.ts` | Auth middleware (missing, malformed, invalid, valid token) and the 404-not-403 helper |
| `api/__tests__/auth.test.ts` | Linking a Supabase user to our users table, `/me`, account deletion |
| `api/__tests__/session.test.ts` | LS2 and LS4: valid and invalid role, ownership 404s, storing turns, future timestamp rejected, 409 after end, end-in-one-transaction, idempotent end, the question script |
| `api/__tests__/voice-token.test.ts` | LS3: own session → token, others → 404, ended → 409, provider errors hidden; the token request's shape |
| `api/__tests__/evaluator.test.ts` | FB4: valid output, prompt contents, timeout, provider error, invalid JSON, out-of-range or missing categories, empty transcript |
| `api/__tests__/feedback.test.ts` | FB3: handler writes ready or failed and never touches turns; the endpoint's pending, ready, 404 and 401 |
| `api/__tests__/job-queue.test.ts` | FB2 against a **real Postgres**: claim, two workers never share a job, stale retry then fail, handler failure, one feedback row per session. It runs only when `TEST_DATABASE_URL` is set; CI sets it |
| `web/src/features/feedback/ResultsScreen.test.tsx` | FB1: pending, ready, failed, and polling until ready |

Most API tests replace Supabase and Prisma with mocks (`vi.mock`), so they run without a
network. No test calls Gemini.

## 15. CI and configuration

**CI (`.github/workflows/ci.yml`)**, on every PR and every push to `main`:
1. Install with the exact lockfile; this also generates the Prisma client.
2. Typecheck all three packages.
3. Apply the migrations to a throwaway Postgres container.
4. Run all tests, including the real-database queue tests.
5. Build the web app.

A red check means don't merge.

**Environment variables.** Copy the `.env.example` files.

| Variable | App | Secret? | Meaning |
|---|---|---|---|
| `PORT` | api | no | API port (3000) |
| `WEB_ORIGIN` | api | no | The web app's URL, allowed by CORS |
| `DATABASE_URL` | api | **yes** | Postgres connection string |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | api | key: **yes** | Token checking, account deletion |
| `GEMINI_API_KEY` | api | **yes** | Evaluation, resume parsing, voice tokens |
| `GEMINI_EVAL_MODEL` | api | no | Optional model override |
| `WORKER` | api | no | `off` = don't run a worker inside the API |
| `TEST_DATABASE_URL` | api (tests) | – | A disposable DB for the queue tests |
| `VITE_API_URL` | web | no | The API base URL, ending in `/api` |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | web | no (public) | The browser's Supabase client |

`VITE_` values are copied into the JavaScript at **build** time, so changing one means
rebuilding. Anything in them is visible to every visitor.

**Everyday commands**

```bash
bun install                                   # dependencies + Prisma client
bun run dev                                   # API :3000 (with a worker) + web :5173
bun run typecheck                             # tsc in every package
bun run test                                  # all tests
bun run --filter @interview/api db:migrate    # apply migrations to DATABASE_URL
bun run --filter @interview/api worker        # an extra worker process
```

Deployment (Google Cloud) is described in [sprint-2.md](sprint-2.md).

## 16. Known gaps and leftovers (be honest about these)

- **Voice:** live voice still uses browser speech and scripted questions until V1 and V2 land.
- **Account deletion** fails for users who have sessions (foreign keys are RESTRICT). A1 fixes it.
- **Duplicate question script:** `apps/api/src/services/question.service.ts` duplicates the
  web's `lib/questionProvider.ts`, and only a test uses it. Remove one copy when V2 moves
  questions to the server.
- **Leftovers from the slices:**
  - `User.passwordHash` is a leftover column, always `'supabase-auth'`.
  - `Resume.parsedProfile` stores JSON as text.
  - `@types/pdf-parse` is an unused dependency.
- **Types:** neither app extends the strict `tsconfig.base.json` yet (about 60 small fixes).
  There's no ESLint or Prettier.
- **No protected `main` and no CODEOWNERS:** protection needs GitHub Pro or a public repo.
- **Requirements without real users:** every requirement is still evidence class B or C. None
  comes from a recorded interview with a real user.

## 17. Likely evaluation questions

**"Why is the voice not going through your server?"**
Latency (NFR-01: under 2 s) and cost. The server only mints a single-use, short-lived token, so
the API key never reaches the browser (NFR-09).

**"What happens if the LLM is down when an interview ends?"**
The session still ends, and the transcript is safe. The job is marked failed with the error, and
the results screen shows "failed". Retry (F2) queues it again without re-interviewing (NFR-04).

**"How do you stop two workers evaluating the same interview?"**
`SELECT … FOR UPDATE SKIP LOCKED` in a transaction. The first worker locks the row, and others
skip it. A CI test runs two workers on a real Postgres and checks that no job is claimed twice.

**"How do you stop one user reading another user's interview?"**
Every query filters by `id AND userId` (`getOwnedSession`), and the user id comes from the
verified token, never the request. Another user's session returns 404, so it doesn't even
reveal that the id exists (FR-27).

**"Why ending + job in one transaction?"**
So there's never an ended session without a feedback job, or a job for a session that didn't
end.

**"Why Zod contracts?"**
One definition gives compile-time types and runtime validation in both apps. If the API
changes a shape, the typecheck fails in every place that uses it.

**"How do you know it works?"**
48 API tests and 4 web tests, plus 5 queue tests on a real Postgres in CI. CI runs on every PR,
and a PR can't be merged with a red check by team rule.

**"What did each person build?"**
See the task tables in `docs/sprint-1.md` and `docs/sprint-2.md`. Each PR names its task and
author, and ported PRs credit the original authors as co-authors.

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
| Ephemeral token | A short-lived, limited-use credential minted by our server for the browser |
| STUB | Placeholder code, marked in a comment with its owner, until the real thing lands |
| ADR | Architecture Decision Record: a short note on why a hard-to-reverse choice was made |
