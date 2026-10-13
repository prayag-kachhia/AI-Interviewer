# Sprint 2: mid-evaluation push (Tue 13 Oct to Thu 15 Oct 2026)

**Goal:** on Thursday, an evaluator opens a public URL, signs in, picks a role, talks to a real
AI interviewer that knows their resume, ends the interview and reads written feedback that
quotes what they said. Everything below serves that one demo.

**Hard cutoffs:**

| When | What |
|---|---|
| Tue 13, 23:59 | The current `main` is deployed at a public URL (D1, D2) |
| Wed 14, 18:00 | **Feature freeze.** Unmerged work waits for after the evaluation |
| Wed 14, 18:00 – 23:59 | Integration on the deployed URL, bug fixes only |
| Wed 14, 23:59 | Backup demo video recorded from the deployed app |
| Thu 15, morning | No merges. Warm up the server, rehearse twice |

Same rules as always, sped up:
- One task per PR, CI green.
- One reviewer from another team, within **1 hour** of being asked.
- The author can explain every line.
- Keep each PR small, so it can be reviewed in 10 minutes.

## Scope

**In:**
- the real Gemini Live interviewer
- a server-side interview briefing
- personalisation from the resume
- deployment
- feedback with transcript quotes and tips
- retry for failed feedback
- session history
- deleting your own sessions

**Out until after the evaluation:**
- text-chat interview mode (FR-30)
- 30-day retention purge (NFR-11)
- per-role rubrics (OI-3)
- ESLint and Prettier
- new roles

## Tasks and owners

Each task is a GitHub issue in the Sprint 2 milestone with one assignee.

