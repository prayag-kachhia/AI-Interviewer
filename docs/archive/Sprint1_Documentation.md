# AI-Interviewer

**User Guide and Developer Documentation**

AI-Interviewer is an interview-practice web application. Candidates can create an account, choose an interview role, conduct a practice interview, save transcript turns, and view AI-generated feedback. This document reflects the code in the supplied `AI-Interviewer-main.zip` snapshot, not every feature originally planned for the project.

| Document details | Value |
|---|---|
| Status | Updated against process till sprint 1 |
| Audience | developers |
| Stack | React, Vite, TypeScript, Express, Prisma, PostgreSQL, Supabase, Gemini |
| Last reviewed | 14 October 2026 |

## Contents

1. [Project overview](#1-project-overview)
2. [User guide](#2-user-guide)
3. [Local setup](#3-local-setup)
4. [Codebase navigation](#4-codebase-navigation)
5. [How the main workflows work](#5-how-the-main-workflows-work)
6. [Implementation status](#6-implementation-status)

---

## 1. Project overview

The repository is a Bun-workspace TypeScript monorepo. The web app uses React 19, Vite, and `react-router`. The API uses Express 5 and Prisma 5. Supabase Auth manages sign-in, while the API uses Supabase PostgreSQL through Prisma. Gemini is used for resume analysis, interview feedback, and minting short-lived voice tokens.

### 1.1 Technology at a glance

| Area | Current implementation |
|---|---|
| Workspace/runtime | Bun workspaces; API runs on Bun |
| Web | React 19, Vite, TypeScript, `react-router` |
| API | Express 5, TypeScript |
| Database | PostgreSQL accessed through Prisma 5 |
| Authentication | Supabase Auth in the browser; API validates Supabase access tokens |
| Shared contracts | `packages/contracts`, with Zod schemas and TypeScript types |
| AI services | Gemini-backed resume analysis and interview evaluation |
| Voice | Browser Web Speech adapter is currently used by the interview screen; the Gemini Live browser adapter is not yet wired in |
| Tests and checks | Vitest, Supertest, Testing Library, TypeScript checks, CI workflow |

### 1.2 Scope of this document

The repository contains code for authentication, resume upload/analysis, interview sessions and transcript turns, a feedback queue/worker, and a results screen. A file or endpoint existing in the repository does not by itself prove that a deployed environment is configured correctly; credentials and database setup are still required.

## 2. User guide

The steps below describe the workflow represented by the current frontend and API routes.

### 2.1 Start and open the app

After completing the setup in Section 3, open [http://localhost:5173](http://localhost:5173). The API health endpoint is [http://localhost:3000/health](http://localhost:3000/health); it should return JSON containing `"status": "ok"`.

### 2.2 Sign in or create an account

Open the login page. The interface supports sign-in and sign-up using Supabase Auth. Sign-up asks for a name, email, password, and password confirmation; the frontend checks required fields, a minimum password length of six characters, and matching passwords before submitting. Supabase handles the authentication credentials; the application does not authenticate by storing a local password.

After authentication, the app directs the candidate to the role picker if no role has been selected, or to the dashboard if a role is already stored in the browser.

### 2.3 Choose a role and start an interview

The role-picker route renders the `NewInterview` screen. It loads the role list from the API and falls back to the shared role catalogue if the API call fails. After a role is selected, the frontend requests a new session and navigates to `/interview/:sessionId`.

### 2.4 Conduct the interview

The interview room loads the session and its saved turns. The current voice implementation uses the browser's Web Speech APIs through `BrowserWebSpeechVoiceAdapter`; it is not yet connected to a Gemini Live browser adapter. Microphone access and browser support can affect voice input. The screen also contains an accessibility/text-input fallback.

Interview turns are sent to the API and persisted. The API checks the speaker, non-empty text, timestamp, session ownership, and whether the session has already ended.

### 2.5 End the interview and view feedback

Ending a session updates its status and creates a `session.ended` job. The worker processes that job, evaluates the transcript, and stores feedback. The results screen polls the feedback endpoint and represents pending, ready, and failed states. The current evaluator uses a generic rubric for Communication, Technical depth, and Structure; role-specific rubrics are not implemented in this snapshot.

### 2.6 Troubleshooting

| Problem | What to check |
|---|---|
| Web app is blank or Supabase setup fails | Confirm `apps/web/.env.local` exists and has valid `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` values. Check the browser console. |
| Sign-in fails | Check the Supabase URL/key, account credentials, and browser network requests. |
| API is unavailable | Confirm the API server is running and check `http://localhost:3000/health`. |
| API requests return 401 | Confirm the user is signed in and that the request includes a valid Supabase Bearer token. |
| Voice input does not work | Check microphone permissions and browser support for Web Speech APIs. |
| Feedback remains pending | Confirm the API/worker is running, then inspect API logs and the database job/feedback status. Check that `GEMINI_API_KEY` is configured. |

---

## 3. Local setup

### 3.1 Prerequisites

- Bun 1.4 or later.
- Node.js 22 LTS.
- Access to the project's Supabase project and PostgreSQL connection string.
- A Gemini API key for Gemini-backed features.

Do not paste credentials into chat, commit them, or place server secrets in the web environment file.

### 3.2 Install dependencies

From the repository root:

```bash
bun install
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
```

On Windows Command Prompt, use `copy` instead of `cp`:

```bat
copy apps\api\.env.example apps\api\.env
copy apps\web\.env.example apps\web\.env.local
```

Replace the placeholders in both environment files. Dependency installation runs Prisma generation through the API package's `postinstall` script.

### 3.3 API environment: `apps/api/.env`

| Variable | Purpose |
|---|---|
| `PORT` | API port; defaults to `3000`. |
| `WEB_ORIGIN` | Allowed browser origin for CORS; defaults to `http://localhost:5173`. |
| `SUPABASE_URL` | Supabase project URL used by the API. |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only key used for privileged Supabase operations. Never expose it to the browser. |
| `DATABASE_URL` | PostgreSQL connection string used by Prisma. |
| `GEMINI_API_KEY` | Server-only key for Gemini-backed features. |
| `WORKER` | Optional. Set to `off` to disable the worker inside the API process and run `bun run worker` separately. |
| `GEMINI_EVAL_MODEL`, `GEMINI_RESUME_MODEL` | Optional model overrides, as described in `.env.example`. |

### 3.4 Web environment: `apps/web/.env.local`

| Variable | Purpose |
|---|---|
| `VITE_SUPABASE_URL` | Supabase project URL for browser authentication. |
| `VITE_SUPABASE_ANON_KEY` | Browser-safe anon/publishable key. |
| `VITE_API_URL` | API base URL; defaults to `http://localhost:3000/api`. |

Only `VITE_`-prefixed variables are exposed to the browser bundle. Never place `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, or `GEMINI_API_KEY` in this file.

### 3.5 Run the application

From the repository root:

```bash
bun run dev
```

- Web app: [http://localhost:5173](http://localhost:5173)
- API: [http://localhost:3000](http://localhost:3000)
- Health check: [http://localhost:3000/health](http://localhost:3000/health)

By default, the API starts a feedback worker in the same process. To run the worker separately, set `WORKER=off` in the API environment and start it with:

```bash
bun run --filter @interview/api worker
```

### 3.6 Run checks

```bash
bun run typecheck
bun run test
bun run --filter @interview/web build
```

The CI workflow runs typechecking, applies migrations to a disposable PostgreSQL service, runs tests, and builds the web app. The API tests use Vitest and Supertest; the web app also has Vitest and Testing Library tests.

### 3.7 Prisma schema and migrations

The Prisma schema is `apps/api/prisma/schema.prisma`; committed migrations are under `apps/api/prisma/migrations`.

After changing the schema, generate the client and apply committed migrations using:

```bash
bun run --filter @interview/api db:generate
bun run --filter @interview/api db:migrate
```

`db:migrate` runs `prisma migrate deploy`. Create a new migration for schema changes and commit it with the code. Do not edit an existing committed migration or run destructive migration commands against the shared database.

---

## 4. Codebase navigation

| Path | Responsibility |
|---|---|
| `apps/web/src/pages/Login.tsx` | Sign-in/sign-up interface, client-side form validation, and navigation after authentication |
| `apps/web/src/context/AuthContext.tsx` | Authentication state, Supabase sign-in/sign-up/sign-out, session restoration, and account deletion flow |
| `apps/web/src/lib/supabase.ts` | Creates the browser Supabase client and checks whether its configuration is present |
| `apps/web/src/lib/api.ts` | Central Axios client; adds the current Supabase access token as a Bearer token and exposes API functions |
| `apps/web/src/components/ProtectedRoute.tsx` | Redirects unauthenticated users to `/login` |
| `apps/web/src/App.tsx` | Route definitions and context providers |
| `apps/web/src/pages/NewInterview.tsx` | Role selection and session creation |
| `apps/web/src/pages/InterviewRoom.tsx` | Interview UI, voice adapter integration, transcript turns, and session ending |
| `apps/web/src/lib/voiceAdapter.ts` | Voice adapter contract and current browser Web Speech implementation |
| `apps/web/src/features/feedback/` | Results screen and feedback polling |
| `apps/api/src/server.ts` | Express app, CORS/JSON middleware, route mounting, health endpoint, error handling, and worker startup |
| `apps/api/src/middleware/auth.ts` | Validates Supabase access tokens and maps Supabase identities to application users |
| `apps/api/src/routes/` | API endpoint definitions and authentication middleware wiring |
| `apps/api/src/controllers/` | HTTP request/response handling |
| `apps/api/src/services/` | Session, resume, voice-token, queue, feedback, and AI business logic |
| `apps/api/src/utils/db.ts` | Shared Prisma client |
| `apps/api/src/utils/resource.ts` | Shared resource-not-found handling |
| `apps/api/prisma/schema.prisma` | Database models and relations |
| `apps/api/prisma/migrations/` | Database migration history |
| `apps/api/src/worker.ts` | Polls for and processes `session.ended` jobs |
| `packages/contracts/src/index.ts` | Shared Zod schemas, role definitions, and request/response contracts |
| `.github/workflows/ci.yml` | Pull-request/push checks, migration setup, tests, and web build |
| `CONTRIBUTING.md` | Contribution conventions and review process |
| `docs/sprint-1.md`, `docs/sprint-2.md` | Sprint scope and deferred work |

### 4.1 Typical API request flow

```text
React page/component
  -> apps/web/src/lib/api.ts
  -> Authorization: Bearer <Supabase access token>
  -> Express route
  -> authenticate middleware (for protected routes)
  -> controller
  -> service
  -> Prisma/PostgreSQL or external provider
  -> JSON response to the web app
```

Not every request follows every step; for example, browser sign-in/sign-up is handled directly by Supabase Auth rather than by an API password endpoint.

---

## 5. How the main workflows work

### 5.1 ID1 — Database setup

The Prisma schema defines the application's `User` and `Resume` models as well as interview-related `Session`, `Turn`, `Job`, and `Feedback` models. PostgreSQL migrations record schema changes. The `User` model includes a unique optional `supabaseUserId` field to connect an application user record to the corresponding Supabase Auth identity.

Prisma is used by the API; the browser does not query application database tables directly.

### 5.2 ID2 — Sign-in interface and frontend authentication

The sign-in/sign-up screen is in `apps/web/src/pages/Login.tsx`. It collects credentials and calls the methods exposed by `useAuth()` rather than implementing authentication itself.

`AuthContext.tsx` wraps the application in `AuthProvider`. It restores an existing Supabase session on startup, listens for authentication state changes, exposes sign-in/sign-up/sign-out methods, and provides the current user to the rest of the app. `ProtectedRoute.tsx` uses this state to prevent unauthenticated access to protected pages.

For authenticated API calls, `apps/web/src/lib/api.ts` retrieves the current Supabase session and attaches its access token in the `Authorization` header. The frontend does not create its own authentication token, and passwords are not sent to the application's API.

### 5.3 ID3 — API authentication middleware

`apps/api/src/middleware/auth.ts` protects API routes. It checks for a `Bearer` token, asks Supabase Auth to validate it, and returns `401` for missing or invalid/expired credentials. It then finds or creates the corresponding application `User` record through Prisma and attaches that local user to `req.user` for downstream controllers.

Protected resource handlers use the authenticated local user ID to scope access to sessions, transcripts, resumes, and feedback. Where a session or resource is not owned by the requesting user, the code uses a not-found response to avoid revealing another user's resource.

### 5.4 Session and transcript lifecycle

```text
Sign in through Supabase
  -> select an interview role
  -> API creates a session in PostgreSQL
  -> interview screen loads the session
  -> AI/candidate turns are sent to the API and stored
  -> candidate ends the session
  -> API marks the session ended and creates a session.ended job
  -> worker evaluates the transcript
  -> feedback is saved
  -> results screen polls until feedback is ready or failed
```

The API validates turn input, prevents turns from being added to ended sessions, and checks session ownership. The session-ending and job-creation flow is implemented in the backend service layer.

### 5.5 Feedback worker and evaluation

The worker in `apps/api/src/worker.ts` polls for `session.ended` jobs. The queue service claims jobs, and the feedback service runs transcript evaluation and stores the result. The evaluator's Gemini call is isolated in `apps/api/src/services/evaluator.service.ts`. The current rubric includes Communication, Technical depth, and Structure; role-specific rubrics remain future work.

### 5.6 Voice integration

The API has a voice-token endpoint that mints short-lived, single-use tokens through the server-side Gemini voice provider service. This keeps the permanent Gemini API key on the server. However, `apps/web/src/lib/voiceAdapter.ts` currently implements the browser Web Speech adapter, and the Gemini Live browser adapter is not yet wired into the interview room. Do not describe the browser interview as already using Gemini Live.

### 5.7 Security principles

- Supabase Auth is the only authentication authority; do not add a separate local token scheme.
- Keep `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, and `GEMINI_API_KEY` server-side.
- Use the shared API client for web-to-API requests; do not query application database tables directly from the browser.
- Protect private resources using the authenticated user ID.
- Do not commit `.env` files, `node_modules/`, or generated build output.
- Add schema changes as new Prisma migrations; do not rewrite committed migrations.

---

## 6. Implementation status

This table reflects the code present in the supplied ZIP snapshot. It does not verify deployed configuration, production credentials, or runtime behavior outside the repository.

| Feature | Status in supplied code | Notes |
|---|---|---|
| Supabase sign-in/sign-up UI | Implemented | Login screen, client-side validation, and auth context are present. |
| Supabase access-token validation | Implemented | Protected API routes use `authenticate` middleware. |
| Application user mapping | Implemented | Middleware finds/creates the local Prisma user associated with Supabase identity. |
| Prisma schema and migrations | Implemented | Includes users, resumes, sessions, turns, jobs, and feedback. |
| Protected frontend routes | Implemented | Unauthenticated users are redirected to `/login`. |
| Resume upload and analysis | Implemented in code | Authenticated resume endpoints and analysis service are present; requires valid environment credentials. |
| Role selection and session creation | Implemented | Role list and session creation endpoints are present. |
| Interview room and transcript turns | Implemented | Turns are persisted through API endpoints. |
| Session ending and feedback job queue | Implemented | Ending a session creates a `session.ended` job. |
| Feedback worker and generic LLM evaluator | Implemented | Uses Gemini and a generic rubric. |
| Feedback results screen | Implemented | Results screen polls the feedback endpoint and handles pending/ready/failed states. |
| Server-side voice-token endpoint | Implemented | Mints short-lived tokens through the Gemini voice provider service. |
| Browser-side Gemini Live adapter | Not yet wired in | Current interview room uses the browser Web Speech adapter. |
| Role-specific feedback rubrics | Not implemented  | Current evaluator uses one generic rubric. |
| Automated retry policy for failed feedback | Not implemented | The worker records/handles job failures, but a user-facing retry workflow is not documented as complete. |
| CI workflow | Present | Typecheck, migrations against test PostgreSQL, tests, and web build run in CI. |
| Branch protection, CODEOWNERS, lint gate, Prettier | Not Verified | Check repository settings and current sprint tracking before marking these done. |

