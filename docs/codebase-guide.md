# Codebase guide

This explains the whole project to someone who has never opened it. After reading it you
should be able to run the app, find the code for any feature, explain why it is built that
way, and answer an evaluator's questions about it.

Read it in order the first time. Sections 1–4 are the big picture, 5 follows one interview
through the code, 6–13 go file by file, and 14–16 cover tests, CI, configuration and the
known gaps. Section 17 is a list of likely evaluation questions with answers, and section 18
has the questions each team should be ready for, by slice.

---

## 1. What the product does

A candidate signs in, picks a job role, and holds a **spoken mock interview** with an AI
interviewer. When they end it, an LLM reads the transcript and writes **structured
feedback**: a short summary, and for each of the role's three rubric categories a 1–5 score,
a comment, strengths, things to improve and a quote from the candidate's answers. Candidates
can upload a PDF resume, which is parsed into a structured profile and linked to each new
session (the server builds it into the interviewer's briefing, which the room doesn't use
yet), and they can look back at past interviews on the History page.

It is a practice tool, not a hiring platform: there are no employer accounts.

## 2. The big picture

```
 Browser (React app, apps/web)
   │  1. sign in ──────────────────────────────> Supabase Auth  (issues a JWT access token)
   │  2. every API call carries "Authorization: Bearer <token>"
   ▼
 API (Express on Bun, apps/api) ──── Prisma ────> Postgres (Supabase)
   │   routes → services                            users, Resume, sessions, turns, jobs, feedback
   │
   ├── feedback worker (same process): claims "session.ended" jobs from the jobs table
   │        └──> Gemini flash: scores the transcript against the role's rubric (evaluator.service.ts)
   ├── next-question endpoint: Gemini flash writes the next question (interviewer.service.ts)
   └── voice token endpoint: asks Google for a single-use token with the interviewer's
                                   │  briefing locked in (voice-provider.service.ts)
 Browser ── audio over WebSocket ──┘──> Gemini Live (adapter built, not wired in; today: browser speech)
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
  workflows/ci.yml            CI: typecheck, migrate a throwaway DB, test, build web; build and start the API image
  workflows/deploy.yml        on merge to main: migrate, deploy the API, publish the web app (off until enabled)
  pull_request_template.md    the checklist every PR fills in
  ISSUE_TEMPLATE/task.yml     the form every task issue is made from
docs/
  final-sprints.md            the current plan and owners (sprint-1/2/3.md are the earlier plans)
  requirements.md             the requirements (FR-, NFR-, DR- ids) and traceability matrix
  evaluation-benchmark.md     how to benchmark the evaluator against real Gemini
  adr/                        architecture decision records (why we chose X)
  codebase-guide.md           this file
Dockerfile, firebase.json     the API's Cloud Run image; Firebase Hosting config for the web app
spike/                        the Gemini Live prototype; reference only, not part of the apps
packages/contracts/           @interview/contracts — Zod schemas + types shared by API and web
apps/api/                     @interview/api — Express 5 + Prisma 7, run by Bun
  prisma/schema.prisma        the database tables
  prisma/migrations/          the history of schema changes, applied in order
  prisma.config.ts            where the Prisma CLI finds the schema, migrations and DATABASE_URL
  scripts/                    evaluate.ts (score one transcript), bench.ts (evaluator benchmark)
  src/server.ts               creates the Express app, mounts routes, starts the worker
  src/worker.ts               the background feedback worker loop
  src/routes/                 one file per resource: URL → authenticate → handler
  src/services/               the real work: database, Gemini, the job queue
  src/middleware/auth.ts      checks the Supabase token on every protected route
  src/db.ts, src/errors.ts    the Prisma client; NotFoundError and getUserResourceOr404
  src/generated/prisma/       the generated Prisma client (made by `prisma generate`, not committed)
  src/__tests__/              Vitest + Supertest tests, and the transcript fixtures
apps/web/                     @interview/web — React 19 + Vite + react-router
  src/main.tsx, App.tsx       entry point and the route table
  src/screens/<screen>/       one folder per screen: its components, hooks and tests
  src/components/             Navbar, ProtectedRoute
  src/context/                AuthContext (who is signed in), ThemeContext (light/dark)
  src/lib/                    api.ts (every API call), supabase.ts, the voice adapters, questionProvider.ts
  src/types/                  web-only types (most shared ones come from contracts)
package.json, bun.lock        the workspace: scripts dev / typecheck / test, one lockfile
tsconfig.base.json            shared strict TypeScript settings
```

## 4. Tech stack, and why

| Piece | Choice | Why |
|---|---|---|
| Language | TypeScript everywhere | One language for the whole team; types catch mistakes between API and web |
| Runtime, package manager | Bun | Fast installs, runs TypeScript directly, loads `.env` itself, one lockfile ([ADR-0009](adr/0009-bun-runtime.md)) |
| API framework | Express 5 | What the teams built in; widely known ([ADR-0008](adr/0008-express-and-prisma.md)) |
| Database access | Prisma 7 (with the `pg` driver adapter) | Typed queries, migrations as files ([ADR-0008](adr/0008-express-and-prisma.md)) |
| Database, sign-in | Supabase (Postgres + Auth) | Managed Postgres, email/password and Google sign-in without running our own |
| Web | React 19, Vite, react-router | Standard; Vite gives fast dev builds |
| Shared shapes | Zod 4 | Runtime validation and TypeScript types from one definition |
| LLM | Google Gemini | One provider for evaluation, questions, resume parsing and live voice |
| Tests | Vitest (+ Supertest, Testing Library, jsdom) | Same runner in both apps |
| CI, hosting | GitHub Actions; Cloud Run (API), Firebase Hosting (web) | Runs on every PR; deploys on merge to `main` |

**Bun runs the code but doesn't check types.** That's why `bun run typecheck` (the TypeScript
compiler, `tsc`) is required before every PR, and CI runs it.

## 5. One interview, end to end

Follow these steps with the files open; it's the fastest way to learn the codebase.

**Step 1 — Sign in.** `screens/login/Login.tsx` calls `signIn` (or `signInWithGoogle`) from
`context/AuthContext.tsx`, which calls Supabase directly from the browser. Our API never sees
the password. Supabase returns a session with an **access token** (a JWT).

