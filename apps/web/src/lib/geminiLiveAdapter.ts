import { getVoiceToken } from './api';
import { base64Decode, base64Encode, PCM_CAPTURE_PROCESSOR, PlaybackQueue } from './audio';
import pcmCaptureWorkletUrl from './pcmCaptureWorklet.ts?worker&url';
import type { VoiceAdapterCallbacks, VoiceSessionAdapter } from './voiceAdapter';

const LIVE_URL =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained';
const MAX_RECONNECTS = 3;
const RECONNECT_DELAY_MS = 2500;

// Kept in sessionStorage so a page reload can resume the same Gemini session.
const resumptionKey = (sessionId: string) => `gemini_resumption_${sessionId}`;

/** The fields of a Gemini Live server message that this adapter reads. */
interface LiveServerMessage {
  setupComplete?: object;
  goAway?: object;
  sessionResumptionUpdate?: { newHandle?: string; resumable?: boolean };
  serverContent?: {
    interrupted?: boolean;
    turnComplete?: boolean;
    inputTranscription?: { text?: string };
    outputTranscription?: { text?: string };
    modelTurn?: { parts?: { inlineData?: { data?: string } }[] };
  };
}

/**
 * Holds the interview as a spoken conversation with Gemini Live (gemini-3.8-live) over a WebSocket.
 */
export class GeminiLiveVoiceAdapter implements VoiceSessionAdapter {
  public readonly providerLabel = 'Google Gemini Live';
  public readonly isExternalProvider = true;
  public readonly isSpeechRecognitionSupported = true;

  private sessionId = '';
  private callbacks: VoiceAdapterCallbacks | null = null;
  private ws: WebSocket | null = null;

  private audioInCtx: AudioContext | null = null;
  private audioOutCtx: AudioContext | null = null;
  private micStream: MediaStream | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private analyser: AnalyserNode | null = null;
  private playbackQueue: PlaybackQueue | null = null;
  private animationFrameId: number | null = null;

  private isMuted = false;
  private isDeliberateClose = false;
  private resumptionHandle: string | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  async connect(sessionId: string, callbacks: VoiceAdapterCallbacks): Promise<void> {
    this.cleanupAudioAndSocket();
    this.sessionId = sessionId;
    this.callbacks = callbacks;
    this.isDeliberateClose = false;
    this.reconnectAttempts = 0;
    this.resumptionHandle = sessionStorage.getItem(resumptionKey(sessionId));
    callbacks.onStateChange('IDLE');
    await this.startConnection();
  }

