# How the spoken interview works

For developers changing the interview room. The decision behind the design is
[ADR-0014](../adr/0014-voice-transport.md); this page is the how.

## The pieces

| File | Job |
|---|---|
| `apps/web/src/screens/interview-room/useInterview.ts` | The room's state machine: picks the adapter, falls back, saves turns, runs the timer and the silence cues, ends the interview |
| `apps/web/src/lib/voiceAdapter.ts` | The `VoiceSessionAdapter` interface, and the browser-speech adapter (the fallback) |
| `apps/web/src/lib/geminiLiveAdapter.ts` | The Gemini Live adapter: token, WebSocket, microphone, playback, barge-in, reconnects |
| `apps/web/src/lib/audio.ts` | Microphone capture helpers and the `PlaybackQueue` |
| `apps/web/src/lib/pcmCaptureWorklet.ts` | Turns microphone audio into 16 kHz PCM chunks of about 40 ms |
| `apps/web/src/lib/transcriptAccumulator.ts` | Joins Gemini's transcription fragments into whole turns |
| `apps/api/src/services/voice-provider.service.ts` | Mints the single-use Gemini Live token on the server |
| `apps/api/src/services/briefing.service.ts` | Writes the interviewer's instructions, used by every mode |

## The adapter interface

The room never talks to a voice provider directly. It uses this interface:

```ts
interface VoiceSessionAdapter {
  connect(sessionId, callbacks, token?): Promise<void>;
  setMuted(muted: boolean): void;
  sendText(text: string): void;   // a cue into the conversation, e.g. "2 minutes remain"
  disconnect(): void;
}
```

The adapter reports back through callbacks: `onStateChange` (`IDLE`, `AI_SPEAKING`, `LISTENING`,
`CANDIDATE_SPEAKING`, `PROCESSING`, `RECONNECTING`, `ERROR`), `onTranscript` (a finished turn,
with `latencyMs` on AI turns), `onAudioLevel` (for the level meter) and `onError`.

Two adapters implement it: `GeminiLiveVoiceAdapter` and `BrowserWebSpeechVoiceAdapter`. Swapping
one for the other is the whole fallback.

## A Gemini Live session, step by step

1. **Token.** The adapter calls `POST /api/sessions/:id/voice-token`. The server checks the
   session is the caller's and LIVE, builds the briefing, and asks Google for an ephemeral token:
   - it can be used once, must be used within 2 minutes, and expires after 30;
   - its `fieldMask` locks the model, voice, briefing, transcription settings, context
     compression and session resumption, so the browser can't change them.
   The Gemini API key never leaves the server.
2. **Connect.** The browser opens a WebSocket straight to Google with that token. Audio never
   passes through our server, which keeps latency down (NFR-01).
3. **Microphone.** `getUserMedia` (with the device chosen in the mic check) feeds the capture
   worklet, which sends a PCM chunk about every 40 ms while not muted.
4. **Speech detection.** Gemini decides when the candidate has finished speaking. The adapter
   asks it to wait for 2 seconds of silence (`END_SENSITIVITY_LOW`), so a short thinking pause
   doesn't end the answer. This setting is not in the token's `fieldMask`, so the browser can set it.
5. **The AI speaks.** Audio arrives in chunks faster than real time. `PlaybackQueue` schedules
   them back to back at 24 kHz. Only when the queue has drained does the room switch to
   `LISTENING`.
6. **Barge-in.** If the candidate talks over the AI, Gemini sends `interrupted`; the adapter stops
   playback at once and saves the partial AI turn.
7. **Transcripts.** Gemini sends transcription fragments for both sides. `TranscriptAccumulator`
   joins them into turns, and the room saves each finished turn with `POST /turns`, one at a time
   in order.
8. **Response time.** For each AI turn the adapter records `latencyMs`: from the candidate's last
   transcribed words to the first AI audio chunk. `scripts/latency.ts` summarises it (NFR-01).
9. **Dropped connection.** The adapter keeps Gemini's resumption handle in `sessionStorage` and
   reconnects up to 3 times, 2.5 seconds apart, showing `RECONNECTING`. If that fails, the room
   falls back to browser speech.

## Cues the room sends

`useInterview.ts` sends short text cues into the conversation with `sendText`:
- **Thinking:** after 9 seconds of real silence that starts after the AI finishes speaking,
  `[the candidate is thinking; offer brief encouragement]`. Silence means the microphone level
  stays under 0.12.
- **Wrap-up:** at 2 minutes left, `2 minutes remain; start wrapping up`.

## The fallback: browser speech

If Gemini Live fails to start or can't reconnect, the room switches to
`BrowserWebSpeechVoiceAdapter`:
- it listens with the browser's `SpeechRecognition` (Chrome and Edge only) and speaks with
  `speechSynthesis`;
- after each answer the room asks the server for the next question
  (`POST /api/sessions/:id/next-question`), which uses the same briefing and the transcript so far.

**Typed mode** uses the same next-question endpoint with a text box, and needs no microphone.

## Testing it

- **Without a microphone:** use typed mode. The end-to-end test does exactly that.
- **Gemini Live locally:** put a real `GEMINI_API_KEY` in `apps/api/.env`, use Chrome with
  headphones (so the microphone doesn't hear the AI), and start a voice interview.
- **The fallback:** stop the API key from working (or block `generativelanguage.googleapis.com`
  in DevTools) and start a voice interview; the room should switch to browser speech.
- **Chromium on Linux** has no speaking voices until you install `speech-dispatcher` and
  `espeak-ng`.
- **Unit tests:** `geminiLiveAdapter.test.ts`, `audio.test.ts` and `InterviewRoom.test.tsx` fake
  the WebSocket and audio APIs.

## Known gaps

- The microphone keeps streaming when the tab is hidden; nothing pauses it.
- Nothing on the server ends an interview the candidate walked away from; it stays LIVE.