**Step 2 — Every request is authenticated.**
- *Browser:* `lib/api.ts` creates an axios client. Its interceptor reads the current
  Supabase session and adds `Authorization: Bearer <token>` to every request.
- *API:* `middleware/auth.ts` runs before each protected route.
  1. It asks Supabase whether the token is valid (`supabase.auth.getUser(token)`). Invalid →
     **401**.
  2. It finds our own `users` row by `supabaseUserId`. If there isn't one, it links an
     existing row with the same email, or creates one.
  3. It puts `{ id, supabaseUserId, email, name }` on `req.user`. Every later step uses
     `req.user.id`, never an id sent by the browser.

**Step 3 — Pick a role, create a session (LS2).**
- *Browser:* `screens/new-interview/NewInterview.tsx` shows `ROLES` from
  `@interview/contracts`, refreshed from `GET /api/sessions/roles`, and says which resume will
  be used ("Using resume: …" or "No resume uploaded").
- *API:*
  1. Choosing a role calls `POST /api/sessions` with `{ roleId }`.
  2. `session.service.ts → createSession` checks the id against `ROLES`. Unknown → **400**.
  3. It inserts a `sessions` row (`status = LIVE`), linked to the user's newest resume
     (`resumeId`, or none).
  4. The browser navigates to `/interview/:sessionId`.

**Step 4 — The interview (LS4).** `screens/interview-room/` is the biggest screen:
`InterviewRoom.tsx` lays it out and `useInterview.ts` holds the logic.
- *Setup:* it loads the session (`GET /api/sessions/:id`) and creates a voice adapter
  (`createVoiceSessionAdapter` in `lib/voiceAdapter.ts`).
- *Today's voice:* `BrowserWebSpeechVoiceAdapter` uses the browser's own speech synthesis
  (the AI's voice) and speech recognition (the candidate's words).
- *Today's questions:* they come from a fixed per-role script in `lib/questionProvider.ts`
  (`DeterministicQuestionProvider`). The second question quotes something the candidate said.
- *Each finished turn:* `postTurn` sends `{ speaker: 'AI' | 'CANDIDATE', text }` to
  `POST /api/sessions/:id/turns`.
- *Checks (`routes/sessions.ts`, `addTurn`):* a bad `speaker` or empty `text` is **400**, someone else's session
  **404**, an ended one **409**. The **server** sets `timestampSec` and `turnIndex`, so a client
  can't invent or reorder turns. Turns are stored one by one, so a dropped connection loses
  nothing already said.
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
2. It calls `job-queue.service.ts → processNextJob`, and sleeps 1 second whenever there's
   nothing to do.
3. `claimNextJob` runs `SELECT … FOR UPDATE SKIP LOCKED` inside a transaction. The row is
   locked, and any other worker skips locked rows, so **two workers never get the same job**.
   It marks the job `processing` and counts an attempt.
4. The handler, `feedback.service.ts → handleSessionEnded`, loads the session and its turns and
   calls `evaluator.service.ts → evaluateTranscript` with the session's role:
   - It builds a prompt with the role, **that role's rubric** (`rubrics.ts`) and the transcript.
   - It calls Gemini with **structured output** (`evaluationSchema`), which limits the
     categories to the rubric's, and a **12-second timeout** (inside the 15-second budget,
     NFR-03).
   - It validates the reply with Zod: each score is an integer 1–5 with a comment, strengths,
     improvements and a quote, and every rubric category must appear exactly once.
5. On success → `saveFeedback(status 'ready')`, and the job becomes `completed`.
6. On failure → `saveFeedback(status 'failed')` with the reason in the `error` column, and the
   job becomes `failed` with `lastError`. The turns are never touched (NFR-04).
7. A job stuck in `processing` for 5 minutes (a crashed worker) is retried up to 3 times, then
   marked failed.

**Step 7 — Results (FB1).** `screens/results/ResultsScreen.tsx` reads the session id from the
URL. `useFeedback` (in `useFeedback.ts`) calls `GET /api/sessions/:id/feedback` straight away,
then every 3 seconds while the status is `pending`, and stops on `ready` or `failed`; after 60
seconds it adds "This is taking longer than usual". `useTurns` loads the transcript. The
screen shows "preparing", the summary and per-category scores (comment, strengths, to improve,
quote), or the failure with a **Try again** button (`POST /api/sessions/:id/feedback/retry`,
then polling restarts). Below that come the transcript and **Delete interview**, which asks
for confirmation, calls `DELETE /api/sessions/:id` and goes to `/history`.

**Step 8 — History.** `screens/history/HistoryPage.tsx` calls `GET /api/sessions` and lists
your interviews newest first, each with its feedback status, an "ended early" badge and a link
to its results.

## 6. API reference (every route)

Every `/api/...` route requires a Supabase token, otherwise **401**. "Yours" means
another user's resource answers **404, never 403** (FR-27), so nobody can even tell whether an
id exists. Handlers live in `routes/<resource>.ts`.

