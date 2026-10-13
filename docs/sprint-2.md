# Sprint 2: mid-evaluation push (Tue 13 Oct to Thu 15 Oct 2026)

**Issues:** #34–#44 in the Sprint 2 milestone.

**Goal:** on Thursday, an evaluator opens a public URL, signs in, picks a role, talks to a real
AI interviewer that knows their resume, ends the interview and reads written feedback that
quotes what they said. Everything below serves that one demo.

**Hard cutoffs:**

| When | What |
|---|---|
| Tue 13, 23:59 | The current `main` is deployed on Google Cloud at a public URL (D1, D2) |
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
| D1 | Deploy API (Cloud Run) and web (Firebase Hosting), see [Deployment](#deployment-google-cloud) | Raj, with Prayag | Public URLs work; sign-in, interview and feedback work on them |
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

## Deployment (Google Cloud)

### Where everything runs

```
Browser ──HTTPS──> Web app (static files: Firebase Hosting, <project>.web.app)
   │                  │ calls
   │                  ▼
   │               API + feedback worker (one Bun container on Cloud Run, asia-south1)
   │                  │                          └──> Supabase Postgres (session pooler)
   │                  │ mints single-use token        secrets from Secret Manager
   │                  ▼
   └──WebSocket──> Gemini Live (audio goes browser ↔ Google directly)
                   Gemini text model (evaluation, called only by the API)
Sign-in: browser ↔ Supabase Auth; the API checks the token on every request.
```

**Why these choices:**
- **Cloud Run** runs our Docker container over HTTPS and redeploys from GitHub.
- **Firebase Hosting** serves the static web app, with a preview URL for every PR.
- **Supabase** stays the database and sign-in.
- **Region:** `asia-south1` (Mumbai).
- **Cost:** the trial credits cover all of it. Turn the API down after the evaluation (see the
  last step).

### The two settings that matter

1. **The worker needs a CPU between requests.** By default Cloud Run pauses the CPU when no
   request is running, which would freeze the feedback worker (`apps/api/src/worker.ts`).
   Deploy with **`--no-cpu-throttling --min 1`** (instance-based billing, one instance always
   running).
2. **Connect to the database through Supabase's *session pooler*** (port 5432, user
   `postgres.<project-ref>`). Supabase's direct connection is IPv6-only, and Cloud Run and
   GitHub's runners connect over IPv4.

### One-time setup (D1, Raj with Prayag)

1. **Production Supabase project.** Create a new project (not the development one).
   - Authentication → URL Configuration: set the Site URL and redirect URL to
     `https://<firebase-project>.web.app`.
   - Authentication → Sign In / Providers → Email: **turn off "Confirm email" for the demo**.
     Supabase's built-in mailer sends only about 2 emails per hour per project, which would
     block sign-ups during the evaluation. Create the demo accounts in advance. Setting up your
     own mail server (custom SMTP) and turning confirmation back on is a post-evaluation task.
   - Database → Connect: copy the **session pooler** string. That's `DATABASE_URL`.
   - Apply the migrations once from a laptop:
     `DATABASE_URL=<session pooler URL> bun run --filter @interview/api db:migrate`
2. **Google Cloud project.** Enable the APIs, then store the three secrets:

   ```bash
   gcloud config set project <PROJECT_ID>
   gcloud services enable run.googleapis.com cloudbuild.googleapis.com secretmanager.googleapis.com artifactregistry.googleapis.com
   printf %s "<session pooler URL>"   | gcloud secrets create database-url --data-file=-
   printf %s "<Gemini API key>"       | gcloud secrets create gemini-api-key --data-file=-
   printf %s "<Supabase service key>" | gcloud secrets create supabase-service-role-key --data-file=-
   ```

   Give Cloud Run's runtime service account (by default the Compute Engine default account)
   the role `roles/secretmanager.secretAccessor`.
3. **First API deploy.** Run from the repo root; it uses the root `Dockerfile`:

   ```bash
   gcloud run deploy ai-interviewer-api --source . --region asia-south1 \
     --no-cpu-throttling --min 1 --max 2 --memory 512Mi --allow-unauthenticated \
     --set-env-vars WEB_ORIGIN=https://<firebase-project>.web.app,SUPABASE_URL=https://<ref>.supabase.co \
     --set-secrets DATABASE_URL=database-url:latest,GEMINI_API_KEY=gemini-api-key:latest,SUPABASE_SERVICE_ROLE_KEY=supabase-service-role-key:latest
   ```

   Check that `https://<run-url>/health` returns `{"status":"ok"}`.
