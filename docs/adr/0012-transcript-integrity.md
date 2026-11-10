# ADR-0012: Transcript integrity checks and NFR-10 vs NFR-01 balance

- **Status:** Accepted, 10 Nov 2026
- **Context:** NFR-10 (server-side transcript corroboration for evaluation) vs NFR-01 (voice response latency ≤ 5 s)

## Context

The mock interview system relies on the stored conversation transcript (`Turn` records) to produce evaluation rubrics, scores, and candidate feedback upon interview completion (FR-20, DR-04).

Under **NFR-10**, the system must not accept client-submitted transcript content as the sole basis for evaluation without server-side corroboration. The threat model includes:
1. Malicious candidates fabricating stellar responses or deleting poor answers.
2. Scripted prompt injection attempting to overflow LLM context buffers with arbitrarily large turn payloads.
3. Submitting forged turns to ended sessions or sessions belonging to other candidates.
4. Duplicate turn indices and race conditions corrupting transcript ordering.

However, **NFR-01** mandates conversational voice latency under 5 seconds (target < 2 s) for spoken mock interviews. With Gemini Live (VI-1, VI-8), conversational audio streams in real time via bidirectional WebSockets directly between the candidate's browser and Google using ephemeral, scoped voice tokens (DR-02, NFR-09). The intermediate audio frames do not route through `apps/api` on each turn.

If the backend required synchronous cryptographic audio watermarking, server-side audio interception/proxying, or independent re-transcription pipelines (e.g. Whisper) before acknowledging each turn, response latency would far exceed the 5-second ceiling and severely degrade conversational fluidity.

## Decision

We enforce a tiered server-side integrity boundary that guarantees consistency and rejects attacks without impeding real-time voice latency:

### 1. Hard Integrity Enforcement (Rejection)
- **Session Ownership and State Validation:** Turns are only accepted if the session is owned by the authenticated caller (404 on mismatch, FR-27) and has status `LIVE` (409 on ended/cancelled sessions).
- **Payload Bound (4,000 Characters):** Turn text is strictly limited to 4,000 characters. Submissions exceeding this limit are rejected with HTTP 400 (`TurnTextTooLongError`), preventing context-flooding attacks.
- **Server-Authoritative Clock & Timestamps:** The client-supplied `timestampSec` (if any) is disregarded. The server computes `timestampSec` from `session.startedAt` using server monotonic time.
- **Strict Turn Index Uniqueness & Concurrency Retries:** We enforce a database-level unique constraint `@@unique([sessionId, turnIndex])` on `turns`. In `addTurn`, when concurrent turns arrive and trigger a unique constraint collision (`P2002`), the transaction retries automatically up to 3 times to allocate the next valid sequential `turnIndex`.

### 2. Permissive Heuristics for Real-time Voice (Warnings Only)
- **Non-alternating Speakers:** Spoken interviews naturally exhibit barge-in, interruptions, backchanneling ("uh-huh", "right"), and short successive turns. If consecutive turns have the same speaker, the server logs a warning (`[transcript-integrity] Non-alternating speaker`) but does not reject the turn.
- **Monotonic Timestamp Jitter:** Rapid client-side chunk flushing may occasionally record adjacent turns within milliseconds. If a turn's timestamp is non-monotonic, the server logs a warning rather than rejecting.

## Consequences

- **Latency Preserved:** The browser communicates directly with Gemini Live for conversational speed (NFR-01), while `apps/api` asynchronously stores turns via `POST /api/sessions/:id/turns`.
- **Database Consistency:** Transcripts cannot contain duplicate turn indices, preventing out-of-order rendering on the results screen and evaluator inconsistencies.
- **Context Injection Defended:** Capping turn length at 4,000 characters prevents abuse of downstream Gemini evaluation tokens and prompt-injection flooding.
- **Residual Risk:** Because audio travels directly from the client to Gemini Live rather than through a server audio proxy, a determined adversary with valid session credentials could tamper with the transcribed text in the browser prior to the `postTurn` HTTP call. Full corroboration via server-side audio recording and independent transcription is deferred to future architecture when dedicated media proxy servers are provisioned.