| Method and path | Route file → service | What it does | Errors |
|---|---|---|---|
| `GET /health` | `server.ts` | Liveness check, no auth | – |
| `GET /api/auth/me` | `auth.ts` | Your app user (and links it on first call) | 401 |
| `DELETE /api/auth/account` | `auth.ts` | Deletes your user row (resumes, sessions and everything under them cascade), then your Supabase identity; 204 | 401; 500 if the Supabase step fails |
| `POST /api/resume/analyze` | `resume.ts` → pdf, gemini services | Upload a PDF (field `resume`, max 5 MB) → text → structured profile → saved | 400 no file / not a PDF / no text |
| `GET /api/resume/latest` | `resume.ts` | Your newest analysed resume | 404 |
| `GET /api/resume/:id` | `resume.ts` | One of your resumes | 404 |
| `GET /api/sessions/roles` | `sessions.ts` | The role list (`ROLES`) | – |
| `GET /api/sessions` | `sessions.ts` → `listSessions` | Your sessions, newest first, each with `feedbackStatus` and `endedEarly` | – |
| `POST /api/sessions` | `sessions.ts` → `createSession` | Start a session for `{ roleId }`, linked to your newest resume; 201 | 400 missing or unknown role |
| `GET /api/sessions/:id` | `sessions.ts` → `getOwnedSession`, `listTurns` | Your session with its turns | 404 |
| `GET /api/sessions/:id/turns` | `sessions.ts` → `listTurns` | Your session's turns in order | 404 |
| `POST /api/sessions/:id/turns` | `sessions.ts` → `addTurn` | Store one turn `{ speaker, text }`; the server sets the timestamp; 201 | 400 bad speaker / empty text, 404, 409 ended |
| `POST /api/sessions/:id/end` | `sessions.ts` → `endSession` | End it and queue the feedback job (one transaction) | 404 |
| `DELETE /api/sessions/:id` | `sessions.ts` → `deleteSession` | Delete your session; its turns, jobs and feedback cascade | 404 |
| `POST /api/sessions/:id/voice-token` | `sessions.ts` → `briefingFor`, `mintVoiceToken` | Single-use Gemini Live token with the session's briefing locked in | 404, 409 ended, 503 provider timeout, 500 provider failure (details only in the server log) |
| `POST /api/sessions/:id/next-question` | `sessions.ts` → `generateNextQuestion` | Gemini writes the next interviewer question and it is saved as an AI turn | 404, 409 ended, 503 after 15 s |
| `GET /api/sessions/:id/feedback` | `feedback.ts` → `getFeedbackForSession` | `pending` until written, then the feedback | 404 |
| `POST /api/sessions/:id/feedback/retry` | `feedback.ts` → `retryFeedbackEvaluation` | Set failed feedback back to `pending` and queue a new job (one transaction) | 404, 409 unless failed |

Every response has the same envelope: `{ success: boolean, data?: …, message?: string }`.
An unknown `/api` path gets a JSON 404, and an error no handler caught (a malformed JSON body,
a file over the size limit) gets a JSON 400 or 500 without a stack trace (`server.ts`).

## 7. The database (`apps/api/prisma/schema.prisma`)

| Table | Key columns | Meaning |
|---|---|---|
| `users` | `id`, `supabaseUserId` (unique), `email` (unique), `name` | Our copy of each Supabase user. Passwords live only in Supabase |
| `Resume` | `userId`, `fileName`, `extractedText`, `parsedProfile` (JSON as text) | Each analysed upload; the newest one is "the" profile |
| `sessions` | `userId`, `resumeId` (optional), `role`, `status` (`LIVE`/`ENDED`), `startedAt`, `endedAt` | One interview, and the resume it was tailored to |
| `turns` | `sessionId`, `turnIndex`, `speaker` (`AI`/`CANDIDATE`), `text`, `timestampSec` | The transcript, one row per turn. Audio is never stored |
| `jobs` | `type`, `sessionId` (optional), `payload`, `status` (`pending`/`processing`/`completed`/`failed`), `attempts`, `lockedBy`, `lockedAt`, `lastError` | The background job queue (Postgres instead of Redis) |
| `feedback` | `sessionId` (unique), `status` (`pending`/`ready`/`failed`), `summary`, `scores` (JSON), `error` | One evaluation per session. `error` stays on the server |

Deleting a user cascades to their resumes and sessions; deleting a session cascades to its
turns, jobs and feedback. Deleting a resume only clears `sessions.resumeId`.

**Migrations** (`prisma/migrations/`), applied in order by `prisma migrate deploy`:
1. `20260925182010_init_postgresql`: users and Resume
2. `20260926064512_ls2_ls4_sessions_turns_jobs`: sessions, turns, jobs
3. `20260928090000_fb2_job_queue_and_feedback`: queue columns and the feedback table
4. `20261030204206_fr28_account_deletion_cascade`: cascading deletes; drops `users.passwordHash`
5. `20261102132644_fr08_fr09_session_resume_link`: `sessions.resumeId`
6. `20261107100000_add_feedback_error`: `feedback.error`

**Rule:** never edit a committed migration. Change `schema.prisma`, then create a new migration
in the same PR against a **local** Postgres (never run `prisma migrate dev` or `reset` against
the shared Supabase database; see `sprint-3.md` §6), and run
`bun run --filter @interview/api db:generate` to refresh the typed client. The `postinstall`
script also runs `prisma generate` on every `bun install`.

## 8. API, file by file (`apps/api/src`)

**Entry points**
- `server.ts`:
  - creates the Express app; CORS allows only `WEB_ORIGIN`, with the Vite dev server as the
    default
  - parses JSON bodies and mounts the routers under `/api/auth`, `/api/resume` and
    `/api/sessions`; adds the JSON 404 and the last-resort error handler
  - starts listening and starts one worker, except in tests (`NODE_ENV=test`) or with
    `WORKER=off`. It doesn't load dotenv: Bun reads `apps/api/.env` itself.
- `worker.ts`: `runWorker(id)` loops over `processNextJob` for `session.ended` jobs. When
  idle it sleeps for 1 second; it logs errors and keeps going. `bun run worker` starts extra
  workers as separate processes.

**Middleware and shared code**
- `middleware/auth.ts`: the token check (step 2). The only place that decides who you are.
- `db.ts`: the single shared `PrismaClient`, on the `pg` driver adapter.
- `errors.ts`: `NotFoundError`, and `getUserResourceOr404`, which turns a `null` query result
  into a `NotFoundError`. Routes turn that error into 404.
- `types/index.ts`:
  - `CandidateProfile`, the shape of a parsed resume
  - `AuthUser`
  - adds the `user` field to Express's `Request` type
- `data/resources.ts`: a curated list of learning resources by topic. Only its test uses it so
  far.