  private async startConnection(): Promise<void> {
    try {
      let token: string;
      try {
        // The token is single-use, so every connection (including a resume) needs a new one.
        token = await getVoiceToken(this.sessionId);
      } catch (err) {
        if (this.abandoned()) return;
        const msg = err instanceof Error ? err.message : String(err);
        // If already reconnecting after a network drop (e.g. Wi-Fi off), keep retrying instead of aborting.
        if (this.reconnectAttempts > 0) {
          this.onDropped(msg);
        } else {
          this.fail(msg);
        }
        return;
      }
      if (this.abandoned()) return;

      const audioOutCtx = new AudioContext({ sampleRate: 24000 });
      this.audioOutCtx = audioOutCtx;
      this.playbackQueue = new PlaybackQueue(audioOutCtx, 24000);
      if (audioOutCtx.state === 'suspended') {
        await audioOutCtx.resume();
        if (this.abandoned()) return;
      }

      const micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      this.micStream = micStream;
      if (this.abandoned()) return;

      const ws = new WebSocket(`${LIVE_URL}?access_token=${token}`);
      this.ws = ws;

      ws.onopen = () => {
        // No model or systemInstruction: the backend locks both into the token.
        const setup: Record<string, unknown> = {
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } } },
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
        };
        if (this.resumptionHandle) {
          setup.sessionResumption = { handle: this.resumptionHandle };
        }
        ws.send(JSON.stringify({ setup }));
      };

      ws.onmessage = async (event: MessageEvent) => {
        // Gemini Live sends its JSON as binary frames, which the browser delivers as a Blob.
        const raw = event.data instanceof Blob ? await event.data.text() : event.data;
        // The socket may have been closed or replaced while the frame was being read.
        if (this.ws !== ws) return;
        this.handleMessage(JSON.parse(raw), micStream, ws);
      };

      ws.onerror = () => this.onDropped('Gemini Live WebSocket connection failed');
      ws.onclose = () => this.onDropped('Gemini Live WebSocket disconnected unexpectedly');
    } catch (err) {
      // Token, audio or microphone errors (e.g. permission denied) won't be fixed by retrying.
      if (!this.abandoned()) this.fail(err instanceof Error ? err.message : String(err));
    }
  }

  private handleMessage(response: LiveServerMessage, micStream: MediaStream, ws: WebSocket): void {
    const update = response.sessionResumptionUpdate;
    if (update?.resumable === true && update.newHandle) {
      this.resumptionHandle = update.newHandle;
      sessionStorage.setItem(resumptionKey(this.sessionId), update.newHandle);
    }

    if (response.goAway) {
      // Planned server migration while Wi-Fi is healthy; resume right away without sleeping.
      this.onDropped('Gemini Live closed the session', 0);
      return;
    }

    if (response.setupComplete) {
      this.reconnectAttempts = 0;
      this.callbacks?.onStateChange('LISTENING');
      void this.startMicStreaming(micStream, ws);
      return;
    }

    const serverContent = response.serverContent;
    if (!serverContent) return;

    // FR-14: the candidate spoke over the interviewer, so cut its audio off.
    if (serverContent.interrupted) {
      this.playbackQueue?.stop();
      this.callbacks?.onStateChange('LISTENING');
      return;
    }

    if (serverContent.inputTranscription?.text) {
      this.callbacks?.onTranscript({
        speaker: 'CANDIDATE',
        text: serverContent.inputTranscription.text,
        isFinal: false,
      });
      this.callbacks?.onStateChange('LISTENING');
    }

    if (serverContent.outputTranscription?.text) {
      this.callbacks?.onTranscript({
        speaker: 'AI',
        text: serverContent.outputTranscription.text,
        isFinal: false,
      });
    }

    if (serverContent.modelTurn?.parts) {
      this.callbacks?.onStateChange('AI_SPEAKING');
      for (const part of serverContent.modelTurn.parts) {
        if (part.inlineData?.data) {
          this.playbackQueue?.enqueue(base64Decode(part.inlineData.data));
        }
      }
    }

    if (serverContent.turnComplete) {
      this.callbacks?.onStateChange('LISTENING');
    }
  }

  private async startMicStreaming(micStream: MediaStream, ws: WebSocket): Promise<void> {
    const audioInCtx = new AudioContext();
    this.audioInCtx = audioInCtx;

    try {
      await audioInCtx.audioWorklet.addModule(pcmCaptureWorkletUrl);
    } catch (err) {
      if (this.audioInCtx === audioInCtx && this.ws === ws && !this.isDeliberateClose) {
        this.fail(err instanceof Error ? err.message : String(err));
      }
      return;
    }

    if (this.audioInCtx !== audioInCtx || this.ws !== ws || this.isDeliberateClose) {
      return;
    }

    const sourceNode = audioInCtx.createMediaStreamSource(micStream);
    const analyser = audioInCtx.createAnalyser();
    analyser.fftSize = 256;
    this.analyser = analyser;

    const workletNode = new AudioWorkletNode(audioInCtx, PCM_CAPTURE_PROCESSOR);
    this.workletNode = workletNode;
    workletNode.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
      if (this.isMuted || ws.readyState !== WebSocket.OPEN) return;
      ws.send(
        JSON.stringify({
          realtimeInput: { audio: { data: base64Encode(e.data), mimeType: 'audio/pcm;rate=16000' } },
        })
      );
    };

    sourceNode.connect(analyser);
    analyser.connect(workletNode);
    workletNode.connect(audioInCtx.destination);

    const levels = new Uint8Array(analyser.frequencyBinCount);
    const updateLevel = () => {
      if (this.isMuted) {
        this.callbacks?.onAudioLevel?.(0);
      } else {
        analyser.getByteFrequencyData(levels);
        const avg = levels.reduce((sum, value) => sum + value, 0) / levels.length;
        this.callbacks?.onAudioLevel?.(Math.min(1, avg / 128));
      }
      this.animationFrameId = requestAnimationFrame(updateLevel);
    };
    updateLevel();
  }

  /** True when disconnect() ran while a connection was still being set up; releases what it opened. */
  private abandoned(): boolean {
    if (!this.isDeliberateClose) return false;
    this.cleanupAudioAndSocket();
    return true;
  }

  /** The socket dropped: resume with the stored handle after a short delay, or fail if none or retries ran out. */
  private onDropped(message: string, delayMs = RECONNECT_DELAY_MS): void {
    if (this.isDeliberateClose) return;
    if (!this.resumptionHandle) {
      this.fail(message);
      return;
    }
    if (this.reconnectAttempts >= MAX_RECONNECTS) {
      this.fail(`Reconnection failed after ${MAX_RECONNECTS} attempts`);
      return;
    }
    this.reconnectAttempts += 1;
    console.info(`[geminiLiveAdapter] Reconnecting (attempt ${this.reconnectAttempts}/${MAX_RECONNECTS})`);
    this.cleanupAudioAndSocket();
    this.callbacks?.onStateChange('RECONNECTING');

    if (delayMs > 0) {
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        if (!this.isDeliberateClose) {
          void this.startConnection();
        }
      }, delayMs);
    } else {
      void this.startConnection();
    }
  }

  private fail(message: string): void {
    this.callbacks?.onError?.(message);
    this.callbacks?.onStateChange('ERROR');
    this.cleanupAudioAndSocket();
  }

  /** Sends a text cue into the live conversation (thinking prompts, time cues). */
  sendText(text: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('[geminiLiveAdapter] Cannot sendText: WebSocket is not open');
      return;
    }
    this.ws.send(
      JSON.stringify({
        clientContent: { turns: [{ role: 'user', parts: [{ text }] }], turnComplete: true },
      })
    );
  }

  setMuted(muted: boolean): void {
    this.isMuted = muted;
    if (muted) {
      this.callbacks?.onAudioLevel?.(0);
    }
  }

  /** Ends the session for good, so the stored resumption handle is dropped too. */
  disconnect(): void {
    this.isDeliberateClose = true;
    this.reconnectAttempts = 0;
    this.resumptionHandle = null;
    if (this.sessionId) {
      sessionStorage.removeItem(resumptionKey(this.sessionId));
    }
    this.cleanupAudioAndSocket();
    this.callbacks?.onStateChange('IDLE');
  }

  private cleanupAudioAndSocket(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    this.playbackQueue?.stop();
    this.playbackQueue = null;
    if (this.workletNode) {
      this.workletNode.port.onmessage = null;
      this.workletNode.disconnect();
      this.workletNode = null;
    }
    this.analyser?.disconnect();
    this.analyser = null;
    this.micStream?.getTracks().forEach((track) => track.stop());
    this.micStream = null;
    void this.audioInCtx?.close();
    this.audioInCtx = null;
    void this.audioOutCtx?.close();
    this.audioOutCtx = null;

    if (this.ws) {
      const socket = this.ws;
      this.ws = null;
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      socket.close();
    }

    this.callbacks?.onAudioLevel?.(0);
  }
}
