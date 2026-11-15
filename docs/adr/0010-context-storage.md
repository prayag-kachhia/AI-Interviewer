# ADR-0010: Relational PostgreSQL with JSON Context Storage vs NoSQL

- **Status:** Accepted, 14 Nov 2026
- **Context:** Architecture review inquiry regarding the choice of relational PostgreSQL (with selective JSON storage) versus document-oriented NoSQL databases (e.g. MongoDB, DynamoDB) for interview context assembly (FR-11, FR-13).

## Context

During architecture evaluation, the teaching assistant raised the question of whether a document-oriented NoSQL database (such as MongoDB or DynamoDB) would be more naturally suited for storing diverse interview context, candidate resumes, transcripts, job descriptions, and evaluator rubrics than a relational schema.

Our domain requires persisting and coordinating several distinct kinds of data:
1. **Core relational entities**: Candidates (`User`), uploaded resumes (`Resume`), mock interview sessions (`Session`), individual turns (`Turn`), and asynchronous evaluation background jobs (`Job`, `Feedback`).
2. **Flexible candidate inputs**: Selected role, focus areas, target company, seniority level, resume summary, and candidate-pasted target job descriptions (up to 4,000 characters, FR-11).
3. **Dynamic interviewer briefing context**: Built server-side in `briefingFor(session)` and injected into ephemeral Gemini Live voice tokens (NFR-09) and `/api/sessions/:id/next-question` interviewer calls.
4. **Evaluation artifacts**: Multi-category rubric scores, strengths, actionable improvements, exact transcript quotes, and LLM token usage metadata.

## Decision

We chose **relational PostgreSQL** (hosted on Supabase) accessed via **Prisma ORM**, augmented with structured text and native JSON/JSONB fields where flexibility is required, over a document-oriented NoSQL database. 

### 1. ACID Transactions for Critical State Transitions
A critical workflow in the platform is ending an interview (`POST /api/sessions/:id/end`). In a single atomic `$transaction`:
- The `Session` row is updated to status `ENDED` with an `endedAt` timestamp.
- A `session.ended` job is enqueued in the `Job` table for worker processing.
If either step fails, the entire transaction rolls back. In a NoSQL store lacking native multi-document relational transactions (or requiring complex distributed transactions), an unhandled network partition or worker crash could leave sessions marked `ENDED` without an enqueued evaluation job, or spawn orphan jobs for active sessions.

### 2. Relational Integrity and Cascading Cleanup
Every `Session`, `Resume`, `Turn`, and `Job` strictly belongs to a `User`. Under **FR-28** (`DELETE /api/auth/account`), a user's account deletion cascades cleanly through foreign key constraints (`onDelete: Cascade` and `onDelete: SetNull`), guaranteeing that no dangling resumes or session transcripts linger in storage. In NoSQL collections, cascading deletions require error-prone application-level multi-collection cleanups or asynchronous garbage collectors that risk privacy leaks.

### 3. Strict Schema Migrations and Type-Safety
With Prisma migrations (`prisma/migrations/`) and `@interview/contracts`, every database change is versioned, audited, and strictly synchronized with TypeScript schemas across `apps/api` and `apps/web`. When new interview context fields are added (such as `company`, `focus`, `level`, and `jobContext`), migrations enforce explicit column types and defaults (`mode VARCHAR DEFAULT 'voice'`), preventing schema drift across distributed developer workspaces.

### 4. Dynamic Context Assembly in `briefingFor`
Instead of duplicating a bloated, denormalized prompt document for every session, the server dynamically synthesizes the interviewer's instructions in `briefingFor(session)` inside `briefing.service.ts`:
- **Role Persona**: Normalized persona definitions (`ROLE_PERSONAS`) define deep-dive and pressure-testing topics.
- **Candidate Setup**: Injects `company`, `level`, and `focus` into calibrated guidance.
- **Candidate-Supplied Context (FR-11)**: Target job descriptions (`jobContext`) and resume summaries are injected as raw contextual data enclosed in triple quotes (`"""`).
- **Prompt Injection Defense (K-5)**: Guardrail directives explicitly instruct the LLM that candidate-supplied job context is untrusted domain data, never instructions to override persona, leak system prompts, or provide answers.
- **Anti-Repetition (PK-7)**: `recentQuestions(userId, roleId, 3)` performs an efficient relational join over previous ended sessions to exclude recent questions.

### 5. Selective JSON Storage Where Appropriate
Where semi-structured schema evolution is genuinely beneficial (such as parsed resume profiles in `Resume.parsedProfile`, rubric score breakdowns in `Feedback.scores`, and token consumption in `Feedback.usage`), PostgreSQL stores structured JSON text. This provides the flexibility of document stores without forfeiting relational constraints, indexability, or transaction isolation.

## Consequences

- **Atomic Background Jobs**: Background evaluation workers reliably dequeue and process feedback without race conditions or dropped jobs.
- **Zero Prompt Duplication**: Briefings are computed on-demand from relational context rather than stored redundantly in database rows.
- **Security & Integrity**: Strict length bounds (e.g. 4,000 characters for `jobContext` and turn text) and foreign-key boundaries prevent context-flooding attacks and data leaks.
- **Migration Discipline**: Adding new context parameters requires explicit schema migrations and contracts updates, ensuring full architectural consensus across the team.