**Routes.** One file per resource. Each handler checks the input, calls a service, and maps
service errors to status codes:
- `auth.ts`: `me` and `account` deletion (calls Prisma and Supabase's admin API directly).
- `resume.ts`: upload (multer keeps the file in memory, 5 MB limit), latest, by id.
- `sessions.ts`: roles, list, create, get, turns, end, delete, voice token, next question.
- `feedback.ts`: get feedback and retry. It is mounted under `/api/sessions` too.

**Services (the real logic)**
- `session.service.ts`:
  - `isValidRoleId`, `createSession` (links the newest resume)
  - `getOwnedSession`: always queries `id AND userId`. This one function gives every endpoint
    its 404-not-403 behaviour.
  - `listSessions` (adds `feedbackStatus`, and `endedEarly` for sessions under
    `EARLY_END_THRESHOLD_MINUTES = 15`), `listTurns`, `addTurn` (ownership, LIVE check,
    server timestamp), `endSession` (the transaction), `deleteSession`
  - the error classes `InvalidRoleError` and `SessionEndedError`
- `job-queue.service.ts`:
  - `enqueueJob`
  - `claimNextJob` (`FOR UPDATE SKIP LOCKED`, stale-lock recovery, `MAX_ATTEMPTS = 3`)
  - `completeJob`, `failJob`
  - `processNextJob`: claim → run the handler → mark completed, or failed and rethrow
- `feedback.service.ts`:
  - `saveFeedback`: an upsert, so a retry overwrites instead of duplicating
  - `getFeedbackForSession`: ownership, then `pending` if there's no row yet
  - `handleSessionEnded`: the job handler
  - `retryFeedbackEvaluation`: in one transaction, moves a `failed` row back to `pending` and
    queues a new job. If no failed row was changed, it throws `FeedbackRetryConflictError`
    (409), so two retries at once queue only one job.
- `evaluator.service.ts`: **the only file that calls the evaluation LLM.**
  - `buildEvaluationPrompt`: the role, its rubric, STAR only for behavioural answers, and a
    request for strengths, improvements and a verbatim quote per category
  - `evaluationSchema(categories)`: Gemini's structured-output schema
  - `evaluateTranscript`: the empty-transcript check, the timeout, the Zod validation and the
    category check
  - the model is `GEMINI_EVAL_MODEL`, otherwise the pinned `gemini-3.8-flash`, via the
    `@google/genai` SDK
- `rubrics.ts`: three categories per role (`SOFTWARE_ENGINEER_RUBRIC`, `DATA_ANALYST_RUBRIC`,
  `BACKEND_DEVELOPER_RUBRIC`), `getRubric(roleId)` and `UnknownRoleError`.
- `briefing.service.ts`: `buildBriefing(input)` writes the interviewer's instructions (see
  "What is the briefing?" in section 18); `calculatePhaseTiming` splits the time limit
  (15 minutes by default) across the phases; `briefingFor(session)` passes the session's role
  and the summary of its linked resume (`resume-summary.ts → summarizeProfile`).
- `interviewer.service.ts`: `generateNextQuestion` asks Gemini (`GEMINI_EVAL_MODEL` or
  `gemini-3.8-flash`) for one question from the briefing and the transcript so far, with a
  15-second timeout (`InterviewerTimeoutError` → 503), cleans it, and saves it as an AI turn.
- `voice-provider.service.ts`: **the only file that talks to the voice provider.**
  `mintVoiceToken` POSTs to Google's `auth_tokens` endpoint with the server's key. The token
  allows one session, expires in 30 minutes, and has to be used within 2. It locks in the
  model (`GEMINI_LIVE_MODEL`, default `models/gemini-3.8-live`), audio replies, the briefing,
  transcription of both speakers, context compression and session resumption.
- `pdf.service.ts`: PDF bytes → text (`pdf-parse`).
- `gemini.service.ts`: resume text → `CandidateProfile` via Gemini (`GEMINI_RESUME_MODEL`,
  default `gemini-3.8-flash`, JSON output). If there's no key, or the call fails, it logs and
  falls back to…
- `heuristic.service.ts`: a rule-based resume parser: a skills list, section headings and
  regexes for email and phone.

**Prompts.** `prompts/resume.prompt.ts` is the resume-parsing prompt. It asks for JSON, and
tells the model to extract only what's present and use empty values for missing fields.

**Scripts.** `scripts/evaluate.ts` scores one transcript file with the real evaluator
(`--role` picks the rubric); `scripts/bench.ts` runs every fixture several times and checks
scores, latency and cost. See [evaluation-benchmark.md](evaluation-benchmark.md).

## 9. Web, file by file (`apps/web/src`)

**Entry and routing**
- `main.tsx`: mounts `<App />`.
- `App.tsx`: providers (`ThemeProvider`, `AuthProvider`), the `Navbar`, and the route table:

| Path | Screen | Protected |
|---|---|---|
| `/` | redirects to `/dashboard` | – |
| `/login` | `screens/login/Login.tsx` | no |
| `/dashboard` | `screens/dashboard/Dashboard.tsx` | yes |
| `/history` | `screens/history/HistoryPage.tsx` | yes |
| `/profile` | `screens/profile/Profile.tsx` | yes |
| `/new-interview` | `screens/new-interview/NewInterview.tsx` (role picker) | yes |
| `/interview/:sessionId` | `screens/interview-room/InterviewRoom.tsx` | yes |
| `/interview/:sessionId/feedback` | `screens/results/ResultsScreen.tsx` | yes |

- `components/ProtectedRoute.tsx`: shows "Loading…" while the session is restored, sends
  signed-out users to `/login`, and otherwise renders the page.
- `components/Navbar.tsx`: links (Dashboard, History, Profile), theme toggle, the user's email,
  Logout. Hidden when signed out.

**State**
- `context/AuthContext.tsx`: the signed-in user, and `signIn`, `signUp`, `signInWithGoogle`,
  `signOut`, `deleteAccount`.
  - It restores the Supabase session on load, and listens for sign-in and sign-out events.
  - After signing in it calls `GET /api/auth/me`, so the user's row exists on our side.
  - If Supabase requires email confirmation, sign-up returns without a session, and the user is
    asked to confirm first.
- `context/ThemeContext.tsx`: light/dark theme, saved in `localStorage`.

**lib**
- `lib/supabase.ts`: creates the browser Supabase client from `VITE_SUPABASE_URL` and
  `VITE_SUPABASE_ANON_KEY`. `isSupabaseConfigured` warns when they're missing.
- `lib/api.ts`: **every API call goes through here.** It's an axios client with the token
  interceptor, with one function per endpoint: resume, me, account, roles, sessions (list,
  create, get, delete), turns, end, voice token, feedback, retry. `getFeedback`,
  `retryFeedback` and the role picker validate responses with the contracts. There is no
  function for `next-question` yet.
- `lib/voiceAdapter.ts`: the `VoiceSessionAdapter` interface (`connect`, `speakAiQuestion`,
  `startListening`, `finishCandidateTurn`, `setMuted`, `sendText`, `disconnect`), today's
  implementation `BrowserWebSpeechVoiceAdapter`, and `createVoiceSessionAdapter`, which the
  room calls and which returns the browser adapter.
  - It shows a microphone level meter, and it treats a pause in speech as the end of the
    candidate's turn.
