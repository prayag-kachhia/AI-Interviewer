# ADR-0014: Voice Transport Adapter Pattern, Ephemeral Tokens, and Server-Side Brain

- **Status:** Accepted, 11 Nov 2026
- **Context:** FR-12 (spoken interview without typing), FR-14 / NFR-02 (barge-in interruption), NFR-01 (≤ 5 s response latency), NFR-09 (never expose provider credentials to the browser)

## Context

The interview room needs low-latency, two-way spoken conversation (including candidate interruptions) on desktop browsers without ever leaking `GEMINI_API_KEY` to client code or diverging in interviewer behaviour across fallback modes.

Direct WebSocket streaming between the browser and Gemini Live (`gemini-3.8-live`) gives natural spoken turn-taking and fast response times, but real student networks and browsers introduce failure modes:
1. Campus networks or strict firewalls can block WebSockets or interrupt ephemeral token minting (`POST /api/sessions/:id/voice-token`).
2. Relying on browser speech recognition (`SpeechRecognition` / `speechSynthesis`) as the sole path fails in browsers without Web Speech support and loses true conversational barge-in.
3. Keeping prompts or question banks on the client lets candidates inspect or alter instructions, and causes fallback interviews to drift from Live interviews.

## Decision

We isolate all voice transport behind a slim `VoiceSessionAdapter` interface (`connect`, `setMuted`, `sendText`, `disconnect`) with a server-authored interviewer brain:

### 1. Primary Gemini Live + Automatic Browser Speech Fallback (Adapter Pattern)
- **Primary (`GeminiLiveVoiceAdapter`):** `apps/web/src/screens/interview-room/useInterview.ts` connects to Gemini Live first over `BidiGenerateContentConstrained` WebSocket (16 kHz PCM microphone stream up, 24 kHz PCM playback queue down, and immediate playback stop on `interrupted`).
- **Automatic Fallback (`BrowserWebSpeechVoiceAdapter`):** If voice-token minting or Gemini Live WebSocket setup/reconnection fails (`onError` or rejected `connect()`), the room disconnects the failed Live adapter, shows a non-blocking warning banner, and automatically switches to `BrowserWebSpeechVoiceAdapter`. If Web Speech recognition is also unsupported in that browser, the room opens the typed fallback box (`TypedAnswerBox`) without crashing.

### 2. Short-Lived Ephemeral Voice Tokens (Security Boundary — NFR-09)
- `GEMINI_API_KEY` stays strictly inside `apps/api/.env`.
- Before opening a Gemini Live WebSocket, the room calls `POST /api/sessions/:id/voice-token` (after `getOwnedSession` ownership verification and `LIVE` status check).
- `apps/api/src/services/voice-provider.service.ts` calls Google's `v1beta/auth_tokens` endpoint to mint a **single-use, short-lived token** (`uses: 1`, 2-minute start window, 30-minute session cap).
- The token payload (`bidiGenerateContentSetup` + `fieldMask`) locks `gemini-3.8-live`, audio modalities, voice (`Puck`), and `systemInstruction` server-side so the browser cannot substitute another model or prompt.

### 3. Single Server-Side Brain (`briefingFor`) Across Every Mode
- `apps/api/src/services/briefing.service.ts` (`briefingFor(session)`) assembles the role persona, focus/level/company context, resume summary, past-session questions (`FR-16`), 3-phase progression, and guardrails in one place.
- **Live path:** `briefingFor(session)` is embedded in the ephemeral voice token's locked `systemInstruction`.
- **Fallback & typed path:** Whenever a candidate turn finishes in fallback or typed mode, the room saves the candidate turn first (`POST /api/sessions/:id/turns`) and then calls `POST /api/sessions/:id/next-question` (`PK-3`), where `interviewer.service.ts` passes `briefingFor(session)` + the stored DB turns to `gemini-3.8-flash` and saves the returned AI turn. Fixed client-side question scripts are no longer used by the room.

## Consequences

- **No Dead Ends in the Interview Room:** Token errors or WebSocket blocks automatically degrade to browser speech + `/next-question` without losing transcript turns or crashing the interview.
- **Zero Client Secrets or Prompt Tampering:** Neither `GEMINI_API_KEY` nor interviewer system instructions are writable from browser devtools.
- **Consistent Interview Quality:** Live, browser-fallback, and typed interviews follow the exact same resume-aware briefing, guardrails, and non-repetition logic.
- **Trade-offs:** Browser fallback trades Gemini Live's full-duplex audio and sub-second barge-in for turn-by-turn HTTP latency (`gemini-3.8-flash`) and Web Speech browser compatibility (`Chrome`/`Edge`), while `VI-2` subsequently hooks `TranscriptAccumulator` into Gemini Live's streamed text chunks so Live turns persist identically to fallback turns.
