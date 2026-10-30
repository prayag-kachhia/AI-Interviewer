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
| D2 | CD: migrations on merge to `main` (done in the deploy workflow; verify on the first deploy) | Ved | Merging a PR with a migration applies it to production automatically |
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
Browser ──HTTPS──> Web app (static files: Firebase Hosting, ai-interviewer-it314.web.app)
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
- **Cloud Run** runs our Docker container over HTTPS; GitHub Actions redeploys it on every merge.
- **Firebase Hosting** serves the static web app.
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

### One-time setup (D1)

**Already done (13 Oct):**
- **Google Cloud project:** `ai-interviewer-it314`, region `asia-south1`, billing linked.
- **APIs enabled:** Cloud Run, Cloud Build, Secret Manager, Artifact Registry, Firebase,
  Firebase Hosting, IAM Credentials and STS.
- **Runtime service account** (`628626987581-compute@…`): can read secrets and run builds.
- **Workload Identity Federation:** pool `github`, provider `ai-interviewer`. It accepts only
  tokens from `prayag-kachhia/AI-Interviewer` on `refs/heads/main`, so no Google key is stored in
  GitHub.
- **Deploy service account** (`gha-deployer@ai-interviewer-it314.iam.gserviceaccount.com`):
  allowed to deploy Cloud Run from source, publish Firebase Hosting and read secrets. Nothing
  else.

**Still to do, in this order:**

1. **Production Supabase project** (Supabase dashboard). Create a new project, not the
   development one.
   - Authentication → URL Configuration: Site URL `https://ai-interviewer-it314.web.app`. Also
     add it under Redirect URLs.
   - Authentication → Sign In / Providers → Email: turn **off** "Confirm email" for the demo.
   - Database → Connect: copy the **session pooler** connection string (port 5432, user
     `postgres.<ref>`).
   - Project Settings → API: note the project URL, the **anon / publishable** key and the
     **service_role / secret** key.
2. **Three secrets in Secret Manager** (console → Security → Secret Manager → Create secret,
   project `ai-interviewer-it314`). Paste each value in the browser, so it never lands in a
   terminal's history:

   | Secret name | Value |
   |---|---|
   | `database-url` | the session pooler connection string |
   | `gemini-api-key` | a Gemini API key (set a spending limit on it) |
   | `supabase-service-role-key` | the service_role / secret key |

3. **Firebase** (console.firebase.google.com):
   1. Add project, then pick the existing Google Cloud project `ai-interviewer-it314`.
   2. Build → Hosting → Get started, which creates the site `ai-interviewer-it314.web.app`.
4. **GitHub repository variables** (Settings → Secrets and variables → Actions → Variables).
   Nothing here is secret; the anon key is public by design.

   | Variable | Value |
   |---|---|
   | `SUPABASE_URL` | `https://<ref>.supabase.co` |
   | `VITE_SUPABASE_ANON_KEY` | the anon / publishable key |
   | `DEPLOY_ENABLED` | `true`. Set this last: it switches deployments on |

5. **First deploy.** Merge the deploy PR, or run *Actions → Deploy → Run workflow*. Then:
   - Check `https://<cloud-run-url>/health` shows `{"status":"ok"}`.
   - Open `https://ai-interviewer-it314.web.app` and run the whole interview once.
6. **After the evaluation,** stop spending credits:
   `gcloud run services update ai-interviewer-api --region asia-south1 --min 0`,
   or delete the service.

### What the deploy workflow does (`.github/workflows/deploy.yml`)

On every merge to `main`, in order:
1. **Sign in** to Google Cloud (Workload Identity Federation; no stored key).
2. **Migrate.** It reads `database-url` from Secret Manager, masked in the logs, and runs
   `prisma migrate deploy` against production.
3. **Deploy the API.** It runs `gcloud run deploy --source .`, which builds the root
   `Dockerfile` with Cloud Build and deploys with `--no-cpu-throttling --min 1`. That keeps the
   feedback worker running. Secrets are mounted from Secret Manager, and `WEB_ORIGIN` is the
   Firebase URL.
