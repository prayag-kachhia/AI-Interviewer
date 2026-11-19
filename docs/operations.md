# Operations: deploys, settings, costs and fixing production

## Where everything runs

```
Browser ──HTTPS──▶ Web app: static files on Firebase Hosting (ai-interviewer-it314.web.app)
   │                  │ calls
   │                  ▼
   │               API + job worker: one Bun container on Cloud Run (asia-south1)
   │                  │                 └──▶ Supabase Postgres (session pooler)
   │                  │ mints single-use token      secrets from Secret Manager
   │                  ▼
   └──WebSocket──▶ Gemini Live (audio goes browser ↔ Google directly)
                   Gemini text model (grading, resume, questions, insights; called only by the API)
Sign-in: browser ↔ Supabase Auth; the API checks the token on every request.
```

- **Google Cloud project:** `ai-interviewer-it314`. Gemini usage is billed in the project that owns
  the API key (the "Default Gemini Project"); both are on the same billing account.
- **Region:** `asia-south1` (Mumbai).

## What a merge to main does

`.github/workflows/deploy.yml`, in order (only when the `DEPLOY_ENABLED` variable is `true`):

1. **Sign in** to Google Cloud with Workload Identity Federation. No Google key is stored in
   GitHub; only this repository's `main` branch can get access.
2. **Migrate.** Reads `database-url` from Secret Manager (masked in the logs) and runs
   `prisma migrate deploy` against production.
3. **Deploy the API** with `gcloud run deploy --source .` (Cloud Build builds the root `Dockerfile`).
4. **Health check:** `/health` on the new API.
5. **Build the web app** with `VITE_API_URL` set to the new API, then **publish** to Firebase
   Hosting.

If a step fails, the later ones don't run and the previous version stays live.

### The Cloud Run settings that matter

| Flag | Why |
|---|---|
| `--no-cpu-throttling` | The job worker runs inside the API. Without it, Cloud Run pauses the CPU between requests and feedback never gets written |
| `--min 0` | The instance stops about 15 minutes after the last request, so we pay only while the app is used ([ADR-0015](adr/0015-scale-to-zero.md)). The first visitor after a quiet spell waits a few seconds |
| `--max 2` | A cap on spend and on database connections |
| `--memory 512Mi` | Enough for the API and the worker |
| `--set-env-vars` | **Replaces every environment variable** on each deploy. All Gemini model names and `ADMIN_EMAILS` are set here, so change them here, never in the console |

## Settings and secrets

| Name | Where it lives | What |
|---|---|---|
| `DATABASE_URL` | Secret Manager `database-url` | Supabase **session pooler** URL (IPv4; the direct connection is IPv6-only) |
| `GEMINI_API_KEY` | Secret Manager `gemini-api-key` | Server-only |
| `SUPABASE_SERVICE_ROLE_KEY` | Secret Manager `supabase-service-role-key` | Server-only, never in the web app |
| `SUPABASE_URL` | GitHub variable | The Supabase project URL, for the API and the web build |
| `VITE_SUPABASE_ANON_KEY` | GitHub variable | Public by design |
| `ADMIN_EMAILS` | GitHub variable | Comma-separated emails that can open `/admin`; empty means nobody |
| `DEPLOY_ENABLED` | GitHub variable | `true` switches deploys on |
| `E2E_EMAIL`, `E2E_PASSWORD` | GitHub secrets | The test account for the end-to-end CI job |
| Gemini model names | `deploy.yml` | Pinned, so scores don't drift when Google updates an alias |
| `WEB_ORIGIN`, `VITE_API_URL` | set by the workflow | |
| `PORT` | set by Cloud Run | Don't set it yourself |

To change a GitHub variable: repository Settings → Secrets and variables → Actions. A change
takes effect on the next deploy (push to main, or Actions → Deploy → Run workflow).

## Costs

**What costs money:**
- **Cloud Run:** billed while an instance is up (CPU always on while it runs). With `--min 0`,
  close to nothing when nobody uses the app.
- **Gemini:** tokens in and out. Rough figures from November 2026: a full 15-minute voice
  interview plus its grading costs about ₹8–12. Spoken output is the most expensive token type.
- **Cloud Build and Artifact Registry:** one build per deploy. A cleanup policy on the
  `cloud-run-source-deploy` repository keeps only the 10 newest images.
- **Firebase Hosting and Supabase:** free tiers.

**Guardrails:**
- A **₹500 monthly budget** on the billing account emails the billing admins at 50%, 90% and 100%
  of actual spend, and when spend is forecast to pass ₹500.
- The grading timeout is 60 seconds, and jobs retry at most 3 times.

**Checking where money goes** (needs `gcloud`, signed in):
```bash
# Is the API billing all day? Should be a few hours a day, not 24.
# Cloud Console → Monitoring → Metrics explorer → "Cloud Run Revision - Billable instance time"
gcloud run services describe ai-interviewer-api --region asia-south1 \
  --format='value(metadata.annotations["run.googleapis.com/minScale"])'   # empty or 0
```
The exact split by service is in Cloud Console → Billing → Reports, grouped by SKU.

## Undoing a bad deploy

- **Revert the PR.** The revert is a new merge, so everything redeploys.
- **Instantly:** Cloud Run → `ai-interviewer-api` → Revisions → send 100% of traffic to the
  previous revision.
- **Migrations don't revert.** Prefer schema changes that only add columns or tables, so an older
  API version still works against the newer schema.

## When something breaks

| Symptom | Look at |
|---|---|
| API errors, worker messages (`job failed`) | Cloud Run → service → Logs |
| Deploy failed | GitHub → Actions → Deploy (the failing step), then Cloud Build → History |
| CORS error in the browser | `WEB_ORIGIN` on Cloud Run must be exactly the Firebase URL |
| Feedback stuck on "Preparing" or failing | The `jobs` row's `lastError` and the `feedback` row's `error` for that session. A `DEADLINE_EXCEEDED` means Gemini needed longer than `EVALUATION_TIMEOUT_MS` |
| `/admin` shows 404 for the owner | `ADMIN_EMAILS` must list the email, and the email must be confirmed |
| Sign-in emails link to localhost | Supabase → Authentication → URL Configuration → Site URL |
| End-to-end CI job fails at sign-in | The test account's password changed: update the `E2E_PASSWORD` secret |
| The bill jumps | Check billable instance time (above) and the Gemini SKUs in Billing → Reports |

## One-time setup (already done)

The project, APIs, service accounts, Workload Identity Federation, Secret Manager entries, Firebase
Hosting site and GitHub variables were set up in Sprint 2. The step-by-step record is in
[archive/sprint-2.md](archive/sprint-2.md#deployment-google-cloud).
