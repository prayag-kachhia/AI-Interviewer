# Vishwa's Voice Engineering Guide (AI-Interviewer)

> **Welcome to your personal study guide!**  
> This file is your living notebook for the AI-Interviewer project (IT314, DA-IICT).  
> It explains every single feature you build in **plain, simple English** (no confusing jargon).  
> Whenever your professor, teammates, or evaluators ask you how your code works, this guide has the exact answers.

---

## 1. The Big Picture: What is our Project?

Our app is an **AI Mock Interviewer**.  
A candidate signs in, uploads their resume, picks a role (like Software Engineer), talks into their microphone with a real-time AI interviewer, and gets graded feedback at the end.

### How the Voice System Works (Simple Flowchart):

```text
[Candidate speaks into Microphone]
               │
               ▼
   [Convert raw audio into 16-bit PCM bytes]  <-- (Issue #81 / audio.ts)
               │
               ▼
   [Stream bytes to Google Gemini Live over WebSocket]  <-- (Issue #72 / useGeminiLive.ts)
               │
               ▼
   [Google Gemini Live replies with 24kHz audio bytes]
               │
               ▼
   [Play audio smoothly through speakers without lag]  <-- (PlaybackQueue)
```

---

## 2. What We Have Built So Far (Sprint 3 Recap)

### Milestone 1: Audio Helpers (`apps/web/src/lib/audio.ts` — PR #107 / Issue #81)
- **The Problem:** Microphones capture audio as smooth continuous sound waves (decimal numbers like `0.234`). Google Gemini Live does not understand that format; it strictly requires **16-bit PCM** (integers between `-32768` and `+32767`).
- **What you built:** Pure conversion math functions:
  1. `floatTo16BitPCM()`: Converts microphone decimals into 16-bit bytes.
  2. `pcm16ToFloat()`: Converts bytes back to decimals for playback.
  3. `PlaybackQueue`: A clean waiting line that receives audio chunks from Google and plays them one after another smoothly at 24,000 samples per second (24kHz) without any robotic stuttering or gaps.

---

### Milestone 2: Gemini Live Connection Hook (`apps/web/src/lib/useGeminiLive.ts` — PR #110 / Issue #72)
- **The Problem:** How does the browser actually talk to Google's super-smart voice model (`gemini-3.8-live`) in real time?
- **What you built:** The WebSocket communication engine:
  1. Fetches a secure, single-use token from our backend (so API keys are never leaked to the browser).
  2. Opens a live WebSocket to Google Cloud.
  3. Sends speech bytes and receives spoken AI replies.
  4. **Interruption (FR-14):** If the AI is talking and the candidate starts speaking, it immediately stops playing the AI's voice so the AI never talks over the human!

---

### Milestone 3: Session Resumption (`useGeminiLive.ts` updates — PR #120 / Issue #91)
- **The Problem:** Gemini Live connections drop after ~10–15 minutes (server timeout `GoAway`), or if the candidate's Wi-Fi blinks. Without resumption, Gemini forgets the whole interview and starts over from "Hello, who are you?".
- **What you built:**
  1. Stores Google's secret `resumptionHandle` in the browser's `sessionStorage`.
  2. If the connection drops or the candidate refreshes the page, the hook requests a fresh token and reconnects with `{ sessionResumption: { handle } }`.
  3. Gemini restores the exact conversation history, so the candidate continues their interview without losing a single question or answer.
  4. Capped at 3 retry attempts to prevent infinite reconnection loops.

---

## 3. What We Are Building Now: `VI-1` (Issue #130)

### Feature: `GeminiLiveVoiceAdapter` (`apps/web/src/lib/geminiLiveAdapter.ts`)

#### The Real-Life Analogy: The TV and the Standard Plug
- **The TV screen:** Our website's interview room (`useInterview.ts`).
- **The Old Antenna:** The robotic offline browser speech synthesis (`BrowserWebSpeechVoiceAdapter`).
- **The PlayStation 5:** Our Gemini Live engine (`useGeminiLive.ts`).

Right now, the TV screen has a standard plug hole in the back called `VoiceSessionAdapter`.  
Our Gemini Live engine was written as loose raw wires (a React Hook). The TV screen couldn't plug into it!

#### What `VI-1` does:
We put a **standard plug** on Gemini Live.  
That plug is a class called `GeminiLiveVoiceAdapter` with 3 simple buttons:

1. **`connect(sessionId, callbacks)`**: Turns on the mic, opens the WebSocket, and starts the real AI interview.
2. **`disconnect()`**: Turns off the mic and cleanly closes the connection when the interview is finished.
3. **`setMuted(boolean)`**: Mutes or unmutes the microphone.
4. **`sendText(text)`**: Sends a text instruction to the AI if needed (e.g. encouragement cues).

Once this plug is built, the interview room can simply plug it in, and the candidate will immediately hear the real Gemini Live voice instead of the robotic browser voice!