- `lib/geminiLiveAdapter.ts`: `GeminiLiveVoiceAdapter`, the same interface over Gemini Live
  (section 12), with `lib/audio.ts` for PCM conversion and playback. It keeps Gemini's
  session-resumption handle in `sessionStorage` and reconnects with a new token, up to 3
  times. The room doesn't use it yet.
- `lib/transcriptAccumulator.ts`: joins streamed transcript chunks into whole turns. Only its
  test uses it so far.
- `lib/questionProvider.ts`: the per-role question scripts and `getNextQuestion`, which never
  repeats a question and quotes the candidate's last answer in question 2.

**Screens** (one folder each under `screens/`)
- `login/`: sign in / sign up forms, "Continue with Google", error messages, redirects.
- `dashboard/`: greeting, resume upload and analysis, "start interview", profile status.
- `history/`: the list of past interviews (step 8), with an empty state that links to a new
  interview.
- `profile/`: the parsed resume profile (skills, education, projects…), and deleting the
  account.
- `new-interview/`: role cards and the resume line → `createSession` → the interview room.
- `interview-room/`:
  - `InterviewRoom.tsx` and its parts: `InterviewerCard` (the question, replay),
    `MicrophoneCard` (level, mute, "finish speaking"), `TypedAnswerBox` (the text fallback),
    `TranscriptPanel`
  - `useInterview.ts`: loads the session, connects the adapter, posts every turn, picks the
    next question, runs the timer, and ends the interview
- `results/`: `ResultsScreen.tsx` (step 7), and `useFeedback.ts` with the `useFeedback`
  polling hook and the `useTurns` transcript hook.

**`types/index.ts`:** web-only types (resume, API envelopes, voice states). Session and Turn
types come from `@interview/contracts`.

## 10. Contracts (`packages/contracts/src/index.ts`)

| Export | Used for |
|---|---|
| `Role`, `RoleList`, `ROLES` | The one role list (STUB until roles move into the database) |
| `Session`, `SessionStatus`, `Turn`, `TurnSpeaker` | Session and transcript shapes; `Session` also carries the optional `resumeId`, `turns`, `feedbackStatus` and `endedEarly` |
| `VoiceToken` | The voice-token response |
| `Feedback`, `FeedbackStatus`, `FeedbackScore` | The feedback response, and the evaluator's output check. A score has `category`, `score` (1–5), `comment`, `strengths`, `improvements` and `quote` |

The `feedback.error` column is deliberately not in the contract: the failure reason stays on
the server.

Each export is a Zod schema plus a TypeScript type of the same name. `Feedback.parse(x)`
validates at runtime, and the type `Feedback` is used at compile time. A shape that both apps
use goes here, in the same PR as the code that needs it.

## 11. Authentication, in detail

- **Passwords never reach our API.** Supabase stores them and runs sign-in, including
  "Continue with Google" (`signInWithOAuth`). Either way the API receives the same kind of token.
- **Two kinds of key.** The **anon (publishable) key** is in the browser and is public by
  design: it only allows what Supabase's rules allow. The **service-role key** is server-only
  and must never appear in `apps/web` or a `VITE_` variable.
- **The API trusts only the token.** It validates the token with Supabase on every protected
  request, and takes the user id from it, never from the request body.
- **Our users table.** It exists so our own tables (sessions, resumes) can reference a user with
  a normal foreign key. Its link to Supabase is `supabaseUserId`.
- **The browser never queries Supabase tables directly.** All data goes through the API, so
  every access rule lives in one place: the services and routes.

## 12. Voice

- **Today:** the room uses the browser's speech synthesis and recognition, behind
  `VoiceSessionAdapter`, with scripted questions. It works in Chrome and Edge, and the text
  fallback covers other browsers.
- **Built, not yet wired into the room:**
  - V2 and P1: the server builds the interviewer's briefing (with the resume summary) and
    locks it into the voice token, so the browser can't read or change it.
  - V1: `GeminiLiveVoiceAdapter`. It gets a token from `POST /api/sessions/:id/voice-token`,
    streams the microphone directly to Gemini Live over a WebSocket, plays the AI's audio,
    reports both speakers' transcripts, and stops playback when the candidate interrupts.
  - `POST /api/sessions/:id/next-question`: a server-side interviewer that writes each
    question with Gemini from the same briefing.
- **Why audio skips our server:** the 5-second response target (NFR-01). A hop through our API
  would add delay, and the key stays private because the browser only has a single-use token.
  The research prototype is in `spike/`.

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
  **Try again** moves `failed` back to `pending` and queues a new job.
- **The rubrics** are in `rubrics.ts`, three categories per role. Changing one needs the lead's
  approval. Gemini's structured output is limited to the role's categories, and the evaluator
  checks them again after parsing.

## 14. Tests

Run everything with `bun run test` from the repository root. API tests are in
`apps/api/src/__tests__/`; web tests sit next to the code they test.

| File | Covers |
|---|---|
| `app.test.ts` | Auth middleware (missing, malformed, invalid, valid token) and the 404-not-403 helper |
| `auth.test.ts` | Linking a Supabase user to our users table, `/me`, account deletion |
| `errors.test.ts` | Unknown `/api` path → JSON 404; malformed JSON → JSON 400 without a stack trace |
| `session.test.ts` | LS2 and LS4: valid and invalid role, resume link, the history list, ownership 404s, storing turns, server-set timestamp, 409 after end, end-in-one-transaction, idempotent end, delete |
| `voice-token.test.ts` | LS3: own session → token with the briefing (and resume), others → 404, ended → 409, provider errors hidden, timeout → 503; the token request's shape |
| `briefing.test.ts`, `resume-summary.test.ts` | Per-role briefings, timing, phases, optional sections, guardrails, `briefingFor`; the resume summary |
| `interviewer.test.ts`, `next-question.test.ts` | Generating and cleaning a question; the endpoint's 200, 404, 409, 401 and 503 |
| `evaluator.test.ts` | FB4: valid output, per-role rubrics, unknown role, prompt contents, structured-output schema, timeout, provider error, invalid JSON, out-of-range or missing categories, empty transcript, fixture shapes |
| `evaluate-cli.test.ts` | The `scripts/evaluate.ts` CLI: arguments, roles, loading transcripts, clear errors |
| `feedback.test.ts` | FB3: handler writes ready or failed and never touches turns; the endpoint's pending, ready, 404 and 401; retry (owner, 404, 409, concurrent retries) |
| `resources.test.ts` | The learning-resource list |
| `job-queue.test.ts` | FB2 against a **real Postgres**: claim, two workers never share a job, stale retry then fail, handler failure, one feedback row per session |
| `account-deletion.integration.test.ts`, `session-deletion.integration.test.ts` | The delete cascades, against a **real Postgres** |
| `screens/results/ResultsScreen.test.tsx` | FB1: pending, ready, failed, polling until ready, Try again, transcript states, delete |
| `screens/history/HistoryPage.test.tsx`, `screens/new-interview/NewInterview.test.tsx`, `screens/login/Login.test.tsx` | The history list; the resume line; the Google button |
| `lib/geminiLiveAdapter.test.ts`, `lib/audio.test.ts`, `lib/__tests__/transcriptAccumulator.test.ts` | The Live adapter (setup, audio, interruption, mute, resumption, reconnect limit) and its helpers |

