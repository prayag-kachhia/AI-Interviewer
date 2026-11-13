# AI Interview Platform — Requirements Specification & Traceability Matrix

This document is the official Software Requirements Specification (SRS) and Requirements Traceability Matrix for the AI Interview Platform project (IT314, DA-IICT).

> **For PR Authors:** Whenever you implement or modify a requirement, update its row in [Section 6: Requirements Traceability Matrix](#6-requirements-traceability-matrix) with your Issue / PR number, the primary code files, the test files verifying it, and mark its status as **Done** (or **In Progress**).

---

## 1. Stakeholders

| # | Stakeholder | Interest in the system | Standing |
|---|---|---|---|
| **SH-1** | Candidates — students preparing for campus placements | Realistic practice and feedback that shows whether they are improving | Primary user |
| **SH-2** | Recent graduates who completed placements in the last year | Know what real interviews demanded; shape question and rubric content | Informant |
| **SH-3** | Interviewers and recruiters (alumni, industry) | Define what a good answer looks like from the evaluating side | Informant |
| **SH-4** | Placement Cell | Wants students better prepared; may already run mock interviews the system must fit alongside | Institutional stakeholder |
| **SH-5** | Platform owner and maintainer (the project team) | Must run the service within a student budget and keep it maintainable as requirements change | Operator |
| **SH-6** | Institutional data-handling expectations | Candidates' recorded answers are personal data held by a university-adjacent tool | Proxy stakeholder |

---

## 2. Functional Requirements

### 2.1 Account and Access

| ID | Requirement | Priority |
|---|---|---|
| **FR-01** | The system shall allow a candidate to create an account using an email address and password. | Must |
| **FR-02** | The system shall allow a candidate to create an account and sign in using a Google account. | Should |
| **FR-03** | The system shall allow a signed-in candidate to sign out. | Must |
| **FR-04** | The system shall allow a candidate who has forgotten their password to set a new one by confirming a one-time code sent to their registered email address. | Should |
| **FR-05** | The system shall end a candidate’s signed-in session when the browser closes, unless the candidate explicitly chooses to stay signed in. | Should |

### 2.2 Interview Setup

| ID | Requirement | Priority |
|---|---|---|
| **FR-06** | The system shall present a list of available interview roles and allow a candidate to select one before starting a session. | Must |
| **FR-07** | The system shall allow a candidate to select an interview focus within the chosen role. | Should |
| **FR-08** | The system shall allow a candidate to upload a resume file. | Should |
| **FR-09** | The system shall ask at least one question that refers to specific content from an uploaded resume, where a resume has been provided. | Should |
| **FR-10** | The system shall allow a candidate to supply a GitHub username, and shall retrieve that account’s public repository names, descriptions, and star counts for use as question context. | Could |
| **FR-11** | The system shall allow a candidate to paste or upload their own professional profile text for use as question context. | Could |

### 2.3 Conducting the Interview

| ID | Requirement | Priority |
|---|---|---|
| **FR-12** | The system shall conduct a spoken interview in which it asks questions aloud and the candidate answers aloud, without the candidate typing during the session. | Must |
| **FR-13** | The system shall ask at least one follow-up question that refers to the content of the candidate’s immediately preceding answer. | Must |
| **FR-14** | The system shall stop speaking when the candidate begins to speak over it, and shall treat what the candidate then says as their answer to the current question. | Should |
| **FR-15** | The system shall not ask the same question, or a question testing the same specific point, more than once within a single session. | Must |
| **FR-16** | The system shall not repeat a question the same candidate has been asked in their previous three sessions for the same role. | Could |
| **FR-17** | The system shall apply an interviewer persona appropriate to the selected role and focus. | Should |
| **FR-18** | The system shall allow a candidate to end a session at any point before its natural conclusion. | Must |
| **FR-19** | The system shall offer a candidate who ends a session early the option to record a reason, and shall allow them to decline to give one. | Could |

### 2.4 Evaluation and Feedback

| ID | Requirement | Priority |
|---|---|---|
| **FR-20** | The system shall evaluate a completed session against a documented rubric specific to the selected role. | Must |
| **FR-21** | The system shall generate structured feedback for a completed session, stating at minimum the candidate’s strengths and specific areas for improvement. | Must |
| **FR-22** | The system shall display generated feedback to the candidate after the session ends. | Must |
| **FR-23** | The system shall inform the candidate that feedback is being prepared, and shall display it without requiring the candidate to reload or navigate manually. | Should |

### 2.5 History and Candidate Data Control

| ID | Requirement | Priority |
|---|---|---|
| **FR-24** | The system shall store a transcript of each completed session. | Must |
| **FR-25** | The system shall list a candidate’s past sessions with the role, date, and whether the session completed or ended early. | Should |
| **FR-26** | The system shall allow a candidate to view the transcript and feedback of any of their own past sessions. | Should |
| **FR-27** | The system shall prevent any candidate from viewing another candidate’s sessions, transcripts, or feedback. | Must |
| **FR-28** | The system shall allow a candidate to delete any of their own past sessions, including its transcript and any recording. | Must |
| **FR-29** | The system shall allow a candidate to mark a session’s recording and transcript for retention beyond the default retention period. | Could |

### 2.6 Accessibility

| ID | Requirement | Priority |
|---|---|---|
| **FR-30** | The system shall provide a text-entry alternative to speaking, allowing a candidate to complete a full interview session and receive feedback without using a microphone. | Should |

### 2.7 Operator and Institutional

| ID | Requirement | Priority |
|---|---|---|
| **FR-31** | The system shall allow the platform owner to add, edit, or remove an interview role and its interviewer briefing without a code change. | Should |
| **FR-32** | The system shall report to the platform owner the number of sessions run, their durations, and the resulting infrastructure cost over a chosen period. | Should |

---

## 3. Non-Functional Requirements

### 3.1 Performance

| ID | Requirement | Measurement | Priority |
|---|---|---|---|
| **NFR-01** | When a candidate finishes speaking during a session under normal campus network conditions, the interviewer shall begin its spoken response within 5 seconds, for at least 95% of turns. | Timestamped turn boundaries across 20 recorded sessions | Must |
| **NFR-02** | When a candidate speaks over the interviewer, the interviewer shall stop speaking within 500 ms. | Audio analysis of 50 interruption events | Should |
| **NFR-03** | The system shall display structured feedback within 15 seconds of a session ending, for at least 95% of sessions. | Server-side timing over all sessions in a 2-week window | Must |

### 3.2 Reliability and Capacity

| ID | Requirement | Measurement | Priority |
|---|---|---|---|
| **NFR-04** | If evaluation fails after a session ends, the system shall retain the complete transcript and allow evaluation to be retried without the candidate repeating the interview. | Fault injection: force evaluation failure, confirm transcript intact and retry succeeds | Must |
| **NFR-05** | The system shall recover from a network interruption of up to 10 seconds during a session without losing any part of the transcript recorded before the interruption. | Fault injection on 10 sessions | Should |
| **NFR-06** | The system shall sustain 100 concurrent interview sessions while continuing to meet NFR-01. | Load test | Should |

### 3.3 Security

| ID | Requirement | Measurement | Priority |
|---|---|---|---|
| **NFR-07** | The system shall not store candidate passwords in a recoverable form. Where the system stores credentials itself, it shall use a memory-hard key derivation function with a per-user salt. | Code and configuration review | Must |
| **NFR-08** | All traffic between the candidate’s browser and the system shall be encrypted in transit. | Configuration review; connection inspection | Must |
| **NFR-09** | Credentials for any third-party evaluation or voice provider shall never be transmitted to the browser. | Network inspection of a full session from the client side | Must |
| **NFR-10** | The system shall not accept client-submitted transcript content as the sole basis for evaluation without server-side corroboration. | Attempt to submit a falsified transcript and confirm it does not alter the result | Must |

### 3.4 Privacy

| ID | Requirement | Measurement | Priority |
|---|---|---|---|
| **NFR-11** | The system shall delete a session’s recording and transcript within 30 days of the session, unless the candidate has marked it for retention under FR-29. | Query stored data for records older than 30 days not marked for retention | Must |
| **NFR-12** | The system shall not transmit candidate personal data or session content to any third party other than the evaluation and voice providers required to deliver the service. | Network inspection; review of third-party integrations | Must |

### 3.5 Usability and Accessibility

| ID | Requirement | Measurement | Priority |
|---|---|---|---|
| **NFR-13** | A candidate who has never used the system shall be able to start their first interview session within 5 minutes of arriving, without instruction from anyone. | Observed trial with 5 first-time users; at least 4 succeed unaided | Should |
| **NFR-14** | All non-audio interface elements shall meet WCAG 2.1 Level AA for contrast, keyboard operability, and screen-reader labelling. | Automated accessibility scan plus manual keyboard traversal | Should |
| **NFR-15** | The system shall function on the current and immediately preceding major versions of Chrome, Firefox, Edge, and Safari on desktop. | Manual test matrix before each release | Should |

### 3.6 Cost and Maintainability

| ID | Requirement | Measurement | Priority |
|---|---|---|---|
| **NFR-16** | The average infrastructure cost per completed session shall not exceed the target ceiling (measured in ₹ via FR-32 / OI-2). | Total provider spend divided by completed sessions, monthly | Must |
| **NFR-17** | Adding a new interview role shall require no change to application code outside the role catalogue and its briefing content. | Add a role end to end and inspect the resulting diff | Should |

### 3.7 Interview Quality

| ID | Requirement | Measurement | Priority |
|---|---|---|---|
| **NFR-18** | At least 80% of questions asked in a session shall be judged relevant to the selected role and focus by two independent reviewers applying the rubric. | 20 recorded sessions, two reviewers, disagreements resolved by a third party | Must |
| **NFR-19** | At least 80% of feedback items generated shall be judged specific and actionable, rather than generic, by two independent reviewers applying the rubric. | Same sample and method as NFR-18 | Must |

---

## 4. Domain Requirements

| ID | Requirement | Domain Rationale |
|---|---|---|
| **DR-01** | An interview session shall follow a structure recognizable from campus recruitment: an introduction, one or more question rounds, and a closing. | Practice transfers only if the shape matches the real thing. An open-ended chat rehearses a different activity. |
| **DR-02** | A session’s duration shall be comparable to a real campus interview slot, typically 15 to 45 minutes. | Sustaining composure over a realistic duration is part of what is being practiced. |
| **DR-03** | Interview norms, question types, and evaluation criteria differ by role, and the system shall reflect those differences rather than treating all roles alike. | An observable fact about recruitment, independent of this system. How it is reflected is a design decision. |
| **DR-04** | Evaluation of behavioral answers shall be framed against an established approach such as the STAR method, rather than unstructured impression. | This is how interview panels are trained to assess behavioral answers in this domain. |
| **DR-05** | Evaluation of technical answers shall consider correctness, the reasoning and complexity of the approach, and clarity of communication — not correctness alone. | Real technical interviews grade the reasoning, not just the final answer. A tool that grades only correctness teaches the wrong thing. |
| **DR-06** | Because the system holds candidates’ recorded answers, it is subject to the personal-data handling expectations that apply to any recruitment-adjacent tool, independent of which specific regulation the team ultimately cites. | Arises from the category of data held, not from a stakeholder request. |

---

## 5. Open Items and Known Gaps

| ID | Item | Blocks | Owner | Resolution |
|---|---|---|---|---|
| **OI-1** | Confirm scope decision in section 2: practice tool, not marketplace. | All of section 4 | Team lead | Recorded as an architecture decision. |
| **OI-2** | Set per-session cost ceiling in ₹. | NFR-16 | Platform owner | Measure actual provider cost across sessions, then set funding ceiling. |
| **OI-3** | Write per-role evaluation rubrics. | FR-20, NFR-18, NFR-19 | Elicitation pair | Role rubrics documented in evaluation service. |
| **OI-4** | Validate 100-concurrent-session figure. | NFR-06 | Placement Cell liaison | Placement Cell consultation. |
| **OI-5** | Decide whether FR-30 (text alternative) is in scope. | FR-30, NFR-14 | Team lead | Scoped in for Sprint 4/5. |
| **OI-6** | Consult Placement Cell on desired aggregate data. | FR-33 | Placement Cell liaison | Stakeholder interview. |

---

## 6. Requirements Traceability Matrix

Every requirement maps to code, tests, and current delivery status.

### Status Legend
- **Done**: Fully implemented and covered by automated tests.
- **In Progress**: Active work in current sprint.
- **Deferred**: Postponed beyond MVP with recorded justification.

| Req ID | Priority | Description | Issue / PR | Code File(s) | Test File(s) | Status | Notes / Deferral Reason |
|---|---|---|---|---|---|---|---|
| **FR-01** | Must | Email/password account creation & sign in | #23, #119 | `apps/web/src/context/AuthContext.tsx`, `apps/api/src/routes/auth.ts` | `apps/api/src/__tests__/auth.test.ts` | Done | Backed by Supabase Auth |
| **FR-02** | Should | Google OAuth account creation & sign in | #119 | `apps/web/src/screens/login/Login.tsx`, `apps/web/src/context/AuthContext.tsx` | `apps/web/src/screens/login/Login.test.tsx` | Done | Google OAuth via Supabase |
| **FR-03** | Must | Candidate sign out | #23 | `apps/web/src/context/AuthContext.tsx`, `apps/web/src/components/Navbar.tsx` | `apps/web/src/screens/login/Login.test.tsx` | Done | Invalidates active session |
| **FR-04** | Should | Password reset via email code | #197 | `apps/web/src/screens/reset-password/ResetPassword.tsx` | | In Progress | |
| **FR-05** | Should | End session on browser close unless 'stay signed in' | #198 | `apps/web/src/context/AuthContext.tsx` | | In Progress | |
| **FR-06** | Must | Role selection list before session start | #24 | `apps/web/src/screens/new-interview/NewInterview.tsx`, `packages/contracts/src/index.ts` | `apps/api/src/__tests__/session.test.ts` | Done | Shared contract ROLES catalogue |
| **FR-07** | Should | Select interview focus within role | #135 | `apps/web/src/screens/new-interview/NewInterview.tsx` | | In Progress | |
| **FR-08** | Should | Resume file upload | #25, #123 | `apps/api/src/routes/resume.ts`, `apps/web/src/screens/dashboard/Dashboard.tsx` | `apps/api/src/__tests__/resume-summary.test.ts`, `apps/api/src/__tests__/session.test.ts`, `apps/web/src/screens/new-interview/NewInterview.test.tsx` | Done | PDF is read in memory and only the extracted text and profile are stored |
| **FR-09** | Should | Ask question referencing resume content | #87, #123 | `apps/api/src/services/briefing.service.ts` | `apps/api/src/__tests__/briefing.test.ts`, `apps/api/src/__tests__/voice-token.test.ts` | Done | Injected into Gemini Live prompt |
| **FR-10** | Could | GitHub username context retrieval | #195 | — | | In Progress | |
| **FR-11** | Could | Custom profile text context upload | #160 | `apps/api/src/services/briefing.service.ts` | | In Progress | |
| **FR-12** | Must | Spoken interview without typing | #54, #110, #141, #144, #145 | `apps/web/src/lib/voiceAdapter.ts`, `apps/web/src/lib/geminiLiveAdapter.ts`, `apps/web/src/screens/interview-room/useInterview.ts` | `apps/web/src/lib/geminiLiveAdapter.test.ts`, `apps/web/src/lib/voiceAdapter.test.ts`, `apps/web/src/screens/interview-room/InterviewRoom.test.tsx` | Done | `GeminiLiveVoiceAdapter` wired into `InterviewRoom` with `BrowserWebSpeechVoiceAdapter` + `POST /next-question` fallback (`ADR-0014`), late-result guard, 5s pause timeout, no-voices warning, and 9 s thinking-silence encouragement prompts (`#145`) |
| **FR-13** | Must | Dynamic follow-up question based on preceding answer | #87, #113 | `apps/api/src/services/briefing.service.ts`, `apps/api/src/services/interviewer.service.ts` | `apps/api/src/__tests__/briefing.test.ts`, `apps/api/src/__tests__/next-question.test.ts` | Done | Contextual prompt guidance |
| **FR-14** | Should | Interruption handling (barge-in stops AI speech) | #54, #105, #141 | `apps/web/src/lib/geminiLiveAdapter.ts`, `apps/web/src/lib/transcriptAccumulator.ts`, `apps/web/src/screens/interview-room/useInterview.ts` | `apps/web/src/lib/geminiLiveAdapter.test.ts`, `apps/web/src/lib/__tests__/transcriptAccumulator.test.ts`, `apps/web/src/screens/interview-room/InterviewRoom.test.tsx` | Done | Live barge-in stops `PlaybackQueue` immediately and room uses `GeminiLiveVoiceAdapter` (`ADR-0014`; turn saving completes in VI-2) |
| **FR-15** | Must | No repeated questions in same session | #87 | `apps/api/src/services/briefing.service.ts` | `apps/api/src/__tests__/briefing.test.ts` | Done | Enforced by session prompt history |
| **FR-16** | Could | No repeated questions across last 3 sessions | #159, #215 | `apps/api/src/services/session.service.ts`, `apps/api/src/services/briefing.service.ts` | `apps/api/src/__tests__/briefing.test.ts` | In Progress | |
| **FR-17** | Should | Interviewer persona matching role and focus | #87 | `apps/api/src/services/briefing.service.ts` | `apps/api/src/__tests__/briefing.test.ts` | Done | Role-tailored persona prompt |
| **FR-18** | Must | Early exit from interview session | #26, #126 | `apps/web/src/screens/interview-room/useInterview.ts`, `apps/api/src/services/session.service.ts` | `apps/api/src/__tests__/session.test.ts` | Done | `POST /api/sessions/:id/end` |
| **FR-19** | Could | Record early-end reason | #154 | `apps/web/src/screens/interview-room/InterviewRoom.tsx` | | In Progress | |
| **FR-20** | Must | Evaluation against role-specific rubric | #27, #122 | `apps/api/src/services/evaluator.service.ts`, `apps/api/src/services/rubrics.ts` | `apps/api/src/__tests__/evaluator.test.ts` | Done | Per-role rubric prompts |
| **FR-21** | Must | Structured feedback with strengths and improvement areas | #27, #122 | `apps/api/src/services/evaluator.service.ts`, `packages/contracts/src/index.ts` | `apps/api/src/__tests__/evaluator.test.ts` | Done | Validated by Zod contract |
| **FR-22** | Must | Display feedback after session ends | #28 | `apps/web/src/screens/results/ResultsScreen.tsx`, `apps/web/src/screens/results/useFeedback.ts` | `apps/web/src/screens/results/ResultsScreen.test.tsx` | Done | Polling with reactive status |
| **FR-23** | Should | Live feedback preparation notice without reload | #28 | `apps/web/src/screens/results/ResultsScreen.tsx`, `apps/web/src/screens/results/useFeedback.ts` | `apps/web/src/screens/results/ResultsScreen.test.tsx` | Done | Auto-polling until ready |
| **FR-24** | Must | Transcript persistence for completed session | #26, #106 | `apps/api/src/services/session.service.ts`, `apps/web/src/lib/api.ts` | `apps/api/src/__tests__/session.test.ts` | Done | Stored in `turns` table |
| **FR-25** | Should | List past sessions with role and outcome | #94, #127 | `apps/web/src/screens/history/HistoryPage.tsx`, `apps/api/src/routes/sessions.ts` | `apps/web/src/screens/history/HistoryPage.test.tsx`, `apps/api/src/__tests__/session.test.ts` | Done | History screen with session cards |
| **FR-26** | Should | View past transcripts and feedback | #85, #125 | `apps/web/src/screens/history/HistoryPage.tsx`, `apps/web/src/screens/results/ResultsScreen.tsx` | `apps/web/src/screens/history/HistoryPage.test.tsx`, `apps/web/src/screens/results/ResultsScreen.test.tsx`, `apps/api/src/__tests__/session.test.ts` | Done | Historical review views |
| **FR-27** | Must | Restrict access to candidate's own sessions (404) | #26, #27 | `apps/api/src/services/session.service.ts` (`getOwnedSession`) | `apps/api/src/__tests__/session.test.ts`, `apps/api/src/__tests__/feedback.test.ts` | Done | Ownership check returns 404 |
| **FR-28** | Must | Delete own past sessions & data | #97, #124 | `apps/api/src/services/session.service.ts`, `apps/api/src/routes/sessions.ts`, `apps/web/src/screens/results/ResultsScreen.tsx` | `apps/api/src/__tests__/session.test.ts`, `apps/api/src/__tests__/session-deletion.integration.test.ts`, `apps/web/src/screens/results/ResultsScreen.test.tsx` | Done | Cascade delete on user session |
| **FR-29** | Could | Mark session for retention past 30 days | #191 | `apps/api/src/services/session.service.ts` | | In Progress | |
| **FR-30** | Should | Full typed interview mode (no microphone needed) | #156 | `apps/web/src/screens/interview-room/TypedAnswerBox.tsx`, `apps/api/src/routes/sessions.ts` | | In Progress | Spoken & typed answer fallback |
| **FR-31** | Should | Add/edit roles without code change | #172 | — | — | Deferred | Out of scope for MVP; roles defined in shared contracts |
| **FR-32** | Should | Owner dashboard reporting session count, duration, cost | #201 | `apps/web/src/screens/admin-dashboard/AdminDashboard.tsx` | | In Progress | Sprint 5 task RJ-10 |
| **NFR-01** | Must | Spoken response within 5 seconds for ≥95% of turns | #146 | `apps/web/src/lib/geminiLiveAdapter.ts` | `apps/web/src/lib/geminiLiveAdapter.test.ts` | In Progress | Not measured yet (VI-7) |
| **NFR-02** | Should | Barge-in interruption stops audio within 500 ms | #105, #110, #141 | `apps/web/src/lib/geminiLiveAdapter.ts`, `apps/web/src/screens/interview-room/useInterview.ts` | `apps/web/src/lib/geminiLiveAdapter.test.ts`, `apps/web/src/lib/__tests__/transcriptAccumulator.test.ts`, `apps/web/src/screens/interview-room/InterviewRoom.test.tsx` | In Progress | Live adapter wired into room (`ADR-0014`); client stops playback immediately on `interrupted`; 50-event live timing measurement in test report |
| **NFR-03** | Must | Structured feedback within 15 seconds for ≥95% of sessions | #86, #122 | `apps/api/src/services/evaluator.service.ts`, `apps/api/src/worker.ts` | `apps/api/src/__tests__/evaluator.test.ts`, `apps/api/src/__tests__/evaluate-cli.test.ts` | Done | Timed benchmarked background worker |
| **NFR-04** | Must | Retain transcript on evaluation failure & allow retry | #92, #129 | `apps/api/src/services/feedback.service.ts`, `apps/api/src/routes/feedback.ts`, `apps/api/src/worker.ts` | `apps/api/src/__tests__/feedback.test.ts` | Done | Transcript never cleared on job error |
| **NFR-05** | Should | Recover from network drop ≤10s without losing transcript | #91, #120, #142, #216 | `apps/web/src/lib/geminiLiveAdapter.ts` | `apps/web/src/lib/geminiLiveAdapter.test.ts` | In Progress | Gemini Live session resumption token handle |
| **NFR-06** | Should | Sustain 100 concurrent sessions | #178 | — | — | Deferred | Student infrastructure budget ceiling; load test deferred |
| **NFR-07** | Must | Passwords stored salted/hashed (no plaintext) | #23 | Supabase Auth (bcrypt/Argon2) | `apps/api/src/__tests__/auth.test.ts` | Done | Delegated to Supabase Auth infrastructure |
| **NFR-08** | Must | All traffic encrypted in transit (TLS/HTTPS/WSS) | #15 | Cloud Run & Firebase Hosting | Verification via TLS inspection | Done | Enforced by hosting provider configuration |
| **NFR-09** | Must | Third-party provider keys never exposed to browser | #87, #113 | `apps/api/src/services/voice-provider.service.ts`, `apps/api/src/routes/sessions.ts` | `apps/api/src/__tests__/voice-token.test.ts` | Done | Ephemeral single-use voice tokens only |
| **NFR-10** | Must | Server-side transcript corroboration for evaluation | #158 | `apps/api/src/services/session.service.ts`, `apps/api/src/routes/sessions.ts` | `apps/api/src/__tests__/session.test.ts`, `apps/api/src/__tests__/transcript-integrity.test.ts` | Done | Server-authoritative turn index, timestamp, 4k char cap, unique-index retry, soft warnings, ADR-0012 |
| **NFR-11** | Must | Auto-delete sessions & recordings within 30 days | #190 | `apps/api/src/worker.ts` | | In Progress | Sprint 5 scheduled cleanup job |
| **NFR-12** | Must | No personal data transmitted to non-essential third parties | Architecture | `apps/api/src/server.ts` | Codebase audit | Done | Only Gemini API and Supabase accessed |
| **NFR-13** | Should | First-time user can start session unaided in <5 minutes | UX | `apps/web/src/screens/new-interview/NewInterview.tsx` | Usability trial | Done | 2-click interview setup flow |
| **NFR-14** | Should | Non-audio interface meets WCAG 2.1 AA | #172 | `apps/web/src/components/` | Automated axe/lighthouse audit | In Progress | Ongoing UI accessibility pass |
| **NFR-15** | Should | Cross-browser support (Chrome, Firefox, Edge, Safari) | #184 | `apps/web/src/lib/voiceAdapter.ts` | Browser test matrix | In Progress | Standard Web APIs and fallbacks |
| **NFR-16** | Must | Average infrastructure cost per session within ceiling | #166, #167 | — | Cost monitoring audit | In Progress | Tracked via admin usage stats |
| **NFR-17** | Should | Role addition requires no code changes outside catalogue | Architecture | `packages/contracts/src/index.ts` | Architecture review | Deferred | Roles centralized in contracts package for type safety |
| **NFR-18** | Must | ≥80% questions judged relevant to role & focus | #87, #123, #173 | `apps/api/src/services/briefing.service.ts` | Rubric evaluation benchmark | In Progress | Briefing service guides question relevance |
| **NFR-19** | Must | ≥80% feedback items judged specific & actionable | #86, #122, #173 | `apps/api/src/services/evaluator.service.ts` | `docs/evaluation-benchmark.md` | In Progress | Evaluator prompt includes strict rubric criteria |
| **DR-01** | Domain | Recognizable recruitment structure: Intro, rounds, closing | Domain | `apps/api/src/services/briefing.service.ts` | `apps/api/src/__tests__/briefing.test.ts` | Done | Multi-turn progression: warm-up, deep-dive, wrap-up |
| **DR-02** | Domain | Realistic session duration (15–45 minutes) | Domain | `apps/web/src/screens/interview-room/useInterview.ts`, `apps/api/src/services/briefing.service.ts` | `apps/api/src/__tests__/briefing.test.ts`, `apps/api/src/__tests__/voice-token.test.ts` | Done | Timer & session duration parameters |
| **DR-03** | Domain | Distinct norms, question types, and rubrics per role | Domain | `packages/contracts/src/index.ts`, `apps/api/src/services/rubrics.ts`, `apps/api/src/services/evaluator.service.ts` | `apps/api/src/__tests__/evaluator.test.ts` | Done | Custom rubrics for SWE, Data Analyst, Backend Dev |
| **DR-04** | Domain | Behavioral answers evaluated against STAR method | Domain | `apps/api/src/services/evaluator.service.ts` | `apps/api/src/__tests__/evaluator.test.ts` | Done | STAR criteria in evaluation rubric |
| **DR-05** | Domain | Technical answers grade reasoning and complexity, not just correctness | Domain | `apps/api/src/services/evaluator.service.ts`, `apps/api/src/services/rubrics.ts` | `apps/api/src/__tests__/evaluator.test.ts` | Done | Evaluator rubric balances complexity & rationale |
| **DR-06** | Domain | Personal-data handling compliance for candidate audio/transcripts | Domain | `apps/api/src/services/session.service.ts` | `apps/api/src/__tests__/session.test.ts` | Done | Strict authorization, user-driven deletion, encryption |
