# Sprint 3 and 4 plan

This plan replaces the old Sprint 2 issues. It covers everything until the final evaluation, so
the whole team can see the full scope now. Each person owns **one feature that users can see**, end
to end: the screen, the API, the database and the tests. Each person's work also includes one
smaller add-on.

- [1. Order of work](#1-order-of-work)
- [2. Rules](#2-rules)
- [3. Who builds what](#3-who-builds-what)
- [4. Agreements so nobody waits](#4-agreements-so-nobody-waits)
- [5. How to start your feature](#5-how-to-start-your-feature)
- [6. How to test locally](#6-how-to-test-locally)
- [7. How to give your AI assistant the context it needs](#7-how-to-give-your-ai-assistant-the-context-it-needs)
- [8. Each person's feature in detail](#8-each-persons-feature-in-detail)

## 1. Order of work

| Phase | What |
|---|---|
| **Start** | Prayag merges the folder move (#66) first. Everyone sets up locally (§5). |
| **Design** | Everyone posts a half-page design on their issue (§5, step 6). Prayag approves within a day. |
| **Sprint 3** | Build your **main feature**. **Done means it works on the live site**, with a screen recording in the PR. |
| **Sprint 4** | Build your **add-on**, and fix whatever Sprint 3 broke. |
| **Feature freeze** | After this, bug fixes only. |
| **Before the final evaluation** | Quality review of 20 sessions (Rahi runs it, everyone reviews), bug fixes, demo rehearsals. |

## 2. Rules

1. **One owner per feature.** You can ask anyone for help, but you are responsible for your
   feature working on https://ai-interviewer-it314.web.app.
2. **Your code merges as your own PR.** Nobody else rewrites or ports your work. Keep PRs under
   about 300 changed lines; split a bigger feature into two PRs.
3. **Design before code.** Post the half-page design on your issue first (§5, step 6).
4. **Done = it works on the live site, shown in a screen recording.** Passing tests alone is not done.
5. **Stay in your own files.** Section 8 lists them. If you must change someone else's file, agree
   it with them first. Section 4 lists the places where two people meet.
6. The rules in [CONTRIBUTING.md](../CONTRIBUTING.md) still apply. In particular, never run
   `prisma migrate dev` or `prisma migrate reset` against the shared database, and never commit a
   `.env` file.

### How the work was sized

Everyone uses AI assistants, so writing the code is the quick part. The estimates count where
the time actually goes:

- finding where to change things;
- setup in web consoles that AI can't do (Google Cloud, Supabase, email);
- testing by hand (voice can only be tested by speaking into a microphone);
- careful database changes;
- checking that the AI's code really works on the live site.

**Each person totals about 3.5 days of work**: about 2.5 for the main feature and about 1 for
the add-on. Section 8 breaks down every estimate.

## 3. Who builds what

| Person | Main feature (Sprint 3) | Add-on (Sprint 4) | Days |
|---|---|---|---|
| **Prayag** | **Pick a focus within a role** (e.g. Backend → Databases); the interview uses it. Plus the folder move (#66) and the single role-picker address (#68) | TypeScript cleanup (#52) and CI updates (#53) | 2.5 + 1 |
| **Vishwa** | **Talk to a real AI interviewer by voice**, and interrupt it (Gemini Live) | Better microphone capture and a timeout on the token request (#54, part 1); measure response time (NFR-01) | 2.75 + 0.75 |
| **Kishan** | **The interviewer behaves like a real one**: introduces itself, follows up, never repeats, closes on time. Instructions are built on the server and locked into the voice token. Plus deleting the unused question list (#67) | **Interviews longer than 10 minutes** keep going: reconnect without losing the conversation (#54, part 2) | 2.5 + 1 |
| **Prakriti** | **The interviewer asks about your resume.** Fix the AI resume reader, store the profile as JSON, write the context-storage ADR (the TA's NoSQL question) | **No repeated questions across your last 3 interviews** (FR-16) | 2.5 + 1 |
| **Shaurya** | **Feedback appears every time**, with strengths, things to improve and quotes from your answers; measure the 15-second target (#63) | **Cost per interview**: record what each interview costs (NFR-16) | 2.5 + 1 |
| **Rahi** | **Feedback judges you by your role** (per-role rubrics, STAR for behavioural answers), plus a **Try again** button when feedback fails | **Quality review kit**: export 20 sessions and a review sheet for NFR-18/19 | 2.5 + 1 |
| **Praneel** | **See your past interviews**: a history list, each transcript, and its feedback | **Accessibility pass** on every screen, and a check in Chrome, Firefox, Edge and Safari (NFR-14, NFR-15) | 2.25 + 1.25 |
| **Vismay** | **Delete an interview or your whole account**; old interviews **delete themselves after 30 days** | **"Keep this interview"** so it isn't deleted after 30 days (FR-29); a 5-person first-timer trial (NFR-13) | 2.5 + 1 |
| **Ved** | **The interview works without Gemini**: split the interview screen into readable pieces (#69), then fix the voice bugs (#59–#62) | **Typed interview mode**: do a whole interview by typing (FR-30) | 2.5 + 1 |
| **Raj** | **Sign in with Google**, **reset a forgotten password**, **stay signed in**; plus the README (#44) | **Upgrade Prisma 5 → 7** (#51), after everyone else's database changes are merged | 2.5 + 1 |

## 4. Agreements so nobody waits

Agree on these at the start. Until the other person's part is merged, build against the
placeholder in the right-hand column.

| Where two people meet | The agreement | Until it's merged |
|---|---|---|
| Kishan's interviewer instructions take input from Prayag, Prakriti and Kishan himself | `buildBriefing(input: { roleId: string; focus?: string; resumeSummary?: string; pastQuestions?: string[] }): string` in `apps/api/src/services/briefing.service.ts`. Kishan creates the file with this signature first. | Leave your field out; the function works without it |
| Rahi's rubrics feed Shaurya's evaluator | `getRubric(roleId: string)` in `apps/api/src/services/rubrics.ts` returns the same shape as today's `RUBRIC` in `evaluator.service.ts` | The evaluator keeps using today's general rubric |
| Vishwa's voice and Ved's browser speech | Vishwa writes Gemini Live in a **new file**, `apps/web/src/lib/geminiLiveAdapter.ts`. In `voiceAdapter.ts`, Vishwa changes only `createVoiceSessionAdapter()`. Ved owns the rest of `voiceAdapter.ts`. | The browser-speech adapter stays the default |
| The interview screen | Ved owns `InterviewRoom` and the pieces #69 splits it into. Vishwa's only change there is "if the adapter is Gemini (`isExternalProvider`), don't use the local question list". He makes it after #69 merges. | — |
| Delete buttons on the history page | Vismay adds the delete button to Praneel's history page after Praneel merges it. Until then it goes on the results page. | — |
| Database changes | Prayag (`Session.focus`), Prakriti (`Resume.parsedProfile` → JSON, a list of past questions if needed), Vismay (cascading deletes, `Session.keep`) and Shaurya (cost columns) each add **their own migration** (§6). Raj's Prisma upgrade waits until all of these are merged. | — |
| Everyone | Prayag merges the folder move (#66) first; everyone starts after that | — |

## 5. How to start your feature

1. **Get access.** Accept the GitHub invite, install [Bun](https://bun.sh) and Git, and clone:
   `git clone https://github.com/prayag-kachhia/AI-Interviewer.git`.
2. **Get the secret values.** Ask Prayag privately for the values for `apps/api/.env` and
   `apps/web/.env.local`. Never paste them into GitHub, a group chat or an AI tool.
3. **Run the app** (§6) and do one full interview with typed answers. You should have seen the
   whole flow before changing any of it.
4. **Read your section** in §8 and your GitHub issue. The **Start here** list is where you begin.
5. **Make a branch** from an up-to-date `main`: `git checkout main && git pull && git checkout -b <area>/<short-name>`,
   e.g. `feedback/role-rubrics`.
6. **Post your design** as a comment on your issue before you start building. Half a page:
   - **What the user sees** when it's done.
   - **What changes in each layer**: screen, API, database, contracts. Write "none" where nothing changes.
   - **Requirement IDs** covered.
   - **How you'll test it**, locally and on the live site.
   - **Who you depend on**, from §4.
7. **Build it with your AI assistant** (§7). Commit in small steps with
   [Conventional Commits](https://www.conventionalcommits.org/), e.g. `feat(feedback): add per-role rubrics`.
8. **Test it locally** (§6) using the checklist in your §8 section, then run `bun run typecheck` and `bun run test`.
9. **Open a PR** using the template, with a screen recording attached. Prayag reviews it within 24 hours.
   Fix what he asks for yourself; nobody fixes it for you.
10. **After it merges**, the site redeploys in about 3 minutes. Check your feature on
    https://ai-interviewer-it314.web.app and add a recording from the live site to the PR.

## 6. How to test locally

### Run the app

```bash
bun install                                    # also generates the Prisma client
cp apps/api/.env.example apps/api/.env         # fill in with the values from Prayag
cp apps/web/.env.example apps/web/.env.local   # fill in with the values from Prayag
bun run dev                                    # API on http://localhost:3000, web on http://localhost:5173
```

Open http://localhost:5173 and sign up with your own test account. http://localhost:3000/health
should answer `status: ok`.

**Your local app uses the shared Supabase database.** Use your own test account, and never
delete rows that aren't yours.

### Check your code

```bash
bun run typecheck   # required: Bun and Vite run code without checking types
bun run test        # API tests; Gemini is mocked, so they don't call the real API
```

Add tests for what you build. Use the existing ones in `apps/api/src/__tests__/` as examples
(`session.test.ts`, `feedback.test.ts`, `evaluator.test.ts`).

### Testing voice

- Use **Chrome or Edge**, with **headphones**, so the microphone doesn't pick up the interviewer's voice.
- **Chromium on Linux** has no speaking voices until you install `speech-dispatcher` and `espeak-ng`.
  Without them the browser interviewer is silent.
- Gemini Live (Vishwa, Kishan) needs `GEMINI_API_KEY` in `apps/api/.env`. To try Gemini Live on
  its own, run `bun spike/server.ts` and open http://localhost:4000.

### Testing feedback

The API runs the feedback worker inside itself. End an interview and the results screen polls
until feedback is ready. If it fails, look at the `Job` table in Supabase (Table Editor): the
`lastError` column holds the reason.

### Changing the database

Never run `prisma migrate dev` against the shared database: it can wipe it. Create your migration
against a **throwaway local Postgres** instead:

```bash
docker run --name interview-pg -e POSTGRES_PASSWORD=postgres -p 5432:5432 -d postgres:16
cd apps/api
# 1. edit prisma/schema.prisma, then create the migration file locally:
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/postgres" bunx prisma migrate dev --create-only --name add_session_focus
# 2. read the generated SQL in prisma/migrations/<timestamp>_add_session_focus/migration.sql
# 3. apply it to the local database and regenerate the client:
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/postgres" bunx prisma migrate dev
bun run db:generate
```

To run the app against your local database while testing a schema change, point `DATABASE_URL`
in `apps/api/.env` at it temporarily. Change it back afterwards. When your PR merges, the deploy
workflow applies your migration to the shared database automatically.

The lead must review any change to `schema.prisma`, migrations, `package.json` or `bun.lock`.
Never edit a migration that is already on `main`.

## 7. How to give your AI assistant the context it needs

The repo has an [`AGENTS.md`](../AGENTS.md) at the top level, with the project's layout, rules and
commands. Codex, Cursor and GitHub Copilot read it automatically. For Claude Code, create a local
`CLAUDE.md` containing the line `@AGENTS.md`. It's in `.gitignore`, so it stays on your machine.
If your tool is a chat window, paste `AGENTS.md` in first.

Then start every task with this prompt. Fill in the parts in angle brackets:

```
I'm working on the AI Interviewer repo. Read AGENTS.md first.

My task is GitHub issue #<number>:
<paste the whole issue, including Start here and the acceptance criteria>

My section of docs/sprint-3.md:
<paste your §8 section>

Start by reading these files: <the Start here list>.

Before you write any code, give me a plan: which files you'll change, what you'll add to each,
and how I'll test it. Only change files in my feature unless the plan says why.
After the changes, run `bun run typecheck` and `bun run test` and fix anything that fails.
```

Then:

1. **Read the plan before saying yes.** If it touches files outside your feature or §4, ask why.
2. **Build one step at a time.** For example: API first, then the screen. Run the app after each step.
3. **Read the diff yourself** (`git diff`) before committing. You own every line you submit,
   including the ones the AI wrote. Prayag will ask you to explain them.
4. **Never give the AI your `.env` values**, and never let it run `prisma migrate dev` against the
   shared database.
5. **When it's stuck, give it evidence**: the exact error, the browser console, the Network tab,
   or the server log. Don't just say "it doesn't work".

## 8. Each person's feature in detail

Every section has the same parts:

- **Build:** what you build.
- **Start here:** where to begin, in the order a request travels from the screen to the database.
- **Why it takes this long:** the estimate, broken down.
- **Test it:** how to check it locally.

File paths assume the folder move (#66) is merged.

### Prayag: choose a focus within a role (FR-07)

**Build:** each role offers 3–4 focuses, for example Software Engineer → Frontend / Backend / System
design. The candidate picks one with the role, it's saved on the session, and it's passed to the
interviewer as `focus`. Also #66 (folder move, merged first) and #68 (single role-picker
address). Add-on: #52 and #53.

**Start here:**
1. `packages/contracts/src/index.ts` → `ROLES`. Add a `focuses` list to each role.
2. `apps/web/src/features/sessions/NewInterview.tsx`: the role picker.
3. `apps/web/src/lib/api.ts` → `createSession()`.
4. `apps/api/src/routes/session.routes.ts` → `POST /`.
5. `apps/api/src/controllers/session.controller.ts` → `postSession()`: reject an unknown focus with 400.
6. `apps/api/src/services/session.service.ts` → `createSession()`.
7. `apps/api/prisma/schema.prisma` → `model Session`. Add `focus String?` in a new migration.

**Why it takes this long (2.5 + 1):**
- Folder move: 0.5. The AI moves the files quickly, but every screen has to be checked afterwards.
- Role-picker address: 0.25.
- Focus: 1.75. It touches every layer: the shared shapes 0.25, the migration 0.5, the API check 0.5, the picker 0.5.
- Add-on: 0.5 each for #52 and #53. Both are config changes, verified by CI going green.

**Test it:**
- Pick a role and a focus; the new `Session` row has the focus.
- Send an unknown focus with the API (curl or a test); you get 400.
- Add a test in `session.test.ts`.

### Vishwa: real voice interview with Gemini Live (FR-12, FR-14, NFR-01)

**Build:** a `GeminiLiveVoiceAdapter` in `apps/web/src/lib/geminiLiveAdapter.ts`, implementing
the `VoiceSessionAdapter` interface. It must:
- get a token from `POST /api/sessions/:id/voice-token`;
- open the Gemini Live WebSocket with model **`gemini-3.8-live`**, not the spike's model, which
  is being retired;
- **wait for `setupComplete`** before streaming the microphone;
- play the AI's audio, and stop it when `interrupted` arrives;
- join transcript chunks into one turn per speaker and post each turn as today;
- fall back to browser speech if the token or the connection fails.

Once Kishan locks the token, the browser must not send its own `systemInstruction`. Add-on: an
AudioWorklet for microphone capture (replacing the deprecated `createScriptProcessor`), a 5-second
timeout on the token request, and timing the interviewer's first response (NFR-01: within 5 s).

**Start here:**
1. `spike/index.html`: your working prototype. Most of the audio code can be reused.
2. `apps/web/src/lib/voiceAdapter.ts` → the `VoiceSessionAdapter` interface and `createVoiceSessionAdapter()`.
3. `apps/web/src/lib/api.ts`: add `getVoiceToken(sessionId)`.
4. `apps/api/src/controllers/session.controller.ts` → `postVoiceToken()`. It already exists.
5. The interview screen (Ved's, after #69): the one change in §4.

**Why it takes this long (2.75 + 0.75):**
- Connect, set up, stream and play, from the spike: 1.
- Joining transcripts into turns: 0.5.
- Interruption and fallback: 0.5.
- Real spoken testing in Chrome and Chromium: 0.75. AI assistants often get audio formats and the
  handshake wrong, and each attempt needs a real voice test.
- Add-on: AudioWorklet 0.5, timeout and timing 0.25.

**Test it:**
- Local app in Chrome with headphones: a 3-question spoken interview.
- Interrupt the interviewer; it stops.
- The transcript in the database has one row per turn.
- Turn off Wi-Fi before starting; the interview falls back to browser speech.

### Kishan: the interviewer behaves like a real one (FR-13, FR-15, FR-17, DR-01, DR-02)

**Build:** `apps/api/src/services/briefing.service.ts` with `buildBriefing(input)` (signature in §4).
It writes the interviewer's instructions:
- a persona for the role, and the focus if given;
- introduction → 3–4 role questions → closing;
- follow up on the previous answer;
- never repeat a question, including any in `pastQuestions`;
- wrap up at the time limit;
- use `resumeSummary` if given.

Then change `voice-provider.service.ts` to mint the token with these instructions **locked in**:
the SDK's `authTokens.create` with `liveConnectConstraints` and `lockAdditionalFields: []`, plus
`sessionResumption: {}`. Also do #67. Add-on: when Gemini sends `GoAway` or the connection drops,
reconnect with the resumption handle so a 15–45 minute interview continues. Do it in Vishwa's
adapter after his PR merges.

**Start here:**
1. `apps/api/src/services/voice-provider.service.ts` → `mintVoiceToken()`.
2. `apps/api/src/controllers/session.controller.ts` → `postVoiceToken()`. It must pass the session's role and focus.
3. `apps/api/src/services/session.service.ts` → `getOwnedSession()`.
4. `spike/index.html`: for testing.
5. `apps/api/src/__tests__/voice-token.test.ts`: the existing tests.

**Why it takes this long (2.5 + 1):**
- Writing the instructions and trying them in real voice interviews: 1. You only learn whether a prompt works by talking to it.
- Locking the token: 0.75. Whether it needs `v1alpha` or `v1beta` is unresolved, so it has to be tried with the real key.
- Tests for `buildBriefing`: 0.5.
- #67: 0.25.
- Add-on: reconnection 1. It's hard to test because you have to wait for the 10-minute limit or simulate a dropped connection.

**Test it:**
- Unit-test that the briefing contains the role, the focus, the structure and the time limit.
- To try a locked token by voice: run the spike locally, change its token request to your local
  API's endpoint, and delete its own `systemInstruction`. Keep those changes local and don't commit them.

### Prakriti: the interview uses your resume (FR-08, FR-09) and the context-storage ADR

**Build:**
1. Fix the AI resume reader. It currently falls back to the simple heuristic reader: check the
   server log for `[AI Service] Gemini resume analysis failed`.
2. Change `Resume.parsedProfile` from text to JSON (`Json` in Prisma, `jsonb` in Postgres) with a
   migration that **converts the rows already there**.
3. Write `summarizeProfile(profile): string`, 3–5 lines for the interviewer. The voice-token
   controller passes it as `resumeSummary`.
4. Write `docs/adr/0010-context-storage.md`: why Postgres JSONB rather than NoSQL for resumes,
   transcripts and context. This answers the TA's questions 2 and 3.

Add-on (FR-16): look up the AI questions from the candidate's last 3 sessions and pass them as
`pastQuestions`, so the interviewer doesn't repeat them.

**Start here:**
1. `apps/web/src/features/profile/Dashboard.tsx`: the resume upload.
2. `apps/web/src/lib/api.ts` → `uploadResume()`.
3. `apps/api/src/routes/resume.routes.ts` → `POST /analyze`.
4. `apps/api/src/controllers/resume.controller.ts` → `analyzeResume()`.
5. `apps/api/src/services/gemini.service.ts` → `analyzeResumeWithAI()`. Also `heuristic.service.ts` and `pdf.service.ts`.
6. `apps/api/prisma/schema.prisma` → `model Resume`.

**Why it takes this long (2.5 + 1):**
- Fixing the reader and checking it on 3 real resumes: 0.5.
- The JSON migration: 0.75. It converts existing data on the shared database, so it needs care
  and a test on your local Postgres first.
- The summary: 0.5.
- The ADR: 0.75. Reading, comparing the options and arguing a choice, not coding.
- Add-on: 1. A query over past sessions, and passing the result in.

**Test it:**
- Upload 3 different resumes; the profile shows real fields, and the log has no "failed" line.
- Run the migration on your local Postgres with an old text row; it becomes JSON.
- Start an interview after uploading; the first question mentions the resume. This needs Kishan's work.

### Shaurya: feedback appears every time (FR-21, FR-22, NFR-03, NFR-04)

**Build:**
1. **Find why feedback fails on the live site.** Read `Job.lastError` in Supabase, or the Cloud Run
   logs (ask Prayag for access), and fix it. The model name `gemini-3.8-flash` is the first suspect.
2. Add **strengths**, **things to improve** and a **quote from the candidate** to each score: in the
   `Feedback` shape in `packages/contracts`, the evaluator prompt, and its validation.
3. Show them on the results screen.
4. Time 5 live sessions from "End" to feedback (target: under 15 s) and write the numbers on #63.

Add-on (NFR-16): record the tokens each evaluation uses (`usageMetadata` on the Gemini response)
and the interview's length, and work out the cost per interview in ₹ so Prayag can set the limit.

**Start here:**
1. `apps/web/src/features/feedback/ResultsScreen.tsx`, `useFeedback.ts`, `feedbackApi.ts`.
2. `apps/api/src/routes/feedback.routes.ts` → `GET /:id/feedback`.
3. `apps/api/src/controllers/feedback.controller.ts`.
4. `apps/api/src/services/feedback.service.ts`, then `evaluator.service.ts`: the only file that calls Gemini for feedback.
5. `apps/api/src/worker.ts` and `job-queue.service.ts`: how the job runs.
6. `apps/api/prisma/schema.prisma` → `model Feedback`, `model Job`.

**Why it takes this long (2.5 + 1):**
- Finding the live failure: 0.5. It needs log access and a test session.
- Changing the shape and the evaluator: 0.75. The change ripples into the web types and the tests.
- The results screen: 0.5.
- Timing 5 live sessions, and tests: 0.75.
- Add-on: 1. Reading the token counts, a migration for the cost columns, and the calculation.

**Test it:**
- End a local interview with 3 typed answers; feedback appears with all the new parts.
- In `evaluator.test.ts`, a reply missing a part is rejected.
- Repeat on the live site after merging.

### Rahi: feedback judged by role (FR-20, DR-03, DR-04) and retry (NFR-04)

**Build:**
1. Write `apps/api/src/services/rubrics.ts` with `getRubric(roleId)` (§4): a rubric for each of the
   3 roles, with categories and criteria that differ by role. Behavioural answers are judged with
   **STAR** (Situation, Task, Action, Result).
2. In `evaluator.service.ts`, use `getRubric(roleId)` instead of the fixed `RUBRIC`. That's a small
   change in Shaurya's file, so merge after him or rebase.
3. **Retry:** `POST /api/sessions/:id/feedback/retry`.
   - Only the session's owner can call it; anyone else gets 404, as FR-27 requires.
   - It only works when feedback has failed.
   - It queues the job again.
4. A **Try again** button in the results screen's failed state.

Add-on: a script that exports 20 sessions (transcript plus feedback) into a review sheet, with the
NFR-18 (question relevance) and NFR-19 (feedback quality) checklists. You run the review with two
reviewers per session before the final evaluation.

**Start here:**
1. `apps/api/src/services/evaluator.service.ts` → `RUBRIC`, `buildEvaluationPrompt()`.
2. `apps/api/src/routes/feedback.routes.ts` and `controllers/feedback.controller.ts`: add the retry route.
3. `apps/api/src/services/job-queue.service.ts`: how jobs are queued and claimed.
4. `apps/web/src/features/feedback/ResultsScreen.tsx`: the failed state.

**Why it takes this long (2.5 + 1):**
- Writing 3 rubrics: 1. Thinking work: what makes a strong data-analyst answer versus a strong backend answer?
- Wiring and tests: 0.5.
- Retry: 1. The endpoint, the owner check, resetting the job, and the button.
- Add-on: 1. The export script and the sheet.

**Test it:**
- Tests for `getRubric` and the retry endpoint, covering the owner, a stranger (404), and feedback that hasn't failed.
- Locally, temporarily break the Gemini key, end an interview, see the failed state, restore the key, press Try again; feedback appears.

### Praneel: interview history (FR-25, FR-26)

**Build:**
1. **`GET /api/sessions`**: the signed-in user's sessions, newest first, with role, date, status
   and feedback status. It doesn't exist yet. Add it **before** the `/:id` route.
2. A **History page** listing them, linked from the navbar.
3. A **transcript view** for one session, with a link to its feedback.
4. Decide what "ended early" means (for example, ended before the time limit) and show it.

Add-on: an accessibility pass on every screen (form labels, keyboard use, contrast, visible focus),
and checking the main flow in Chrome, Firefox, Edge and Safari (NFR-14, NFR-15). Do it after the other
features have merged.

**Start here:**
1. `apps/web/src/components/Navbar.tsx` and `apps/web/src/App.tsx`: the link and the route.
2. `apps/web/src/lib/api.ts`: add `listSessions()`.
3. `apps/api/src/routes/session.routes.ts`.
4. `apps/api/src/controllers/session.controller.ts` and `services/session.service.ts`: add `listSessions(userId)`.
5. `apps/api/prisma/schema.prisma` → `Session`, `Turn`, `Feedback`.

**Why it takes this long (2.25 + 1.25):**
- The endpoint: 0.5.
- Two pages: 1.
- The "ended early" decision: 0.25.
- Empty and error states, and tests: 0.5.
- Add-on: accessibility 0.75. Browsers 0.5: four browsers by hand.

**Test it:**
- Do 2 interviews and see both in History.
- Open a transcript.
- Sign in as another user: you see none of the first user's sessions.
- An API test that another user's sessions never appear.

### Vismay: delete your data (FR-28, NFR-11)

**Build:**
1. A migration adding `onDelete: Cascade` to the relations (User → Resume and Session; Session →
   Turn, Job and Feedback). Today deleting an account fails because the rows are still referenced.
2. `DELETE /api/sessions/:id`: owner only, 404 for anyone else.
3. Fix the existing `DELETE /api/auth/account` so it also removes the Supabase login.
4. Delete buttons with a confirmation step: on the results page, and on Praneel's History page once it merges.
5. A daily **retention job** in the worker that deletes sessions older than 30 days.

Add-on:
- **FR-29:** a `Session.keep` flag and a **Keep this interview** button; the retention job skips kept sessions.
- **NFR-13:** watch 5 classmates who have never used the app start an interview, time them (target: under 5 minutes), and write up what confused them.

**Start here:**
1. `apps/web/src/features/profile/Profile.tsx`: account deletion.
2. `apps/api/src/routes/auth.routes.ts` → `DELETE /account`, `controllers/auth.controller.ts` → `deleteAccount()`.
3. `apps/api/src/routes/session.routes.ts`: add `DELETE /:id`.
4. `apps/api/src/services/session.service.ts` → `getOwnedSession()`. Reuse it for the owner check.
5. `apps/api/src/worker.ts` and `job-queue.service.ts`: where a daily job fits.
6. `apps/api/prisma/schema.prisma`: every relation.

**Why it takes this long (2.5 + 1):**
- The cascade migration: 0.5. It's on the shared database, so test it on your local Postgres first.
- The delete endpoints, plus deleting the Supabase user: 0.75.
- The buttons and confirmation: 0.5.
- The retention job: 0.75.
- Add-on: keep flag 0.5, trial 0.5.

**Test it:**
- Delete a session; its turns and feedback are gone.
- Delete a test account; you can't sign in again.
- Test the retention job by temporarily setting a session's date to 31 days ago in your local database.

### Ved: the interview works without Gemini (FR-30, NFR-15)

**Build, in this order:**
1. **#69:** split the interview screen into a `useInterview` hook and small components. It must behave exactly the same.
2. **#59 (B1):** the interviewer's own voice is saved as the answer.
3. **#60 (B2):** answers are cut off after a 2.4-second pause.
4. **#61 (B3):** turns are rejected when the laptop clock is ahead.
5. **#62 (B4):** reloading the page leaves the interview silent.
6. **The late-result bug:** Chromium sends one more result after recognition stops. `onresult`
   must ignore results while not listening, and the stale answer must be cleared when a new question starts.
7. **No voices:** if the browser can't speak, show the question clearly and a short warning.

Add-on (FR-30): a proper **typed interview mode**, a "Type my answers instead" switch in the
interview room that runs the whole interview by typing.

**Start here:**
1. `apps/web/src/features/sessions/InterviewRoom.tsx`: the line ranges for each piece are in #69.
2. `apps/web/src/lib/voiceAdapter.ts` → `BrowserWebSpeechVoiceAdapter`: `onresult`, `speakAiQuestion()`, `finishCandidateTurn()`.
3. `apps/api/src/services/session.service.ts` → `addTurn()`: for B3.

**Why it takes this long (2.5 + 1):**
- #69: 0.75. Mechanical with AI, but the whole interview has to be re-tested.
- B1, B2, late-result and no-voices: 1.25. Each fix is small, but each needs a microphone test in
  Chrome and Chromium.
- B3: 0.25.
- B4: 0.25.
- Add-on: 1.

**Test it:**
- The same 3-question interview before and after #69.
- Each bug's acceptance criteria in its issue.
- A full typed interview with the microphone blocked.

### Raj: Google sign-in, password reset, stay signed in (FR-02, FR-04, FR-05) and the README (#44)

**Build:**
1. **Google sign-in:** create an OAuth client in Google Cloud, turn on the Google provider in
   Supabase (Authentication → Providers), add a "Continue with Google" button, and add the redirect
   addresses for `http://localhost:5173` and `https://ai-interviewer-it314.web.app`.
2. **Password reset:**
   - A "Forgot password?" flow with Supabase's reset email.
   - Supabase's built-in email only sends a few messages an hour, so set up a proper email service (custom SMTP, e.g. Resend or a Gmail app password) in Supabase.
3. **Stay signed in:** a checkbox. When it's off, the session ends when the browser closes.
4. **README (#44).**

Add-on (#51): upgrade Prisma 5 → 7 (pin `^7`, not `latest`), **after** everyone's migrations have
merged. All tests and a full interview must pass afterwards.

**Start here:**
1. `apps/web/src/features/identity/Login.tsx`.
2. `apps/web/src/context/AuthContext.tsx` → `signIn`, `signUp`, and the session setup.
3. `apps/web/src/lib/supabase.ts`.
4. Supabase dashboard: Authentication → Providers, URL Configuration, SMTP settings. Ask Prayag for access.

**Why it takes this long (2.5 + 1):**
- Google: 0.75. Console clicking and redirect addresses that AI can't do, usually trial and error.
- Reset: 0.75, including setting up the email service.
- Stay signed in: 0.25.
- README: 0.5.
- Testing: 0.25.
- Add-on: 1. Prisma 7 changes how the client is generated and configured, and every database call
  has to be re-checked.

**Test it:**
- Sign in with Google locally and on the live site.
- Request a reset email, follow the link, and sign in with the new password.
- With "stay signed in" off, close and reopen the browser; you're signed out.