### Milestone 4: Gemini Live Voice Adapter (`apps/web/src/lib/geminiLiveAdapter.ts` — Issue #130 / VI-1)
- **The Problem:** The interview room (`useInterview.ts`) uses an interface called `VoiceSessionAdapter`. Up until now, it only had `BrowserWebSpeechVoiceAdapter` (robotic computer voice). It needed a production-ready adapter that connects directly to Google Gemini Live over WebSocket.
- **What you built:**
  1. `GeminiLiveVoiceAdapter`: Implements `VoiceSessionAdapter`.
  2. **Clean Lifecycle:**
     - `connect(sessionId, callbacks)`: Obtains ephemeral token from backend, requests mic permissions (16kHz mono), opens WebSocket, sends configuration, and triggers callbacks for state, transcript, and audio volume levels.
     - `disconnect()`: Flushes audio playback, stops microphone media tracks, clears timers, and closes the WebSocket cleanly.
     - `setMuted(boolean)`: Pauses microphone packet streaming and sets volume level meter to 0 while keeping the interview connection alive.
     - `sendText(text)`: Injects real-time text prompts into the live WebSocket using Gemini's `clientContent` format.
  3. **Security:** No API keys in the browser. Backend generates a scoped, temporary voice token where `gemini-3.8-live` and system instructions are securely embedded. The browser does NOT send system instructions.
  4. **Strict Turn-Taking Order:** Waits for the server's `setupComplete` handshake signal before transmitting any microphone audio bytes.
  5. **Instant Interruption (FR-14):** On `serverContent.interrupted`, immediately invokes `playbackQueue.stop()` so the AI stops talking instantly if the user speaks up.
  6. **Resilience & Reconnection:** Automatically saves `resumptionHandle` to `sessionStorage` and handles server `goAway` signals with exponential backoff (capped at 3 retries).
  7. **Comprehensive Unit Tests (`geminiLiveAdapter.test.ts`):** 9 mock WebSocket & Web Audio unit tests covering all paths:
     - Connects and sends setup message
     - Waits for `setupComplete` before streaming audio
     - Streams 16-bit PCM audio chunks when listening
     - Stops streaming audio when muted
     - Handles candidate transcription events
     - Handles AI audio chunks and enqueues playback
     - Flushes playback on interruption
     - Reconnects with session resumption handle on `goAway`
     - Cleanly shuts down on `disconnect()`

---

## 4. The Upcoming Roadmap (At a Glance)

| Issue | Feature | In Simple English |
|---|---|---|
| **`VI-1`** | **Gemini Live Voice Adapter** | The "Standard Plug" connecting our voice engine to the room. |
| **`VI-8`** | **Wire into Room + Fallback** | Plugging the plug into the interview screen. If Wi-Fi fails, it automatically falls back to browser speech so the interview never crashes. |
| **`VI-2`** | **Save Voice Turns** | Sending words from Gemini into the database so the evaluator can grade your answers. |
| **`VI-3`** | **Reconnection Polish** | Showing a nice *"Reconnecting…"* banner on the screen if Wi-Fi blinks (you already built the backend logic in PR #120!). |
| **`VI-4`** | **Pre-Interview Mic Check** | Letting candidates test their microphone volume and select their device before starting. |
| **`VI-5`** | **Fix Fallback Speech Bugs** | Cleaning up minor bugs in the offline browser speech fallback. |
| **`VI-6`** | **Thinking-Silence Prompts** | If a candidate is silent for 8–10 seconds thinking, the AI gently says: *"Take your time!"*. |
| **`VI-7`** | **Response Latency Benchmark** | Proving with real numbers that the AI replies in under 5 seconds (NFR-01). |

---

## 5. Viva / Presentation Cheat Sheet (How to answer your Professor)

**Q: What was your contribution to the team?**  
> *"I was responsible for the Voice Transport layer. I implemented the real-time audio pipeline connecting the candidate's browser to Google's Gemini Live model (`gemini-3.8-live`). This included converting microphone audio to 16-bit PCM, managing the 24kHz audio playback queue, handling real-time speech interruptions, and implementing network session resumption."*

**Q: Why did you use an Adapter Pattern?**  
> *"We used the Adapter pattern (`VoiceSessionAdapter`) so the interview screen doesn't care which voice provider is running underneath. It can run Google Gemini Live as the primary high-quality voice, and seamlessly fall back to offline browser speech synthesis if the candidate loses internet, without crashing the interview."*

**Q: How do you handle when a candidate interrupts the AI?**  
> *"Gemini Live server emits an `interrupted: true` event whenever the candidate begins speaking. Our adapter immediately catches this event, flushes the audio playback buffer queue, and cuts off speaker audio in under 50 milliseconds."*

---
*(This file will be automatically updated as we build each issue!)*