The real-Postgres tests run only when `TEST_DATABASE_URL` is set; CI sets it. Most API tests
replace Supabase and Prisma with mocks (`vi.mock`), so they run without a network. No test
calls Gemini.

## 15. CI and configuration

**CI (`.github/workflows/ci.yml`)**, on every PR and every push to `main`, runs two jobs:
- `check`: install with the exact lockfile (this also generates the Prisma client), typecheck
  all three packages, apply the migrations to a throwaway Postgres container, run all tests
  (including the real-database ones), and build the web app.
- `docker`: build the API image from the root `Dockerfile`, start it, and check `/health` and
  that the Prisma engine loads.

A red check means don't merge.

**Deploy (`.github/workflows/deploy.yml`)**, on every push to `main` once the
`DEPLOY_ENABLED` repository variable is `true`: migrate, deploy the API to Cloud Run, check
`/health`, then build and publish the web app. Setup is described in [sprint-2.md](sprint-2.md).

**Environment variables.** Copy the `.env.example` files.

| Variable | App | Secret? | Meaning |
|---|---|---|---|
| `PORT` | api | no | API port (3000) |
| `WEB_ORIGIN` | api | no | The web app's URL, allowed by CORS |
| `DATABASE_URL` | api | **yes** | Postgres connection string |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | api | key: **yes** | Token checking, account deletion |
| `GEMINI_API_KEY` | api | **yes** | Evaluation, questions, resume parsing, voice tokens |
| `GEMINI_EVAL_MODEL`, `GEMINI_RESUME_MODEL`, `GEMINI_LIVE_MODEL` | api | no | Optional model overrides (feedback and next question; resume; Live). Production pins all three in `deploy.yml` |
| `WORKER` | api | no | `off` = don't run a worker inside the API |
| `TEST_DATABASE_URL` | api (tests) | – | A disposable DB for the real-Postgres tests |
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
bun run --filter @interview/api db:generate   # refresh the Prisma client after editing the schema
bun run --filter @interview/api worker        # an extra worker process
bun run --filter @interview/api bench         # evaluator benchmark (real Gemini, costs money)
```

## 16. Known gaps and leftovers (be honest about these)

- **Voice:** the room still uses browser speech and scripted questions. The Gemini Live
  adapter, the server-built briefing and `next-question` exist and are tested, but the room
  doesn't use them yet, so the web's question script and the server interviewer both exist.
- **Briefing inputs:** `buildBriefing` accepts focus, company, level and past questions, but
  sessions don't store them, so `briefingFor` passes only the role and the resume summary.
- **Abandoned jobs:** a job given up after `MAX_ATTEMPTS` by stale-lock recovery writes no
  feedback row, so the results screen stays on "pending" with no Try again button (and the
  retry endpoint would answer 409).
- **Benchmark expectations:** the `*.expected.json` fixture files still name the old shared
  categories (Communication, Technical depth, Structure), not the per-role rubrics, so
  `bench.ts` can't pass until they're updated.
- **Unused code:** `lib/transcriptAccumulator.ts` and `data/resources.ts` are used only by their
  tests; `InvalidTimestampError` is no longer thrown.
- **Leftovers:** `Resume.parsedProfile` stores JSON as text.
- **Types and linting:** neither app extends the strict `tsconfig.base.json` yet; the API has
  its own `strict` settings, the web app doesn't. There's no ESLint or Prettier; the web app
  has an `oxlint` script that CI doesn't run.
- **No protected `main` and no CODEOWNERS:** protection needs GitHub Pro or a public repo.
- **Requirements without real users:** every requirement is still evidence class B or C. None
  comes from a recorded interview with a real user.

## 17. Likely evaluation questions

**"Why is the voice not going through your server?"**
Latency (NFR-01: under 5 s) and cost. The server only mints a single-use, short-lived token, so
the API key never reaches the browser (NFR-09).

**"What happens if the LLM is down when an interview ends?"**
The session still ends, and the transcript is safe. The feedback and the job are marked failed
with the error, and the results screen shows the failure with **Try again**, which queues the
job again without re-interviewing (NFR-04).

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
Vitest tests for every route and service (with Supabase, Prisma and Gemini mocked), tests on a
real Postgres for the queue and the delete cascades, and Testing Library tests for the main
screens. CI runs them all on every PR, and a PR can't be merged with a red check by team rule.

**"What did each person build?"**
See `docs/final-sprints.md` and the task tables in `docs/sprint-1.md` and `docs/sprint-2.md`.
Each PR names its task and author, and ported PRs credit the original authors as co-authors.

## 18. Questions by slice

Each team should be able to answer its own block without notes, and know where the code is.
Every answer points to the file to open if you're asked to show it.

### Identity & profile (sign-in, users, resume)

**How does a user sign in? Does our API see the password?**
No. The browser calls Supabase directly (`supabase.auth.signInWithPassword`, or
`signInWithOAuth` for Google, in `apps/web/src/context/AuthContext.tsx`). Supabase checks the
password and returns an access token (a JWT). Our API only ever receives that token.

**How does the API know who is calling?**
`apps/api/src/middleware/auth.ts` runs before every protected route:
1. It reads the `Authorization: Bearer <token>` header and asks Supabase whether the token is
   valid (`supabase.auth.getUser`).
2. It finds our `users` row by `supabaseUserId`, links a row with the same email, or creates
   one.
3. It sets `req.user`.

No token, or an invalid one, gets 401. Handlers use `req.user.id` and never trust a user id
sent in the request.

**Why keep our own `users` table if Supabase already has users?**
Our tables (sessions, resumes) need a normal foreign key to a user in our own database. The
`users` row is our copy of the Supabase user, linked by `supabaseUserId`.

**What happens when the token expires?**
The Supabase client in the browser refreshes the session automatically. `lib/api.ts` reads the
current session before every request, so each call carries a fresh token. The API keeps no
session state of its own, so there's nothing on the server to expire.

**How does resume analysis work?**
`POST /api/resume/analyze` (`routes/resume.ts`):
1. multer keeps the uploaded file in memory (PDF only, 5 MB limit).
2. `pdf.service.ts` extracts the text.
3. `gemini.service.ts` asks Gemini for a structured JSON profile (name, skills, projects,
   experience…). Missing fields default to empty values.
4. The text and the profile are saved in the `Resume` table.

If Gemini isn't configured or fails, `heuristic.service.ts` parses the text with rules
instead: a skills list, section headings, and regexes for email and phone.

**Why does a scanned PDF fail?**
A scanned PDF is an image with no text layer, and there's no OCR, so extraction returns
nothing and the API answers 400 with an explanation.

**What does "delete account" do?**
`DELETE /api/auth/account` deletes the user's `users` row; Postgres cascades the delete to
their resumes, sessions, turns, jobs and feedback. Then it deletes their Supabase identity and
answers 204. If only the Supabase step fails, it answers 500 and says the app data is gone.

**Can the browser read another user's data straight from Supabase?**
No. The browser uses Supabase **only to sign in**. All data goes through our API, which checks
ownership on every query.

### Live session (sessions, turns, voice)

**What happens when the candidate picks a role?**
`POST /api/sessions` with `{ roleId }`. `session.service.ts → createSession` checks the id
against the shared `ROLES` list (an unknown id is a 400) and inserts a `sessions` row with
status `LIVE`, linked to the candidate's newest resume. The browser then opens
`/interview/:sessionId`.

**Why are turns saved one by one during the interview, not at the end?**
So nothing already said is lost if the tab closes or the connection drops. Each finished turn
is `POST /api/sessions/:id/turns` with `{ speaker, text }`.

**What does the API check when a turn arrives?** (`routes/sessions.ts`, `session.service.ts → addTurn`)
`speaker` must be `AI` or `CANDIDATE` and `text` non-empty (else 400), the session must be the
caller's (else 404) and still LIVE (else 409). The server sets `timestampSec` from the
session's start time and the next `turnIndex`, so a client can't invent timings or reorder
turns.

**How does ending an interview work, and why is it one transaction?**
`endSession` marks the session `ENDED` **and** inserts a `session.ended` job in the same
database transaction. Either both are saved or neither is, so no session can end without a
feedback job, and no job can exist for a session that didn't end. Calling end twice does
nothing the second time.

**Why does another user's session return 404, not 403?**
FR-27. A 403 would confirm that the id exists. Every query filters by `id AND userId`
(`getOwnedSession`), so someone else's session is simply "not found".

**How does the voice work today, and what is built for Gemini Live?**
Today `BrowserWebSpeechVoiceAdapter` (`lib/voiceAdapter.ts`) speaks and listens with the
browser's speech APIs, and the questions come from a fixed per-role script
(`lib/questionProvider.ts`). Built but not yet used by the room: `GeminiLiveVoiceAdapter`
(`lib/geminiLiveAdapter.ts`, V1), and the server-built briefing locked into the voice token
(V2, P1). See section 12.

**What is the briefing?** (`services/briefing.service.ts`)
The interviewer's system instructions: a persona for the role, three timed phases (warm-up,
deep-dive, pressure-test), the candidate's resume summary, guardrails against prompt injection
and off-topic talk, and rules for short spoken replies. `briefingFor(session)` builds it from
the session's role and linked resume.

**Why is there a `VoiceSessionAdapter` interface?**
The room reaches the voice provider through the interface (`connect`, `speakAiQuestion`,
`startListening`, `finishCandidateTurn`, `setMuted`, `sendText`, `disconnect`), so Gemini Live
is a second class, not a rewrite of the screen. Two parts of `useInterview.ts` still assume
browser speech: the replay button calls `speechSynthesis` directly, and the room drives the
scripted questions itself. The browser adapter stays as the fallback.

**Why doesn't the audio go through our server?**
The interviewer has to start answering within 5 seconds (NFR-01), and relaying audio through
our API would add delay and cost. Instead, `POST /api/sessions/:id/voice-token` returns a
token that works once, expires in 30 minutes and must be used within 2. The browser connects
to Google with it, and our Gemini key never reaches the browser (NFR-09). The token
code is in `services/voice-provider.service.ts`.

**Which browsers work?**
Speech recognition works in Chrome and Edge. In other browsers the interview room shows a text
box, so the candidate can type answers instead.

**How are the questions chosen today?**
`DeterministicQuestionProvider` has a script per role. It never repeats a question, and the
second question quotes something the candidate said, so it feels responsive. On the server,
`POST /api/sessions/:id/next-question` can already write each question with Gemini from the
briefing and transcript, but the room doesn't call it yet.

### Feedback (job queue, worker, evaluator, results screen)

**Why is feedback generated in the background instead of when "end" is pressed?**
The LLM can take several seconds or fail. Doing it inside the "end" request would make ending
slow, and lose the work on a crash. Instead, ending only writes a job row (in the same
transaction). A worker does the slow part, and the browser polls for the result.

**Why a Postgres table as the queue and not Redis?**
It's one less service to run and pay for. Postgres's `FOR UPDATE SKIP LOCKED` gives a safe
queue, and the job is saved in the same transaction as ending the session, which a separate
Redis couldn't guarantee.

**What does `FOR UPDATE SKIP LOCKED` do?** (`job-queue.service.ts → claimNextJob`)
Inside a transaction, the worker selects the oldest pending job and locks that row. Another
worker running the same query skips locked rows and takes the next job instead. So two
workers can never take the same job. A CI test runs two workers on a real Postgres and checks
exactly that.

**Where does the worker run?**
`apps/api/src/worker.ts`. `server.ts` starts one worker inside the API process, and
`bun run worker` starts more. In production, Cloud Run runs with the CPU always on and at
least one instance, so the worker keeps polling between requests.

**What if the worker crashes in the middle of a job?**
The job stays `processing` with a `lockedAt` time. After 5 minutes another worker picks it up
again, at most 3 times in total (`MAX_ATTEMPTS`). After that it's marked `failed`, so it can't
loop forever.

**What if the LLM is down or slow?**
- The evaluator gives up after **12 seconds**, which stays inside the 15-second feedback target
  (NFR-03).
- `handleSessionEnded` writes feedback with status `failed` and the reason in `error`, and the
  job is marked failed with the error saved.
- The transcript is never touched (NFR-04).
- The results screen shows the failure and a **Try again** button.
  `POST /api/sessions/:id/feedback/retry` moves the feedback back to `pending` and queues a new
  job in one transaction, without re-interviewing. It answers 409 unless the feedback failed.

**How do you make sure the LLM's answer is valid?** (`evaluator.service.ts`)
- Gemini is asked for structured output (`evaluationSchema`): a fixed JSON shape whose
  categories can only be the role's rubric categories.
- The reply is checked with Zod: every score must be an integer from 1 to 5, with a comment,
  strengths, improvements and a quote.
- Every rubric category must appear exactly once.
- A transcript with no candidate answers is rejected before the LLM is called.

Anything that fails a check is treated as a failed evaluation.

**What is the rubric, and who decided it?**
Each role has its own three categories in `rubrics.ts` (for example, Software Engineer:
Problem Solving & Algorithms, Software Design & Architecture, Technical Communication), each
scored 1–5. `getRubric(roleId)` picks it, and an unknown role fails the evaluation. Changing a
rubric needs the lead's approval.

**Why a pinned model name (`gemini-3.8-flash`) instead of "latest"?**
An alias like `gemini-flash-latest` changes when Google releases a new model, so the same
interview could get different scores from one month to the next. A pinned model keeps
scoring stable. `GEMINI_EVAL_MODEL` overrides it, and `deploy.yml` pins all three models
(evaluation, resume, Live) in production.

**How does the results screen know when feedback is ready?**
`useFeedback` calls `GET /api/sessions/:id/feedback` immediately, then every 3 seconds while
the status is `pending`. It stops on `ready` or `failed`, and after 60 seconds says it's taking
longer than usual. The endpoint returns `pending` until the worker has written the feedback row.

**Why polling and not WebSockets?**
For a single result that arrives within about 15 seconds, polling every 3 seconds is simple,
works through any proxy, and needs no extra server.

**How do you test this without calling Gemini?**
The evaluator and the interviewer accept a `generate` function that tests replace with a fake
reply. The handler tests mock both the database and the evaluator. The queue tests run against
a real Postgres in CI (`TEST_DATABASE_URL`). To check the real model, run
`scripts/evaluate.ts` or the benchmark by hand.

### Platform and process (contracts, CI, deployment, how we work)

**Why one repository with three packages?**
The API, the web app and the shared contracts change together. One repository means one PR
can change a shape and both of its users, and CI checks all three at once.

**What is `packages/contracts` for?**
Zod schemas shared by both apps (roles, session, turn, feedback, voice token). Each one gives a
TypeScript type at compile time and a validator at run time. If the API changes a shape,
typecheck fails everywhere that uses it.

**The plan said Hono and Drizzle; why is it Express and Prisma?**
By the Sprint 1 deadline, two teams had built a working app on Express and Prisma, while the
planned Hono shell was about 30 lines. The lead kept the working code and recorded the
decision in [ADR-0008](adr/0008-express-and-prisma.md). It's also our main example for the
course's "conflict identification" deliverable: plan versus reality, and how it was resolved.

**What does CI check on every pull request?** (`.github/workflows/ci.yml`)
Install with the exact lockfile, typecheck every package, apply all migrations to a fresh
Postgres, run every test and build the web app; a second job builds the API's Docker image and
checks that it starts. A red check means don't merge.

**How is the app deployed?** ([sprint-2.md](sprint-2.md), set up by the deploy PR #46)
The API runs as a container on Google Cloud Run, and the web app is static files on Firebase
Hosting. On every merge to `main` (once `DEPLOY_ENABLED` is on), a GitHub Actions workflow
applies database migrations, deploys the API, checks `/health`, then builds and publishes the
web app.

**Where are the secrets, and how does GitHub get access to Google Cloud?**
- The database URL, the Gemini key and the Supabase service key are in Google Secret Manager.
  Cloud Run reads them when it starts, and they are never in the repository.
- GitHub signs in to Google Cloud with Workload Identity Federation. Google gives it
  short-lived access, only for this repository's `main` branch, so no Google key is stored in
  GitHub.

**Why does the API keep one instance always running?**
The feedback worker lives inside the API. By default Cloud Run pauses the CPU between requests,
which would freeze the worker and leave feedback stuck on "pending". So it runs with the CPU
always on and at least one instance.

**How do you change the database schema safely?**
Edit `schema.prisma` and add a **new** migration in the same PR, made against a local
Postgres; never edit a committed one. CI applies all migrations to a fresh database, and the
deploy workflow applies them to production before the new API starts. Prefer changes that only
add columns or tables, so the running version keeps working during a deploy.

**How do you undo a bad deploy?**
Revert the PR on GitHub. The revert is a new merge, so everything redeploys automatically. For
an instant fix, the Cloud Run console can send traffic back to the previous revision.

**How is work divided and reviewed?**
- **Work:** one GitHub issue per task, with one assignee and Given/When/Then acceptance criteria.
- **Review:** one PR per task. CI must pass, and someone from another team reviews it.
- **Ownership:** the author must be able to explain every line.

`docs/final-sprints.md` and the task tables in `docs/sprint-1.md` and `docs/sprint-2.md` show
who built what.

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
| STUB | Placeholder code, marked in a comment with its owner, until the real thing lands |
| ADR | Architecture Decision Record: a short note on why a hard-to-reverse choice was made |
