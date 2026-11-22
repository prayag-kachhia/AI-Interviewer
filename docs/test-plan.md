# AI Interviewer: Master Test Plan

- **Project:** AI-Interviewer
- **Deliverable ID:** D-4 (#204)
- **Document Type:** Software Engineering Master Test Plan
- **Sprint:** 5 (Final Sprint)
- **Document Version:** 1.1.0
- **Document Date:** November 22, 2026
- **Lead Owner:** Rahi
- **Review Partner:** Ved
- **Target System Revision:** Git commit `aceff94` (`docs/d-4-test-plan-report`)

---

## Table of Contents

1. [Document Identification & Metadata](#1-document-identification--metadata)
2. [Introduction and Objectives](#2-introduction-and-objectives)
3. [System Under Test Architecture](#3-system-under-test-architecture)
4. [Scope and Exclusions](#4-scope-and-exclusions)
5. [Testing Strategy and Levels](#5-testing-strategy-and-levels)
6. [Test Environments, Mocking, and Tooling](#6-test-environments-mocking-and-tooling)
7. [Requirements Traceability Matrix](#7-requirements-traceability-matrix)
8. [Detailed Test Cases](#8-detailed-test-cases)
9. [Manual Voice Testing Plan](#9-manual-voice-testing-plan)
10. [Cross-Browser Testing Plan](#10-cross-browser-testing-plan)
11. [Entry, Suspension, and Exit Criteria](#11-entry-suspension-and-exit-criteria)
12. [Defect Management and Severity Classification](#12-defect-management-and-severity-classification)
13. [Test Execution and Reproduction Commands](#13-test-execution-and-reproduction-commands)
14. [References](#14-references)

---

## 1. Document Identification & Metadata

This master test plan establishes the formal verification and validation strategy for the **AI Interviewer** platform, developed for IT314 (Software Engineering, DA-IICT). The document governs all testing tiers required to evaluate functional correctness, integration stability, AI evaluation accuracy and consistency, conversational latency, accessibility compliance, and release readiness.

- **Repository:** `prayag-kachhia/AI-Interviewer`
- **Issue Reference:** Issue #204 (D-4 · Test plan and test report)
- **Upstream Dependencies:**
  - S-4: Land the benchmark script with real numbers (#95, PR #220)
  - S-7: Consistency and fairness test (#165, PR #309)
  - PN-5: Automated accessibility checks on every screen (#172, PR #310)
  - P-14: End-to-end golden-path test in CI (#200, PR #318)
- **Baseline Commit:** `aceff94`
- **Associated Deliverable:** `docs/test-report.md`

---

## 2. Introduction and Objectives

AI Interviewer is an automated mock interview platform. A candidate signs in via Supabase authentication, uploads a PDF resume, selects a target engineering role (Software Engineer, Data Analyst, or Backend Developer), customizes seniority level and focus, and conducts an interactive interview with an AI interviewer via real-time streaming voice or typed text. Upon completion, the system executes asynchronous evaluation, generating structured feedback, per-answer grades, category radar charts, and improvement recommendations.

### Primary Testing Objectives

1. **Functional Correctness:** Verify that candidate registration, profile management, resume parsing, interview turn progression, and historical session queries execute strictly according to specification.
2. **Integration Reliability:** Ensure seamless contract adherence between the React client, layered Express API, Prisma 7 ORM, and PostgreSQL database without data drift or orphan records.
3. **AI Grading Fidelity & Determinism:** Validate that the Large Language Model (Gemini) evaluates candidate transcripts against published role rubrics accurately (S-4) and consistently across repeated evaluations (S-7), ruling out prompt instability.
4. **Conversational Responsiveness:** Enforce the interactive spoken response latency requirement (NFR-01: spoken response within 5 seconds for at least 95% of turns).
5. **Accessibility Compliance:** Guarantee that all interactive non-audio user interfaces conform to WCAG 2.1 Level AA standards across contrast, keyboard navigation, and screen-reader accessibility (NFR-14 / PN-5).
6. **Cross-Browser & Device Portability:** Ensure the application operates reliably across modern desktop browsers (Chrome, Edge, Firefox, Safari) and handles audio hardware configurations gracefully (NFR-15).
7. **Continuous Regression Prevention:** Automate unit, component, schema, and end-to-end tests within GitHub Actions to prevent regressions on every pull request.

---

## 3. System Under Test Architecture

The AI Interviewer application is configured as a Bun multi-package monorepo:

```
[packages/contracts] <--- Shared Zod schemas (Roles, Sessions, Turns, Feedback)
         |
         +---------------------------------------+
         |                                       |
         v                                       v
    [apps/web]                              [apps/api]
React 19 + Vite + Tailwind v4           Express 5 + Prisma 7 (PostgreSQL)
  - AudioWorklet (16 kHz PCM)             - Layered Routes & Services
  - Gemini Live WebSocket Client          - Ephemeral Voice Token Minting
  - Web Speech Fallback Adapter           - Background Job Worker (SKIP LOCKED)
  - Radix UI + Recharts + Lucide          - Gemini SDK Evaluation Service
```

### Architectural Subsystems

1. **Frontend Application (`apps/web`):**
   - Built on React 19, Vite, and Tailwind CSS v4 without CSS preflight until final cleanup.
   - Design system implemented via Radix UI primitives (`Button`, `Card`, `Badge`, `Alert`, `Dialog`, `Avatar`, `Progress`, `RadioGroup`) styled with dynamic theme tokens supporting three visual themes: Swiss Broadsheet (light), Chronometer Deck / Haute (gold dark), and Graphite (cool dark).
   - Real-time audio streaming driven by an `AudioWorkletNode` (`pcmCaptureWorklet.ts`) converting microphone input to 16 kHz 16-bit linear PCM chunks sent every 40 ms.
   - Dual voice transport architecture managed through `VoiceSessionAdapter`:
     - Primary: `GeminiLiveVoiceAdapter` opening a direct bidirectional WebSocket to Google Gemini Live (`gemini-3.8-live`) via an ephemeral token.
     - Fallback: `BrowserWebSpeechVoiceAdapter` utilizing the W3C Web Speech API (`SpeechRecognition` and `speechSynthesis`) paired with server-side question generation (`POST /api/sessions/:id/next-question`).
     - Text Alternative: Typed mode bypassing microphone capture entirely (FR-30).

2. **Backend Application (`apps/api`):**
   - Express 5 REST API organized strictly by resource under `src/routes/` (`auth`, `resume`, `sessions`, `feedback`, `insights`, `me`, `admin`) delegating to domain services under `src/services/`.
   - Data persistence managed by Prisma 7 on PostgreSQL.
   - Access control enforced via `src/middleware/auth.ts` (Supabase JWT verification) and `src/middleware/adminAuth.ts` (RBAC checking `ADMIN_EMAILS`).
   - Resource isolation policy (FR-27): Unauthorized attempts to access another candidate's resource return HTTP 404 (Not Found) rather than 403 (Forbidden).
   - Background worker (`src/worker.ts`): Implements an asynchronous job queue using PostgreSQL `FOR UPDATE SKIP LOCKED` to process evaluation tasks (`session.ended`), insights refresh (`insights.refresh`), and data retention purges (`retention.purge`).

3. **Shared Contracts (`packages/contracts`):**
   - Single source of truth for Zod schemas defining role metadata, session creation inputs, turn payloads, feedback scorecards, and user profiles. Shared between web and API to prevent interface divergence.

4. **External Integrations:**
   - Supabase Auth: User identity, email verification, password reset, and session JWTs.
   - Google Gemini API:
     - `gemini-3.8-flash`: Structured resume analysis, turn-by-turn question generation, feedback evaluation, and improvement insights.
     - `gemini-3.8-live`: Low-latency bidirectional conversational voice streaming over WebSockets.

---

## 4. Scope and Exclusions

### Features in Scope

- Candidate authentication (sign up, email OTP verification, login, password recovery, session persistence).
- Resume upload (PDF parsing, heuristic extraction, Gemini AI extraction, skill extraction, target role match).
- Interview setup (role selection, seniority level, technical focus area, company context, spoken voice vs. typed mode toggle).
- Audio pre-flight validation (microphone device enumeration, live audio level analysis).
- Interactive interview room execution (turn transcription accumulation, latency tracking, audio playback, candidate barge-in interruption, silence encouragement cues, countdown timers).
- Fallback mechanics (seamless downgrade from Gemini Live to Web Speech or typed fallback upon network or token failure).
- Automated feedback generation (overall evaluation, category rubric scoring, per-answer critique, model answer suggestions, performance radar visualizations).
- Longitudinal candidate history (chronological session listing, score trend charting, session deletion with cascading cleanup).
- Data privacy and compliance (complete account deletion, candidate data export, automated data retention purges).
- Administrator operations (platform-wide metrics, session summaries, role distribution statistics).
- Accessibility and theme rendering across Swiss, Haute, and Graphite palettes.

### Exclusions and Deferred Capabilities

- Load testing 100 concurrent spoken sessions (NFR-06) is deferred due to campus infrastructure and external LLM quota limitations.
- Live external Gemini Live automated testing in CI: CI environments do not stream real live voice over WebSockets to Google servers; continuous integration relies on the fake Gemini server (`fake-gemini.ts`) to maintain zero billing cost and deterministic pass/fail states (ADR-0016).
- Destructive testing against the team's shared Supabase database: All destructive migration and integration suites run exclusively against throwaway PostgreSQL test containers.

---

## 5. Testing Strategy and Levels

The verification strategy adopts a rigorous Software Engineering testing pyramid supplemented by specialized LLM evaluation and accessibility benchmarks:

```
                      / \
                     /   \
                    / E2E \       <-- Playwright Golden Path (Typed, Fake Gemini)
                   /-------\
                  / Bench   \     <-- S-4 Accuracy, S-7 Consistency, Latency
                 /-----------\
                / Integration \   <-- Supertest API, Prisma DB (SKIP LOCKED)
               /---------------\
              / Component & Unit\ <-- Vitest (Web UI, Axe, API Services, Contracts)
             /-------------------\
            /  Static Typecheck   \ <-- TypeScript Compiler (tsc)
           /-----------------------\
```

### 5.1 Static Typechecking
- **Tool:** TypeScript `~6.0.3` (`tsc --noEmit`).
- **Objective:** Detect type mismatches, missing properties, incorrect function signatures, and broken contracts across all packages without executing code.
- **Criteria:** Clean exit (code 0) across `@interview/contracts`, `@interview/api`, and `@interview/web`.

### 5.2 Frontend Unit and Component Testing
- **Tools:** Vitest v5.0.2, Testing Library React v16.3.3, jsdom.
- **Objective:** Validate isolated component rendering, user event dispatching, hook lifecycles, and UI state transitions.
- **Approach:** Mock browser APIs (`AudioContext`, `MediaDevices`, `WebSocket`, `SpeechRecognition`, `speechSynthesis`, `ResizeObserver`, canvas context). Assert DOM structure, ARIA accessibility attributes, error alerts, and navigation side-effects.

### 5.3 Automated Accessibility Testing (PN-5 / NFR-14)
- **Tools:** `vitest-axe` v0.1.0, `axe-core`.
- **Objective:** Enforce WCAG 2.1 Level AA compliance on every screen and component.
- **Scope:** 11 primary user screens, Navbar, ThemeSwitcher, and UI primitives across light and dark themes.
- **Criteria:** `expect(await axe(container)).toHaveNoViolations()` with 0 violations.

### 5.4 Backend Unit Testing
- **Tools:** Vitest v5.0.2 in Node environment.
- **Objective:** Verify pure business logic, input validation schemas, prompt generation, error wrapping, pricing calculations, and benchmark score spread algorithms.
- **Approach:** Mock external dependencies (`@google/genai`, `@supabase/supabase-js`, Prisma models).

### 5.5 API Integration Testing
- **Tools:** Vitest v5.0.2, Supertest v7.3.0.
- **Objective:** Verify HTTP transport, route parameter parsing, Express middleware chains, JWT authentication verification, authorization boundaries, and status code compliance.
- **Security Rule:** Enforce FR-27: unowned or cross-tenant resources must return HTTP 404 rather than 403 to prevent resource enumeration.

### 5.6 Database Integration Testing
- **Tools:** Vitest, Prisma Client against disposable PostgreSQL (Postgres 16 Alpine).
- **Objective:** Prove transactional integrity, cascading deletions, foreign key enforcement, and concurrent job queue operations (`FOR UPDATE SKIP LOCKED`).
- **Isolation:** Tests execute conditionally when `TEST_DATABASE_URL` is set; skipped when database configuration is absent. Never execute against shared production databases.

### 5.7 Continuous Integration (CI)
- **Tool:** GitHub Actions (`.github/workflows/ci.yml`).
- **Triggers:** Push to `main`, all pull requests.
- **Pipeline Structure:**
  - `check`: Runs on `ubuntu-latest` with a Postgres 16 container service. Installs dependencies via Bun frozen lockfile, runs typecheck, applies migrations to the test database, executes the full Vitest suite, and builds the Vite web client.
  - `docker`: Builds the production Docker image, boots the API container, probes `/health` endpoint, and validates Prisma engine loading.
  - `e2e`: Boots ephemeral Postgres container, launches API and web dev servers with `fake-gemini.ts`, and executes Playwright tests in headless Chromium.

### 5.8 End-to-End Testing (P-14)
- **Tools:** Playwright v1.65.1 (Chromium), `fake-gemini.ts` (ADR-0016).
- **Objective:** Execute the candidate golden path in a real browser: Authentication -> Resume Upload -> Setup -> 2-Turn Typed Interview -> End Session -> Feedback Verification.
- **Design:** Replaces unpredictable external LLM calls with a deterministic local HTTP server (`fake-gemini.ts` on port 4100) responding via `GOOGLE_GEMINI_BASE_URL`.

### 5.9 AI Evaluation Accuracy Benchmarking (S-4)
- **Tool:** Custom CLI `apps/api/scripts/bench.ts` (`--runs 1`).
- **Objective:** Measure whether LLM feedback scoring falls within expected `[min, max]` intervals for 10 standardized transcript fixtures across SWE, Data Analyst, and Backend Developer roles.
- **Criteria:** At least 80% of scored fixtures must pass; p95 latency evaluated against 15,000 ms target.

### 5.10 Evaluator Consistency Benchmarking (S-7)
- **Tool:** Custom CLI `apps/api/scripts/bench.ts` (`--runs 5`).
- **Objective:** Rule out LLM output stochasticity by evaluating 26 evaluatable fixtures 5 independent times.
- **Formula:** $\text{Spread} = \max(\text{scores}) - \min(\text{scores})$.
- **Criteria:** Spread must be $\le 1.0\text{ point}$ (on a 1–5 scale) for every category. Zero incomplete or inconclusive runs allowed.

### 5.11 Conversational Spoken Latency Testing (VI-7 / NFR-01)
- **Tool:** Custom CLI `apps/api/scripts/latency.ts`.
- **Objective:** Measure elapsed duration from candidate speech completion to arrival of first audio chunk over Gemini Live.
- **Criteria:** Nearest-rank p95 latency $\le 5,000\text{ ms}$ across at least 20 voice turns.

### 5.12 Manual Voice & Hardware Testing
- **Tools:** Real Chrome/Edge desktop browsers, external USB microphones, headphones.
- **Objective:** Verify real-world microphone permissions, hardware switching, speech recognition acoustic quality, barge-in audio cut-off, and silence encouragement prompts.

### 5.13 Cross-Browser Portability Testing
- **Target Browsers:** Google Chrome, Microsoft Edge, Mozilla Firefox, Apple Safari on desktop.
- **Objective:** Validate layout rendering, WebSockets, AudioContext audio streaming, and fallback mechanisms across disparate browser rendering and JavaScript engines.

---

## 6. Test Environments, Mocking, and Tooling

### Test Environment Specifications

| Environment | Host Platform | Runtime | Database Target | AI Service Mode |
|---|---|---|---|---|
| **Local Dev / Unit** | Windows 11 / macOS / Linux | Bun `v1.4.x` / Node 24 | In-memory mocks / Optional local Postgres | Mocked `@google/genai` |
| **CI Check Job** | `ubuntu-latest` (GitHub-hosted Linux) | Bun `v1.4.x` + Node 24 | `postgres:16-alpine` (Docker container) | Mocked Vitest mocks |
| **CI E2E Job** | `ubuntu-latest` (GitHub-hosted Linux) | Bun `v1.4.x` + Node 24 | `postgres:16-alpine` (Docker container) | `fake-gemini.ts` on `:4100` |
| **Offline Benchmark** | Local Workstation | Bun `v1.4.x` | None / Cached JSON Fixtures | Seeded Cache (`seeded-cache.json`) |
| **Live Benchmark** | Local Workstation | Bun `v1.4.x` | None (Direct script execution) | Real Gemini API (`gemini-3.8-flash`) |
| **Production Staging**| Cloud Run (API) + Firebase (Web) | Bun container + CDN | Supabase PostgreSQL (Managed) | Real Gemini API + Gemini Live |

### Fake Gemini Server Architecture (ADR-0016)

In end-to-end testing, Playwright boots `apps/web/e2e/fake-gemini.ts` as a local HTTP service on port 4100.
1. The Google GenAI SDK natively reads `GOOGLE_GEMINI_BASE_URL`. By redirecting this variable to `http://127.0.0.1:4100`, zero changes are made to production code.
2. The fake server dynamically extracts rubric categories from incoming structured schema requests and echoes valid JSON objects matching expected output formats:
   - Resume parser returns valid structured profile data (`name`, `skills`, `experienceYears`).
   - `next-question` generates contextual questions based on the candidate's turn count.
   - Evaluator generates category scores, rationale strings, and summary paragraphs matching Zod schemas.
3. This architecture guarantees zero external API cost, instant deterministic execution, and complete isolation from external quota exhaustion.

---

## 7. Requirements Traceability Matrix

The following matrix maps software requirements (SRS / `docs/requirements.md`) to test levels, test implementations, and verification evidence.

| Requirement ID | Type | Description in SRS (`docs/requirements.md`) | Test Level | Test Suite / Implementation | Verification Status |
|---|---|---|---|---|:---:|
| **FR-01** | Functional | Candidate account creation using email & password | API Unit / Integration | `apps/api/src/__tests__/auth.test.ts`, `apps/web/src/screens/login/Login.test.tsx` | Implemented |
| **FR-02** | Functional | Candidate account creation & sign in via Google OAuth | Component / Integration | `apps/web/src/screens/login/Login.test.tsx`, `apps/web/src/context/AuthContext.test.tsx` | Implemented |
| **FR-03** | Functional | Candidate sign out and active session invalidation | Component / Unit | `apps/web/src/components/Navbar.test.tsx`, `apps/web/src/screens/login/Login.test.tsx` | Implemented |
| **FR-04** | Functional | Password reset via email code/link | Component / UI | `apps/web/src/screens/reset-password/ResetPassword.test.tsx` | Implemented |
| **FR-05** | Functional | End session on browser close unless 'stay signed in' | Component / Storage | `apps/web/src/lib/authStorage.test.ts`, `apps/web/src/screens/login/Login.test.tsx` | Implemented |
| **FR-06** | Functional | Role selection list presented before session start | API / Component | `packages/contracts/src/__tests__/contracts.test.ts`, `apps/api/src/__tests__/session.test.ts` | Implemented |
| **FR-07** | Functional | Select interview focus within chosen role | API / Component | `apps/api/src/__tests__/session.test.ts`, `apps/web/src/screens/new-interview/NewInterview.test.tsx` | Implemented |
| **FR-08** | Functional | Resume file upload & parsing (PDF text extraction) | API Unit / Route | `apps/api/src/__tests__/resume.test.ts`, `apps/api/src/__tests__/resume-summary.test.ts` | Implemented |
| **FR-09** | Functional | Ask question referencing resume content | API Unit | `apps/api/src/__tests__/briefing.test.ts`, `apps/api/src/__tests__/voice-token.test.ts` | Implemented |
| **FR-10** | Functional | GitHub username context retrieval | Component / Unit | `apps/web/src/screens/profile/Profile.test.tsx`, `apps/web/src/lib/githubIdentity.test.ts` | Implemented |
| **FR-11** | Functional | Custom profile text / job description context upload | API Unit | `apps/api/src/__tests__/briefing.test.ts` (PK-9 setup) | Implemented |
| **FR-12** | Functional | Spoken interview without typing (Gemini Live + Web Speech)| Unit / Component | `apps/web/src/lib/geminiLiveAdapter.test.ts`, `apps/web/src/lib/voiceAdapter.test.ts`, `apps/web/src/screens/interview-room/InterviewRoom.test.tsx` | Implemented |
| **FR-13** | Functional | Dynamic follow-up question based on preceding answer | API Unit | `apps/api/src/__tests__/briefing.test.ts`, `apps/api/src/__tests__/next-question.test.ts` | Implemented |
| **FR-14** | Functional | Interruption handling (candidate barge-in stops AI speech) | Component / Unit | `apps/web/src/lib/geminiLiveAdapter.test.ts`, `apps/web/src/lib/__tests__/transcriptAccumulator.test.ts`, `apps/web/src/screens/interview-room/InterviewRoom.test.tsx` | Implemented |
| **FR-15** | Functional | No repeated questions in same session | API Unit | `apps/api/src/__tests__/briefing.test.ts` | Implemented |
| **FR-16** | Functional | No repeated questions across last 3 sessions for same role | API Unit | `apps/api/src/__tests__/briefing.test.ts`, `apps/api/src/__tests__/recent-questions.test.ts` | Implemented |
| **FR-17** | Functional | Interviewer persona matching role and focus | API Unit | `apps/api/src/__tests__/briefing.test.ts` | Implemented |
| **FR-18** | Functional | Early exit from interview session (`POST /api/sessions/:id/end`) | API / Component | `apps/api/src/__tests__/session.test.ts`, `apps/web/src/screens/interview-room/InterviewRoom.test.tsx` | Implemented |
| **FR-19** | Functional | Record early-end reason (accessible dialog) | Component / Contract | `apps/api/src/__tests__/session.test.ts`, `apps/web/src/screens/interview-room/InterviewRoom.test.tsx`, `apps/web/src/screens/results/ResultsScreen.test.tsx` | Implemented |
| **FR-20** | Functional | Evaluation against role-specific rubric | Unit / Benchmark | `apps/api/src/__tests__/evaluator.test.ts`, `apps/api/scripts/bench.ts` | Implemented |
| **FR-21** | Functional | Structured feedback stating strengths & improvement areas | Unit / Contract | `apps/api/src/__tests__/evaluator.test.ts` (S-5 score separation) | Implemented |
| **FR-22** | Functional | Display feedback after session ends | Component | `apps/web/src/screens/results/ResultsScreen.test.tsx` | Implemented |
| **FR-23** | Functional | Live feedback preparation notice without reload | Component | `apps/web/src/screens/results/ResultsScreen.test.tsx` | Implemented |
| **FR-24** | Functional | Transcript persistence for completed session | API / Unit | `apps/api/src/__tests__/session.test.ts`, `apps/web/src/lib/__tests__/transcriptAccumulator.test.ts`, `apps/api/src/__tests__/transcript-integrity.test.ts` | Implemented |
| **FR-25** | Functional | List past sessions with role and outcome | Component / Route | `apps/web/src/screens/history/HistoryPage.test.tsx`, `apps/api/src/__tests__/session.test.ts` | Implemented |
| **FR-26** | Functional | View past transcripts and feedback | Component | `apps/web/src/screens/history/HistoryPage.test.tsx`, `apps/web/src/screens/results/ResultsScreen.test.tsx` | Implemented |
| **FR-27** | Functional | Restrict access to candidate's own sessions (404 on unowned)| API Integration | `apps/api/src/__tests__/session.test.ts`, `apps/api/src/__tests__/voice-token.test.ts`, `apps/api/src/__tests__/feedback.test.ts` | Implemented |
| **FR-28** | Functional | Delete own past sessions & data (History deletion, RH-9) | API / DB Integration | `apps/api/src/__tests__/session.test.ts`, `apps/api/src/__tests__/session-deletion.integration.test.ts`, `apps/web/src/screens/results/ResultsScreen.test.tsx` | Implemented |
| **FR-29** | Functional | Mark session for retention past 30 days (`PATCH /keep`) | DB Integration / API | `apps/api/src/__tests__/session.test.ts`, `apps/api/src/__tests__/retention.integration.test.ts` | Implemented |
| **FR-30** | Functional | Full typed interview mode (no microphone needed, PK-4) | E2E / Component | `apps/web/e2e/golden-path.e2e.ts`, `apps/web/src/screens/new-interview/NewInterview.test.tsx` | Implemented |
| **FR-31** | Functional | Add/edit roles without code change | Architecture | `packages/contracts/src/index.ts` | Deferred (Post-MVP) |
| **FR-32** | Functional | Owner dashboard reporting session count, duration, cost | API / Component | `apps/api/src/__tests__/admin.test.ts`, `apps/web/src/screens/admin/AdminDashboard.test.tsx` | Partial (Session & role stats live; duration/cost S-8 pending) |
| **FR-33** | Functional | Placement Cell anonymous aggregate cohort statistics | — | — | Dropped (Nov 18, 2026) |
| **FR-34** | Functional | Resume match: compare resume with job description | API / Unit | `apps/api/src/__tests__/resume-match.test.ts`, `apps/api/src/__tests__/resume-match-api.test.ts` | Implemented |
| **NFR-01** | Non-Functional | Spoken response within 5.0s for $\ge 95\%$ turns | Performance Bench| `apps/api/scripts/latency.ts`, `apps/api/src/__tests__/latency-script.test.ts` | Implemented |
| **NFR-02** | Non-Functional | Barge-in interruption halts audio within 500 ms | Component / Voice| `apps/web/src/lib/geminiLiveAdapter.test.ts`, `apps/web/src/screens/interview-room/InterviewRoom.test.tsx` | In Progress |
| **NFR-03** | Non-Functional | Structured feedback displayed within 15 seconds | Performance Bench| `apps/api/src/__tests__/evaluator.test.ts`, `apps/api/scripts/bench.ts` | Partial |
| **NFR-04** | Non-Functional | Retain transcript on evaluation failure & allow retry | API / Worker | `apps/api/src/__tests__/feedback.test.ts` | Implemented |
| **NFR-05** | Non-Functional | Recovery from 10s network drop without turn loss | Unit / Manual | `apps/web/src/lib/geminiLiveAdapter.test.ts` | In Progress |
| **NFR-06** | Non-Functional | 100 concurrent interview sessions sustained | Load Test | — | Deferred |
| **NFR-07** | Non-Functional | Passwords stored salted/hashed (no plaintext) | Auth Architecture | `apps/api/src/__tests__/auth.test.ts` (Supabase bcrypt/Argon2) | Implemented |
| **NFR-08** | Non-Functional | All traffic encrypted in transit (TLS/HTTPS/WSS) | Deployment Audit | Cloud Run & Firebase Hosting TLS | Implemented |
| **NFR-09** | Non-Functional | Voice provider failure masks external credentials | API Integration | `apps/api/src/__tests__/voice-token.test.ts` | Implemented |
| **NFR-10** | Non-Functional | Server-side transcript corroboration for evaluation | Architecture / API | `apps/api/src/__tests__/transcript-integrity.test.ts`, ADR-0012 | Implemented |
| **NFR-11** | Non-Functional | Auto-delete sessions & recordings within 30 days unless kept | DB Integration | `apps/api/src/__tests__/retention.integration.test.ts` | Partial |
| **NFR-12** | Non-Functional | No personal data transmitted to non-essential third parties | Architecture | Server codebase audit (Gemini and Supabase only) | Implemented |
| **NFR-13** | Non-Functional | First-time user completes interview setup in <5m | UX Trial / Unit | `apps/web/src/screens/new-interview/MicCheck.test.tsx`, `apps/web/src/screens/new-interview/NewInterview.test.tsx` | Implemented |
| **NFR-14** | Non-Functional | Non-audio interface meets WCAG 2.1 AA | Accessibility | `vitest-axe` across 11 screens, `apps/web/src/styles.contrast.test.ts` | Implemented |
| **NFR-15** | Non-Functional | Cross-browser support (Chrome, Edge, Firefox, Safari)| Manual Matrix | Manual test plan, Playwright Chromium | In Progress |
| **NFR-16** | Non-Functional | Per-session AI infrastructure cost within budget | Benchmark / Unit| `apps/api/src/__tests__/bench-pricing.test.ts`, `apps/api/scripts/bench.ts` | Implemented |
| **NFR-17** | Non-Functional | Role addition requires no code changes outside catalogue | Architecture | `packages/contracts/src/index.ts` | Deferred |
| **NFR-18** | Non-Functional | $\ge 80\%$ questions judged relevant to role & focus | Benchmark | `apps/api/src/__tests__/briefing.test.ts` | Implemented |
| **NFR-19** | Non-Functional | Evaluator consistency (score spread $\le 1.0$ pt) | Consistency Bench| `apps/api/scripts/bench.ts` (`--runs 5`), `docs/evaluation-benchmark.md` | Implemented |
| **DR-06** | Domain Policy | Personal-data handling compliance (User Account Deletion & Data Export) | DB Integration | `apps/api/src/__tests__/account-deletion.integration.test.ts`, `apps/api/src/__tests__/me-export.integration.test.ts` | Implemented |

---

## 8. Detailed Test Cases

### 8.1 Authentication and Access Control

#### `TC-AUTH-01`: Candidate Registration and Password Validation
- **Requirement:** FR-01, FR-02
- **Preconditions:** Unregistered email address.
- **Execution Steps:**
  1. Submit `POST /api/auth/register` with valid email and password under 8 characters.
  2. Assert rejection with HTTP 400.
  3. Submit `POST /api/auth/register` with 8+ character password.
  4. Assert response HTTP 201 with user payload and unverified status.
- **Expected Outcome:** Rejects weak passwords; creates user record requiring email confirmation.
- **Test Method:** Automated API Integration (`apps/api/src/__tests__/auth.test.ts`).

#### `TC-AUTH-02`: Cross-Tenant Resource Isolation (FR-27)
- **Requirement:** FR-27
- **Preconditions:** User A and User B exist; User A owns Session `sess-A`.
- **Execution Steps:**
  1. Authenticate request using User B's valid JWT token.
  2. Dispatch `GET /api/sessions/sess-A`.
  3. Dispatch `POST /api/sessions/sess-A/turns`.
  4. Dispatch `POST /api/sessions/sess-A/voice-token`.
- **Expected Outcome:** The API must answer HTTP 404 (Not Found) for all requests, never HTTP 403 or 200, preventing enumeration of existing session identifiers.
- **Test Method:** Automated API Integration (`apps/api/src/__tests__/session.test.ts`, `apps/api/src/__tests__/voice-token.test.ts`).

### 8.2 Resume Parsing and Heuristic Fallbacks

#### `TC-RES-01`: Valid Resume Upload and Parsing
- **Requirement:** FR-08
- **Preconditions:** Valid software engineering PDF resume on file.
- **Execution Steps:**
  1. Upload PDF file via `POST /api/resume/analyze`.
  2. Parse text content via `pdf-parse`.
  3. Trigger `gemini.service.ts` structured extraction.
- **Expected Outcome:** Returns HTTP 200 with extracted candidate profile, detected technical skills array, and computed years of experience.
- **Test Method:** Automated Unit / Integration (`apps/api/src/__tests__/resume.test.ts`, `apps/api/src/__tests__/candidate-profile.test.ts`).

#### `TC-RES-02`: Heuristic Fallback on LLM Outage or Malformed JSON
- **Requirement:** FR-08
- **Preconditions:** Gemini API key missing or returns invalid JSON / HTTP 503.
- **Execution Steps:**
  1. Submit resume for analysis while Gemini service throws an exception.
  2. Observe service routing in `gemini.service.ts`.
- **Expected Outcome:** Service traps error, falls back to regex-based heuristic extractor, populates skills, and returns payload marked with `source: "heuristic"`.
- **Test Method:** Automated Unit (`apps/api/src/__tests__/resume.test.ts`, `apps/api/src/__tests__/candidate-profile.test.ts`).

#### `TC-RES-03`: Rejection of Non-Resume PDF Documents
- **Requirement:** FR-08
- **Preconditions:** PDF containing recipes, terms of service, or arbitrary literature.
- **Execution Steps:**
  1. Submit non-resume PDF to `POST /api/resume/analyze`.
  2. Evaluator inspects structure and keyword density.
- **Expected Outcome:** Returns HTTP 400 with message indicating document does not appear to be a resume; no resume record saved to database.
- **Test Method:** Automated Unit / Route (`apps/api/src/__tests__/resume.test.ts`, `apps/web/src/screens/dashboard/DashboardResume.test.tsx`).

### 8.3 Session Management and Privacy Control

#### `TC-SESS-01`: Interview Setup with Role, Focus, and Mode
- **Requirement:** FR-06, FR-07, FR-30
- **Preconditions:** Candidate authenticated.
- **Execution Steps:**
  1. Select role from ROLES catalogue (`software-engineer`).
  2. Select role focus (`algorithms-distributed-systems`).
  3. Select mode (`voice` or `typed`).
  4. Submit session creation.
- **Expected Outcome:** Returns HTTP 201 with created session record storing role, focus, and mode.
- **Test Method:** Automated API Integration (`apps/api/src/__tests__/session.test.ts`).

#### `TC-SESS-02`: Delete Own Past Interview Session (FR-28, RH-9)
- **Requirement:** FR-28
- **Preconditions:** Candidate owns completed session with turns and feedback.
- **Execution Steps:**
  1. Send `DELETE /api/sessions/:id`.
  2. Query database for session, turns, and feedback records.
- **Expected Outcome:** Session record and all associated child turns and feedback are removed via cascading transaction.
- **Test Method:** Automated Database Integration (`apps/api/src/__tests__/session-deletion.integration.test.ts`).

#### `TC-PRIV-01`: Candidate User Account Deletion & Data Cascade (DR-06)
- **Requirement:** DR-06
- **Preconditions:** Candidate user account exists with multiple historical sessions and resumes.
- **Execution Steps:**
  1. Submit `DELETE /api/auth/account`.
  2. Assert user deletion in Supabase Auth and PostgreSQL.
- **Expected Outcome:** Atomic `$transaction` purges user row and all associated resumes, sessions, turns, and feedback records.
- **Test Method:** Automated Database Integration (`apps/api/src/__tests__/account-deletion.integration.test.ts`).

### 8.4 Voice Transport, Streaming, and Reconnection

#### `TC-VOICE-01`: Pre-Flight Microphone Check and Audio Meter
- **Requirement:** NFR-13, FR-12
- **Preconditions:** System has at least one audio input device.
- **Execution Steps:**
  1. Render `MicCheck` component.
  2. Click "Test Microphone".
  3. Select input device from dropdown.
  4. Simulate audio signal above noise floor (threshold > 8%).
- **Expected Outcome:** Permissions requested, devices enumerated, active state renders green level bar, and chosen `deviceId` saved in `sessionStorage`.
- **Test Method:** Automated Component (`apps/web/src/screens/new-interview/MicCheck.test.tsx`).

#### `TC-VOICE-02`: Ephemeral Voice Token Issuance and Field-Masking
- **Requirement:** NFR-09, FR-12
- **Preconditions:** Session exists in `LIVE` status owned by caller.
- **Execution Steps:**
  1. Dispatch `POST /api/sessions/:id/voice-token`.
  2. Inspect minted ephemeral token payload.
- **Expected Outcome:** Returns short-lived token (valid 2 minutes, max duration 30 minutes). Field mask locks model to `gemini-3.8-live` and locks briefing, preventing client modification. Server API key is never exposed.
- **Test Method:** Automated API Integration (`apps/api/src/__tests__/voice-token.test.ts`).

#### `TC-VOICE-03`: Candidate Interruption and Barge-In (NFR-02)
- **Requirement:** FR-14, NFR-02
- **Preconditions:** AI is in `AI_SPEAKING` state playing audio from `PlaybackQueue`.
- **Execution Steps:**
  1. Candidate begins speaking over the AI.
  2. WebSocket receives `serverContent.interrupted: true` message from Gemini.
- **Expected Outcome:** `PlaybackQueue` immediately clears pending audio buffers, halts Web Audio output, flushes partial AI turn, and transitions room state to `LISTENING` within 500 ms.
- **Test Method:** Automated Unit / Component (`apps/web/src/lib/geminiLiveAdapter.test.ts`, `apps/web/src/screens/interview-room/InterviewRoom.test.tsx`).

#### `TC-VOICE-04`: Network Drop and Session Resumption (NFR-05)
- **Requirement:** NFR-05
- **Preconditions:** Active Gemini Live session in progress.
- **Execution Steps:**
  1. Simulate sudden WebSocket close code 1006.
  2. Inspect adapter reconnection lifecycle.
- **Expected Outcome:** Adapter preserves resumption handle from `sessionStorage`, displays `RECONNECTING` status, executes up to 3 reconnect attempts at 2.5s intervals, and resumes stream without losing preceding turns.
- **Test Method:** Automated Unit (`apps/web/src/lib/geminiLiveAdapter.test.ts`).

#### `TC-VOICE-05`: Seamless Downgrade to Web Speech Fallback and Typed Alternative
- **Requirement:** FR-12, FR-17, FR-30
- **Preconditions:** Ephemeral token request fails or Gemini Live fails all 3 reconnect attempts.
- **Execution Steps:**
  1. Force failure on `POST /api/sessions/:id/voice-token`.
  2. Observe interview room adapter resolution.
- **Expected Outcome:** Room automatically instantiates `BrowserWebSpeechVoiceAdapter`, switches UI badge to "Browser Voice Fallback", and retrieves questions sequentially via `POST /sessions/:id/next-question`. If speech APIs are unsupported (e.g. Firefox), candidate is guided to Typed Mode.
- **Test Method:** Automated Component (`apps/web/src/screens/interview-room/InterviewRoom.test.tsx`).

### 8.5 Evaluation, Rubrics, and Consistency

#### `TC-EVAL-01`: Role-Specific Rubric Evaluation (S-4)
- **Requirement:** FR-20, DR-03
- **Preconditions:** Completed interview transcript for Software Engineer role.
- **Execution Steps:**
  1. Invoke `evaluateTranscript` service with SWE transcript turns.
  2. Inspect response JSON schema.
- **Expected Outcome:** Scores strictly populated for "Problem Solving & Algorithms", "Software Design & Architecture", and "Technical Communication". Overall score matches category weighted average.
- **Test Method:** Automated Backend Unit (`apps/api/src/__tests__/evaluator.test.ts`).

#### `TC-EVAL-02`: Separation of Filler Words from Technical Score (S-5)
- **Requirement:** FR-21
- **Preconditions:** Transcript contains technically flawless answers spoken with heavy hesitation, pauses, and speech fillers ("um", "uh", "like").
- **Execution Steps:**
  1. Evaluate transcript fixture `filler-heavy-correct.json`.
- **Expected Outcome:** Technical categories ("Problem Solving & Algorithms", "Software Design & Architecture") receive scores of 4–5. Communication score reflects filler penalty (score 2–3). Technical competence is not penalized.
- **Test Method:** Automated Benchmark (`apps/api/scripts/bench.ts`).

#### `TC-EVAL-03`: Concise Answers Fairness Rule (S-6 / NFR-19)
- **Requirement:** NFR-19
- **Preconditions:** Paired fixtures `concise-correct.json` (brief, direct, accurate) vs. `long-vague.json` (rambling, evasive).
- **Execution Steps:**
  1. Evaluate both fixtures using the benchmark suite.
- **Expected Outcome:** `concise-correct` achieves overall and technical score $\ge$ `long-vague`, with concise technical average $\ge 3.50 / 5.00$.
- **Test Method:** Automated Unit / Benchmark (`apps/api/src/__tests__/evaluator.test.ts`, `apps/api/scripts/bench.ts`).

#### `TC-EVAL-04`: Score Consistency Across Repeated Evaluations (S-7)
- **Requirement:** NFR-19
- **Preconditions:** 26 evaluatable transcript fixtures.
- **Execution Steps:**
  1. Execute `bun scripts/bench.ts --runs 5` at temperature 0.2.
  2. Compute category score spreads across all 5 runs.
- **Expected Outcome:** Every category score spread $\le 1.0\text{ point}$. Zero failed fixtures.
- **Test Method:** Automated Benchmark (`apps/api/scripts/bench.ts`).

### 8.6 Accessibility and Theming (PN-5)

#### `TC-A11Y-01`: Automated Screen Accessibility Audits (WCAG 2.1 AA)
- **Requirement:** NFR-14
- **Preconditions:** Render screens populated with mock domain state.
- **Execution Steps:**
  1. Render each screen in jsdom.
  2. Run `const results = await axe(container)`.
  3. Assert `expect(results).toHaveNoViolations()`.
- **Expected Outcome:** 0 accessibility violations across all 11 screens.
- **Test Method:** Automated Component (`apps/web/src/screens/**/*.test.tsx`).

#### `TC-A11Y-02`: Theme Palette Contrast Ratios
- **Requirement:** NFR-14
- **Preconditions:** CSS token palettes in `styles.css`.
- **Execution Steps:**
  1. Compute color contrast between background and foreground tokens across Swiss Light, Haute Dark, and Graphite Dark.
- **Expected Outcome:** Normal text contrast $\ge 4.5:1$; large heading contrast $\ge 3:1$.
- **Test Method:** Automated Component (`apps/web/src/styles.contrast.test.ts`).

### 8.7 End-to-End System Flow (P-14)

#### `TC-E2E-01`: Candidate Golden-Path Journey
- **Requirement:** FR-01, FR-06, FR-08, FR-18, FR-22, FR-30
- **Preconditions:** API, Vite web server, and `fake-gemini.ts` running against clean test database.
- **Execution Steps:**
  1. Sign in via `/login` with test credentials.
  2. Upload PDF resume on `/dashboard`.
  3. Navigate to `/new-interview`, select Software Engineer, select Typed mode, click Start.
  4. Type and submit answers for Question 1 and Question 2.
  5. Click "End Interview" and confirm in dialog modal.
  6. Verify navigation to `/interview/:id/feedback`.
  7. Wait for evaluation completion and assert feedback display.
- **Expected Outcome:** Full candidate journey completes successfully in real browser; feedback renders summary and scorecards without manual intervention.
- **Test Method:** Automated End-to-End Playwright (`apps/web/e2e/golden-path.e2e.ts`).

---

## 9. Manual Voice Testing Plan

While automated unit and fake-Gemini tests verify client logic, physical acoustic environments, operating system microphone permissions, hardware switches, and live voice interactions require structured manual verification.

### Test Environment Prerequisites
- Hardware: Desktop workstation equipped with an external USB microphone and stereo headphones (to prevent audio feedback loops during full-duplex conversations).
- Network: Stable internet connection (>5 Mbps download/upload, ping <50 ms).
- Software: Modern desktop Google Chrome (latest stable release).
- Credentials: Valid candidate account on the target staging environment with a real `GEMINI_API_KEY` configured.

### Step-by-Step Manual Test Procedures

| Test Case | Scenario | Execution Steps | Expected Physical / Acoustic Outcome |
|---|---|---|---|
| **MV-01** | Permission Prompt & Grant | 1. Navigate to `/new-interview`.<br>2. Click "Test Microphone".<br>3. Select "Allow" on the browser permission modal. | Browser permission indicator appears in address bar. Device list populates with available microphones. |
| **MV-02** | Permission Denial | 1. Revoke microphone permission in browser settings.<br>2. Click "Test Microphone". | UI displays descriptive Alert instructing user to enable microphone permissions; prevents entering voice session. |
| **MV-03** | Microphone Level Check | 1. Speak into microphone at normal volume.<br>2. Observe level meter in `MicCheck`. | Level meter oscillates dynamically in green zone (>8% threshold). "Inactive" changes to "Active". |
| **MV-04** | Live Session Voice Connection | 1. Start voice interview.<br>2. Wait for interviewer greeting. | AI speaks initial question in natural voice over headphones. Voice orb pulses synchronously with audio. |
| **MV-05** | Candidate Speech & Transcription | 1. Answer question clearly for 30–45 seconds.<br>2. Stop speaking and remain silent. | Orb indicates candidate speaking. Candidate words stream live into transcript panel. AI detects pause and begins next question. |
| **MV-06** | Candidate Barge-In / Interruption | 1. While AI is speaking an answer, deliberately speak: "Excuse me, can I clarify that point?" | AI halts speech immediately (<500 ms). Audio stops playing in headphones. Room transitions to listening state. |
| **MV-07** | Silence Encouragement Cue | 1. After AI completes a question, remain completely silent for 10 seconds. | After 9 seconds of silence (<0.12 audio level), system delivers encouragement cue ("The candidate is thinking; offer brief encouragement"). |
| **MV-08** | Network Disconnection & Resumption | 1. During an active voice interview, disconnect Wi-Fi for 5 seconds and reconnect. | Room displays "Reconnecting..." badge. Connection re-establishes via saved session handle without losing previous turns. |
| **MV-09** | Forced Gemini Outage to Fallback | 1. Block `generativelanguage.googleapis.com` in Chrome DevTools Network tab.<br>2. Attempt voice interview. | System detects token/WebSocket failure, switches to Browser Web Speech Fallback, alerts candidate, and uses browser TTS. |
| **MV-10** | Interview Completion & Feedback | 1. Click "End Interview".<br>2. Confirm in modal. | Room terminates audio streaming, stops microphone tracks, navigates to results page, and displays generated feedback within 15–30 seconds. |

---

## 10. Cross-Browser Testing Plan

### Cross-Browser Platform Matrix

AI Interviewer relies on modern Web APIs: `AudioWorklet`, `WebSocket`, `MediaDevices.getUserMedia`, and optionally the W3C Web Speech API (`webkitSpeechRecognition` / `SpeechRecognition` and `speechSynthesis`).

| Browser | Rendering Engine | Spoken Voice Mode (Gemini Live) | Browser Speech Fallback | Typed Mode | Expected Support Tier |
|---|---|:---:|:---:|:---:|:---:|
| **Google Chrome** (Desktop) | Blink / V8 | Full (`AudioWorklet` + WS) | Full (`webkitSpeechRecognition` + TTS) | Full | Tier 1 (Primary / Reference) |
| **Microsoft Edge** (Desktop) | Blink / V8 | Full (`AudioWorklet` + WS) | Full (`SpeechRecognition` + TTS) | Full | Tier 1 (Fully Supported) |
| **Mozilla Firefox** (Desktop) | Gecko / SpiderMonkey | Full (`AudioWorklet` + WS) | Unsupported (No native SpeechRecognition) | Full | Tier 2 (Voice Works; Fallback Degrades to Typed) |
| **Apple Safari** (macOS) | WebKit / JavaScriptCore | Full (`AudioWorklet` + WS) | Partial (SpeechSynthesis quirks / prefixed API) | Full | Tier 2 (Voice Works; Platform Audio Restrictions) |

### Cross-Browser Verification Procedure
1. **Layout & Theming:** Validate visual rendering of Swiss, Haute, and Graphite palettes across browsers; assert SVG radar charts render without distortion.
2. **Audio Hardware Access:** Confirm `navigator.mediaDevices.getUserMedia` triggers native OS permission prompts on macOS and Windows across all four browsers.
3. **WebSocket Audio Streaming:** Verify full-duplex binary PCM audio streaming over secure WebSockets (`wss://`) to Gemini Live in Chrome, Edge, Firefox, and Safari.
4. **Fallback Degradation:**
   - On Firefox, when Gemini Live is unavailable, verify the room gracefully advises switching to Typed mode rather than crashing on missing `SpeechRecognition`.
   - On Safari, verify that user gesture requirements (Autoplay policies) for Web Audio playback are satisfied before starting audio playback.

---

## 11. Entry, Suspension, and Exit Criteria

### Entry Criteria
1. The target branch compiles cleanly without syntax errors.
2. `bun install --frozen-lockfile` completes with 0 dependency conflicts.
3. Database migrations successfully deploy against a local PostgreSQL instance (`bun run --filter @interview/api db:migrate`).
4. Static typecheck passes cleanly across all packages (`bun run typecheck`).

### Suspension and Resumption Criteria
- **Suspension:** Testing shall be suspended if:
  - Database schema migrations fail to apply, blocking API startup.
  - The test database container becomes corrupted or unreachable.
  - The fake Gemini mock server (`fake-gemini.ts`) fails to start, aborting E2E test runs.
  - More than 15% of automated test suites fail due to environmental or package configuration problems.
- **Resumption:** Testing resumes once the environmental defect is isolated, resolved, and verified via clean typecheck and server boot.

### Exit Criteria (Release Readiness Gates)
1. **Automated Unit & Integration Pass Rate:** 100% of all active Vitest unit, component, route, and database integration tests must pass in CI (0 failed tests).
2. **End-to-End Golden Path:** Playwright golden-path test passes in headless Chromium within CI without timeout retries.
3. **Accessibility Sign-Off:** Automated `vitest-axe` scans pass with 0 serious or critical violations across all 11 user screens; color contrast meets WCAG AA standards.
4. **AI Accuracy Benchmark (S-4):** At least 80% of scored transcript fixtures pass expected score ranges.
5. **AI Consistency Benchmark (S-7):** Category score spread $\le 1.0\text{ point}$ across 5 independent runs for all evaluatable fixtures.
6. **Voice Conversational Latency (VI-7 / NFR-01):** Nearest-rank p95 response latency $\le 5,000\text{ ms}$ over representative voice turns.
7. **Code Quality & Traceability:** Zero unhandled TypeScript errors; all PR changes mapped to SRS requirements in `docs/requirements.md`.

---

## 12. Defect Management and Severity Classification

Defects identified during testing are tracked in GitHub Issues and categorized by severity:

| Severity Level | Definition | Impact on Release | Target Resolution SLA |
|---|---|---|---|
| **Blocker (P0)** | Complete system outage, data loss, security compromise, broken golden path in CI, or database migration failure. | Blocks release immediately; no merge permitted. | < 12 hours |
| **Critical (P1)** | Primary feature broken (e.g. voice streaming fails, evaluation worker stalls, feedback fails to save, access control leak). | Blocks release unless workaround is formally approved. | < 24 hours |
| **Major (P2)** | Secondary feature failure (e.g. Web Speech fallback audio choppy, historical chart misaligned, heuristic resume parser misses a field). | Release decision reviewed by Team Lead; must be fixed in current sprint. | < 48 hours |
| **Minor (P3)** | Cosmetic defects, minor typography or spacing issues in non-standard viewports, non-fatal test warnings. | Does not block release; scheduled for subsequent sprint. | Backlog |

### Defect Lifecycle
```
[Logged on GitHub] -> [Triaged & Assigned] -> [Fix Implemented in Branch]
       ^                                                    |
       |                                                    v
[Reopened on Fail] <--- [Verified in Local & CI] <--- [PR Created & CI Passes]
```

---

## 13. Test Execution and Reproduction Commands

All commands are executed from the repository root unless explicitly noted. Both Bash and Windows PowerShell formats are provided where syntax diverges.

### 13.1 Dependency Installation & Static Analysis
```bash
# Install exact pinned dependencies and generate Prisma client
bun install --frozen-lockfile

# Execute static typecheck across all workspaces (contracts, api, web)
bun run typecheck
```

### 13.2 Automated Test Suites (Vitest)
```bash
# Run all automated tests across the monorepo
bun run test

# Run API unit and route tests only
bun --cwd apps/api test

# Run Web unit, component, and accessibility tests only
bun --cwd apps/web test

# Run a specific test suite (e.g. Evaluator service)
bun --cwd apps/api test src/__tests__/evaluator.test.ts

# Run accessibility audits only
bun --cwd apps/web test --grep "accessibility"
```

### 13.3 Database Integration Tests (Requires Disposable Local Postgres)

#### Bash / Linux / macOS
```bash
# 1. Start a local throwaway PostgreSQL container
docker run --name interview-test-db -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=interview_test -p 5432:5432 -d postgres:16-alpine

# 2. Apply database migrations to the test database
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/interview_test" bun --cwd apps/api db:migrate

# 3. Execute database integration tests (job queue, cascade deletes, data retention)
TEST_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/interview_test" bun --cwd apps/api test src/__tests__/job-queue.test.ts
TEST_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/interview_test" bun --cwd apps/api test src/__tests__/session-deletion.integration.test.ts
```

#### Windows PowerShell
```powershell
# 1. Start container
docker run --name interview-test-db -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=interview_test -p 5432:5432 -d postgres:16-alpine

# 2. Apply migrations
$env:DATABASE_URL="postgresql://postgres:postgres@localhost:5432/interview_test"; bun --cwd apps/api db:migrate

# 3. Run integration tests
$env:TEST_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/interview_test"; bun --cwd apps/api test src/__tests__/job-queue.test.ts
$env:TEST_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/interview_test"; bun --cwd apps/api test src/__tests__/session-deletion.integration.test.ts
```

### 13.4 End-to-End Golden-Path Test (Playwright)

#### Bash / Linux / macOS
```bash
export DATABASE_URL="postgresql://postgres:postgres@localhost:5432/interview_e2e"
export SUPABASE_URL="https://placeholder.supabase.co"
export SUPABASE_ANON_KEY="placeholder-anon-key"
export E2E_EMAIL="test-candidate@example.com"
export E2E_PASSWORD="test-password"

bun --cwd apps/web e2e
```

#### Windows PowerShell
```powershell
$env:DATABASE_URL="postgresql://postgres:postgres@localhost:5432/interview_e2e"
$env:SUPABASE_URL="https://placeholder.supabase.co"
$env:SUPABASE_ANON_KEY="placeholder-anon-key"
$env:E2E_EMAIL="test-candidate@example.com"
$env:E2E_PASSWORD="test-password"

bun --cwd apps/web e2e
```

### 13.5 AI Evaluation Benchmarks
```bash
# Note: Requires valid GEMINI_API_KEY in apps/api/.env

# Single transcript evaluation CLI
bun --cwd apps/api scripts/evaluate.ts src/__tests__/fixtures/transcripts/good.json --role software-engineer

# S-4 Accuracy Benchmark (1 run per fixture across all 27 fixtures)
bun --cwd apps/api scripts/bench.ts --runs 1

# S-4 Regression Check: Demonstrate that a corrupted prompt fails the benchmark
bun --cwd apps/api scripts/bench.ts --broken-prompt

# S-7 Consistency Benchmark (5 independent runs per fixture; ~29 min execution)
bun --cwd apps/api scripts/bench.ts --runs 5
```

### 13.6 Conversational Spoken Latency Benchmark (VI-7 / NFR-01)
```bash
# Calculates p50, p90, and p95 spoken response latencies from recorded DB turns
bun --cwd apps/api scripts/latency.ts

# Output in JSON format with custom sample ceiling
bun --cwd apps/api scripts/latency.ts --limit 50 --target 5000 --json
```

---

## 14. References

1. **System Requirements Specification:** `docs/requirements.md`
2. **Architecture Decision Records:**
   - [ADR-0012: Transcript Integrity and Turn Sequencing](adr/0012-transcript-integrity.md)
   - [ADR-0013: Postgres Job Queue with SKIP LOCKED](adr/0013-job-queue.md)
   - [ADR-0014: Voice Transport Architecture](adr/0014-voice-transport.md)
   - [ADR-0016: End-to-End Test with Fake Gemini](adr/0016-e2e-fake-gemini.md)
3. **Engineering Guides:**
   - [Codebase Architecture Guide](codebase-guide.md)
   - [Voice Implementation Guide](guides/voice.md)
   - [Evaluation Benchmark Documentation](evaluation-benchmark.md)
   - [Final Sprints Issue Catalogue](final-sprints.md)
4. **CI Workflow Configuration:** `.github/workflows/ci.yml`
5. **Key Pull Requests:**
   - S-4: Benchmark Script (#95, PR #220)
   - S-7: Consistency & Fairness Benchmark (#165, PR #309)
   - PN-5: Accessibility Audit (#172, PR #310)
   - P-14: End-to-End Golden Path in CI (#200, PR #318)