| ID | Task | Owner | Done when |
|---|---|---|---|
| D1 | Deploy API and web (see [Deployment](#deployment)) | Raj, with Prayag | Public URLs work; sign-in, interview and feedback work on them |
| D2 | CD: migrations on merge to `main` | Ved | Merging a PR with a migration applies it to production automatically |
| V1 | `GeminiLiveVoiceAdapter` in `apps/web/src/lib/voiceAdapter.ts`, fetching its token from `POST /api/sessions/:id/voice-token` | Vishwa | A spoken interview with Gemini works in the browser; both speakers' transcript turns are posted to the API; it falls back to browser speech if the token call fails |
| V2 | Interviewer briefing built server-side and sent with the voice token (role, DR-01 structure: introduction → 3–4 questions → closing, time limit) | Kishan | The AI introduces itself, asks role-specific questions, and closes the interview |
| P1 | Add the candidate's parsed resume (from `Resume.parsedProfile`) to the briefing | Prakriti, with Kishan | At least one question refers to the candidate's own projects or skills |
| F1 | Feedback quotes the transcript and gives one tip per category (prompt + contract change in `evaluator.service.ts`) | Rahi | Every score shows a quote from the candidate and a tip; tests updated |
| F2 | Retry failed feedback: `POST /api/sessions/:id/feedback/retry` re-queues the job; a button on the results screen | Shaurya | A failed evaluation can be retried without re-interviewing (NFR-04) |
| H1 | Session history page: past interviews with role, date and scores; link to each result | Praneel | Signed-in user sees only their own sessions (FR-27) |
| A1 | Delete one's own session (cascades to turns, jobs, feedback); fix account deletion failing when sessions exist | Vismay | FR-28 for sessions; deleting an account works for users with sessions |
| L1 | Contracts for every new shape, reviews, integration on Wed evening, demo script, slides | Prayag | Demo rehearsed twice on the deployed URL |
| L2 | README: how to run, how it's deployed, environment variables | Prakriti | A teammate can set up from the README alone |

**Order:**
- D1/D2 and V1/V2 are the critical path: start them first, tonight.
- F1, F2, H1 and A1 are independent and can merge in any order.
- P1 starts as soon as V2's briefing function exists.

## Deployment

### Where everything runs

```
Browser ──HTTPS──> Web app (static files: Vercel)
   │                  │ calls
   │                  ▼
   │               API + feedback worker (one Bun process, Docker on Render) ──> Supabase Postgres
   │                  │ mints short-lived token                                   (pooler, port 6543)
   │                  ▼
   └──WebSocket──> Gemini Live (audio goes browser ↔ Google directly)
                   Gemini text model (evaluation, called only by the API)
Sign-in: browser ↔ Supabase Auth; the API checks the token on every request.
```

**For Thursday:** Render for the API, Vercel for the web app, Supabase for the database and
sign-in.
- **Render:** it runs our Bun process as it is, including the in-process feedback worker.
- **Vercel:** it builds and serves the web app.
- **Both:** they deploy automatically when `main` changes, and neither needs a credit card.

Google Cloud is the alternative after the evaluation (see the last section).

### One-time setup (D1)

1. **Production Supabase project.** Create a new project, separate from the one everyone
   develops against. Under Authentication → URL Configuration, set the Site URL and redirect
   URL to the Vercel URL.
2. **Prisma with Supabase's connection pooler** (code change, one PR):
   - In `schema.prisma`, the `datasource` gets `directUrl = env("DIRECT_URL")`.
   - Runtime `DATABASE_URL` uses the transaction pooler (port 6543, ending in `?pgbouncer=true`).
   - `DIRECT_URL` uses the direct connection (port 5432); migrations use it.
   - Without the pooler, a hosted API can run out of database connections.
3. **`apps/api/Dockerfile`** based on the official `oven/bun` image:
   - copy the workspace (root `package.json`, `bun.lock`, `apps/api`, `packages/contracts`)
   - `bun install --frozen-lockfile` (also generates the Prisma client for Linux)
   - start with `bun src/server.ts`
   - add a `.dockerignore` for `node_modules`, `.env` and `dist`
4. **Render web service** from the GitHub repo:
   - Docker, root directory = repository root, Dockerfile path `apps/api/Dockerfile`
   - health check `/health`, auto-deploy from `main`
   - set the API environment variables below
5. **Vercel project** from the GitHub repo:
   - root directory `apps/web`
   - install command `bun install` (from the repo root)
   - build `bun run build`, output `dist`
   - add a rewrite of every path to `/index.html`, so react-router URLs work on refresh
   - set the web environment variables below
6. **Apply the migrations once** to the production database:
   `DATABASE_URL=<direct URL> bun run --filter @interview/api db:migrate`.
   After this, D2 does it automatically.

### Environment variables

These are set in the hosting dashboards, never committed.

| Variable | Where | What |
|---|---|---|
| `DATABASE_URL` | Render | Supabase pooler URL (port 6543, `?pgbouncer=true`) |
| `DIRECT_URL` | Render, GitHub secret | Supabase direct URL (port 5432), for migrations |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Render | Server-only. Never on Vercel |
| `GEMINI_API_KEY` | Render | Server-only. Set a spending limit on the key |
| `GEMINI_EVAL_MODEL` | Render (optional) | Only if `gemini-flash-latest` doesn't work with the key |
| `WEB_ORIGIN` | Render | The Vercel URL, for CORS |
| `VITE_API_URL` | Vercel | The Render URL + `/api` |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | Vercel | Public by design |

**`VITE_` variables are baked in at build time.** After changing one on Vercel, redeploy.

### How CI and deployment fit together (D2)

1. **On every pull request**, GitHub Actions (`.github/workflows/ci.yml`):
   - installs dependencies
   - typechecks
   - applies migrations to a throwaway Postgres
   - runs all tests
   - builds the web app

   Vercel also builds a preview URL for the PR.
2. **On merge to `main`:**
   - CI runs again.
   - A new `deploy-migrations` job runs `prisma migrate deploy` against production, using the
     `DIRECT_URL` GitHub secret.
   - Render and Vercel each pull `main` and deploy.
3. **A bad deploy is undone by reverting the PR on GitHub.** The revert is a new merge to
   `main`, so the hosts redeploy the previous code.
   - Migrations don't revert. A schema change has to stay compatible with the previous code
     (add columns, don't rename or drop them before the evaluation).

### Free-tier caveats

- **Render sleeps when idle.** The free API stops after about 15 idle minutes, and the first
  request after that takes 30–60 s. Open the site a few minutes before the evaluation.
- **Jobs survive sleep.** They live in Postgres, so nothing is lost while the server sleeps;
  the worker resumes on wake.
- **Limit Gemini spending.** The cost ceiling (OI-2) is still open.

## Demo script (Thursday)

1. Open the deployed URL. Sign in with a prepared demo account that already has a resume uploaded.
2. Show the profile parsed from the resume.
3. Pick a role and start an interview. The AI greets the candidate and asks about a project
   from the resume. Answer 2–3 questions.
4. End the interview. Feedback appears within about 15 seconds (NFR-03): three scores, each
   with a quote and a tip.
5. Show the history page, then the GitHub repo: PRs, CI, the ADRs.

**Fallbacks, in order:**
1. If Gemini Live fails, the browser-speech adapter takes over.
2. If the deployed app is down, run it locally (`bun run dev`).
3. If everything fails, play the backup video.

## After the mid-evaluation

- the text-chat mode (FR-30)
- the retention purge (NFR-11)
- per-role rubrics (OI-3)
- ESLint with the import rule, and Prettier
- CODEOWNERS
- protecting `main`, which needs GitHub Pro from the Student Developer Pack or a public repo
- moving hosting to Google Cloud if wanted:
  - Cloud Run for the API needs CPU allocated outside requests (or a separate worker), because
    the feedback worker runs in the background
  - Firebase Hosting for the web app
  - this needs a billing account; the free trial credits cover it