4. **Health check.** It calls `/health` on the new API.
5. **Build the web app** with `VITE_API_URL` set to the new API's URL.
6. **Publish** to Firebase Hosting.

If any step fails, the later ones don't run, and the previous version stays live.

### Environment variables

| Variable | Where it lives | What |
|---|---|---|
| `DATABASE_URL` | Secret Manager `database-url` | The Supabase session pooler URL, used by the API and by migrations |
| `GEMINI_API_KEY` | Secret Manager `gemini-api-key` | Server-only |
| `SUPABASE_SERVICE_ROLE_KEY` | Secret Manager `supabase-service-role-key` | Server-only. Never in the web app |
| `SUPABASE_URL` | GitHub variable, passed to Cloud Run and the web build | The Supabase project URL |
| `WEB_ORIGIN` | Set by the workflow | `https://ai-interviewer-it314.web.app`, for CORS |
| `GEMINI_EVAL_MODEL`, `GEMINI_RESUME_MODEL` | Optional; `gcloud run services update … --update-env-vars` | Model overrides |
| `PORT` | Set by Cloud Run | Don't set it yourself |
| `VITE_API_URL` | Set by the workflow from the deployed API | |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | GitHub variables | Public by design |

### How CI and deployment fit together

1. **On every pull request,** `ci.yml`:
   - installs dependencies and typechecks
   - applies migrations to a throwaway Postgres
   - runs all tests and builds the web app
   - builds the API image and checks it starts with Prisma's engine loaded (the `docker` job)
2. **On merge to `main`,** `ci.yml` runs again and `deploy.yml` deploys (above).
3. **Undoing a bad deploy.** Revert the PR; the revert is a new merge, so it redeploys.
   - To undo instantly: Cloud Run console → Revisions → send traffic to the previous one.
   - Migrations don't revert. Until the evaluation, schema changes only **add** columns or
     tables.

### Where to look when something breaks

| Symptom | Look at |
|---|---|
| API errors, worker messages (`[api-…] job failed`) | Cloud Run → service → Logs |
| Deploy failed | GitHub → Actions → Deploy (the failing step), then Cloud Build → History |
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

## Where Sprint 2 ended up (28 Oct)

The mid-evaluation ran on 15 Oct on the deployed site, with the browser-speech interviewer as the
fallback. The deployment tasks shipped. The interviewer, personalisation, feedback and history tasks
were not started, and they moved into the revised Sprint 3 plan under new issue numbers.

| Task | Where it landed |
|---|---|
| D1 deploy, D2 migrations on merge | Done (#34, #35, PR #46): Cloud Run, Firebase Hosting, migrations in the deploy workflow |
| V1 Gemini Live adapter | Not started. Now #72, the `useGeminiLive` hook (Vishwa) |
| V2 server-side briefing locked into the token | Not started. Now #87 (Kishan) |
| P1 resume in the briefing | Not started. Now #90, after the resume fix #78 (Vismay) |
| F1 feedback with quotes and tips | Not started. Now #92 (contract, Ved) and #93 (evaluator, Praneel) |
| F2 retry failed feedback | Not started. Now #92 (Ved) |
| H1 session history | Not started. Now #94 (Rahi) |
| A1 delete a session; fix account deletion | Not started. Now #77 (cascade) and #97 (delete), Vismay |
| L1 contracts, reviews, integration, demo | Done (#43) |
| L2 README | Open; moved to Sprint 3 (#44, Raj) |

Also merged in this period, outside the task list: the codebase guide (#45), Gemini calls moved to
`@google/genai` with current models (#47), JSON 404s and a global error handler for the API (#48),
and the `react-router` import cleanup (#49).

The Sprint 3 plan was rewritten on 28 Oct: Gemini Live is the only interviewer, the job queue goes,
and everyone's first PR is a small fix before any feature. The revised plan is at
https://claude.ai/artifact/JymoK3Xqvm3D6hshVAmuX5 and its issues are #72–#97.