4. **Continuous deployment of the API.** In the Cloud Run console, open the service and choose
   *Set up continuous deployment*:
   - GitHub repo `prayag-kachhia/AI-Interviewer`, branch `^main$`
   - build type Dockerfile, path `/Dockerfile`

   From then on every merge to `main` builds and deploys the API.
5. **Web app on Firebase Hosting.**
   1. In the Firebase console, add Firebase to the same Google Cloud project.
   2. Run `npx firebase-tools init hosting:github` once. It creates a deploy service account
      and stores its key as a GitHub secret.
   3. Rename that secret to `FIREBASE_SERVICE_ACCOUNT` and delete the workflow files it wrote.
      Ours is `.github/workflows/deploy-web.yml`, and `firebase.json` is already committed.
   4. Set the repository **variables** (Settings → Secrets and variables → Actions → Variables):
      `FIREBASE_PROJECT_ID`, `VITE_API_URL` (= `https://<run-url>/api`), `VITE_SUPABASE_URL`,
      `VITE_SUPABASE_ANON_KEY`.
6. **Migrations on merge (D2, Ved).** Add the repository **secret** `PRODUCTION_DATABASE_URL`
   (the session pooler string). The `migrate` job in `ci.yml` applies new migrations after
   every merge to `main`.
7. **After the evaluation,** stop spending credits:
   `gcloud run services update ai-interviewer-api --region asia-south1 --min 0`,
   or delete the service.

### Environment variables

| Variable | Where | What |
|---|---|---|
| `DATABASE_URL` | Secret Manager `database-url` | Supabase session pooler URL |
| `GEMINI_API_KEY` | Secret Manager `gemini-api-key` | Server-only. Set a spending limit on the key |
| `SUPABASE_SERVICE_ROLE_KEY` | Secret Manager `supabase-service-role-key` | Server-only. Never in the web app |
| `SUPABASE_URL`, `WEB_ORIGIN` | Cloud Run env vars | Supabase URL; the Firebase URL (for CORS) |
| `GEMINI_EVAL_MODEL` | Cloud Run env var (optional) | Override the evaluation model |
| `PORT` | set by Cloud Run | Don't set it yourself |
| `PRODUCTION_DATABASE_URL` | GitHub secret | For the `migrate` job |
| `FIREBASE_SERVICE_ACCOUNT` | GitHub secret | For the web deploy |
| `FIREBASE_PROJECT_ID`, `VITE_API_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | GitHub variables | Web build and deploy. The `VITE_` values are public by design |

**`VITE_` values are baked in when the web app is built.** After changing one, re-run the web
deploy.

### How CI and deployment fit together

1. **On every pull request:**
   - `ci.yml` checks the code: install, typecheck, migrations on a throwaway Postgres, all
     tests, the web build.
   - `deploy-web.yml` publishes a Firebase **preview URL** and comments it on the PR.
2. **On merge to `main`:**
   - `ci.yml` checks again, and its `migrate` job applies new migrations to production.
   - Cloud Build builds and deploys the API to Cloud Run.
   - `deploy-web.yml` publishes the web app.
3. **Undoing a bad deploy.** Revert the PR on GitHub; everything redeploys from `main`.
   - To undo instantly, roll back in the Cloud Run console: Revisions → route traffic to the
     previous one.
   - Migrations don't revert. Until the evaluation, schema changes only **add** columns or
     tables.

### Where to look when something breaks

| Symptom | Look at |
|---|---|
| API errors, worker messages (`[api-…] job failed`) | Cloud Run → service → Logs |
| Deploy failed | Cloud Build → History |
| CORS error in the browser | `WEB_ORIGIN` on Cloud Run must be exactly the Firebase URL |
| Sign-in confirmation email links to localhost | The Supabase Site URL |
| Feedback stuck on "preparing" | The `jobs` and `feedback` rows in Supabase, and the Cloud Run logs |

## Demo script (Thursday)

1. Open the deployed URL (the Firebase `web.app` address). Sign in with a prepared demo account that already has a resume uploaded.
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
- split the worker into its own Cloud Run service, so the API can scale to zero
