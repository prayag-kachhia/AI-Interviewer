import type { InterviewVoiceState, TurnSpeaker } from '../types';

/**
 * Contract for short-lived voice session tokens.
 * Never store or return permanent provider API keys here — only ephemeral session tokens.
 */
export interface VoiceSessionToken {
  token: string;
  provider: string;
  expiresAt?: string;
  endpointUrl?: string;
}

export interface VoiceTranscriptEvent {
  speaker: TurnSpeaker;
  text: string;
  isFinal: boolean;
}

export interface VoiceAdapterCallbacks {
  onStateChange: (state: InterviewVoiceState) => void;
  onTranscript: (event: VoiceTranscriptEvent) => void;
  onAudioLevel?: (level: number) => void;
  onError?: (message: string) => void;
}

/**
 * Clean abstraction isolating `InterviewRoom` from specific voice provider SDKs.
 *
 * Because external provider code is not yet present in this repository, the screen
 * programs against `VoiceSessionAdapter`. Once the provider token/SDK lands, wire its
 * implementation into `createVoiceSessionAdapter` without changing `InterviewRoom.tsx`.
 */
export interface VoiceSessionAdapter {
  readonly providerLabel: string;
  readonly isExternalProvider: boolean;
  readonly isSpeechRecognitionSupported: boolean;
  connect(sessionId: string, callbacks: VoiceAdapterCallbacks, token?: VoiceSessionToken): Promise<void>;
  speakAiQuestion(text: string): Promise<void>;
  startListening(): Promise<void>;
  finishCandidateTurn(): void;
  setMuted(muted: boolean): void;
  disconnect(): void;
}

/**
 * Browser Web Speech API + Web Audio microphone adapter implementing `VoiceSessionAdapter`.
 * Used when no external provider token is configured so the spoken audio flow
 * (AI speech synthesis -> candidate microphone speech recognition -> transcript turn event)
 * runs natively in the browser without exposing any external API keys.
 */
export class BrowserWebSpeechVoiceAdapter implements VoiceSessionAdapter {
  public readonly providerLabel = 'Browser Web Speech Audio (External Token Pending)';
  public readonly isExternalProvider = false;
  public readonly isSpeechRecognitionSupported: boolean;

  private callbacks: VoiceAdapterCallbacks | null = null;
  private recognition: any = null;
  private mediaStream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private levelRafId: number | null = null;
  private isMuted = false;
  private isListeningActive = false;
  private isAiSpeaking = false;
  private accumulatedTranscript = '';
  private interimTranscript = '';
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    const SpeechRecognitionCtor =
      typeof window !== 'undefined'
        ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
        : null;
    this.isSpeechRecognitionSupported = Boolean(SpeechRecognitionCtor);
  }

  async connect(
    _sessionId: string,
    callbacks: VoiceAdapterCallbacks,
    _token?: VoiceSessionToken
  ): Promise<void> {
    this.callbacks = callbacks;
    this.callbacks.onStateChange('IDLE');

    // Initialize microphone audio level meter if permitted by browser
    if (typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
      try {
        this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioCtx) {
          this.audioContext = new AudioCtx();
          const source = this.audioContext.createMediaStreamSource(this.mediaStream);
          this.analyser = this.audioContext.createAnalyser();
          this.analyser.fftSize = 256;
          source.connect(this.analyser);
          this.startAudioLevelLoop();
        }
      } catch {
        this.callbacks.onError?.(
          'Microphone permission was denied or no microphone was detected. Please allow microphone access for spoken answers.'
        );
      }
    }

    // Initialize Web Speech API SpeechRecognition if supported
    const SpeechRecognitionCtor =
      typeof window !== 'undefined'
        ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
        : null;

    if (SpeechRecognitionCtor) {
      const recognition = new SpeechRecognitionCtor();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      recognition.onresult = (event: any) => {
        if (this.isMuted || this.isAiSpeaking) return;

        let finalChunk = '';
        let interimChunk = '';

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const res = event.results[i];
          if (res.isFinal) {
            finalChunk += res[0].transcript + ' ';
          } else {
            interimChunk += res[0].transcript;
          }
        }

        if (finalChunk.trim()) {
          this.accumulatedTranscript = `${this.accumulatedTranscript} ${finalChunk}`.trim();
        }
        this.interimTranscript = interimChunk.trim();

        const combined = `${this.accumulatedTranscript} ${this.interimTranscript}`.trim();
        if (combined) {
          this.callbacks?.onStateChange('CANDIDATE_SPEAKING');
          this.callbacks?.onTranscript({
            speaker: 'CANDIDATE',
            text: combined,
            isFinal: false,
          });

          // Reset natural pause timer (auto-finalize turn after 2.4s of silence following speech)
          if (this.silenceTimer) {
            clearTimeout(this.silenceTimer);
          }
          this.silenceTimer = setTimeout(() => {
            if (this.isListeningActive && (this.accumulatedTranscript || this.interimTranscript)) {
              this.finishCandidateTurn();
            }
          }, 2400);
        }
      };

      recognition.onerror = (event: any) => {
        // Any of these means no answer will ever be heard, so tell the candidate and let the
        // interview room open the typed-answer fallback. 'no-speech' and 'aborted' are normal
        // pauses and restarts, so they stay silent.
        const messages: Record<string, string> = {
          'not-allowed': 'Microphone permission was denied. Allow the microphone, or type your answers below.',
          'service-not-allowed':
            "This browser doesn't allow speech recognition. Use Chrome or Edge, or type your answers below.",
          network:
            "Speech recognition couldn't reach its service (common in Brave or offline). Use Chrome or Edge, or type your answers below.",
          'audio-capture': 'No microphone was found. Connect one, or type your answers below.',
          'language-not-supported': "Speech recognition doesn't support this language here. Type your answers below.",
        };
        const message = messages[event?.error];
        if (message) {
          this.callbacks?.onError?.(message);
        }
      };

      recognition.onend = () => {
        // Restart recognition automatically while still in listening mode
        if (this.isListeningActive && !this.isMuted && !this.isAiSpeaking) {
          try {
            recognition.start();
          } catch {
            // Ignore already-started state errors
          }
        }
      };

      this.recognition = recognition;
    }
  }

  async speakAiQuestion(text: string): Promise<void> {
    this.stopRecognitionInternal();
    this.isAiSpeaking = true;
    this.callbacks?.onStateChange('AI_SPEAKING');

    // Emit the AI transcript event so the interview room stores the AI turn in the database
    this.callbacks?.onTranscript({
      speaker: 'AI',
      text,
      isFinal: true,
    });

    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      await new Promise<void>((resolve) => {
        try {
          window.speechSynthesis.cancel();
          const utterance = new SpeechSynthesisUtterance(text);
          utterance.rate = 1.02;
          utterance.pitch = 1.0;

          // Estimate realistic fallback duration in case browser TTS voices don't fire onend
          const wordCount = text.split(/\s+/).length;
          const fallbackMs = Math.min(12000, Math.max(2200, wordCount * 320));
          const timer = setTimeout(() => {
            resolve();
          }, fallbackMs);

          utterance.onend = () => {
            clearTimeout(timer);
            resolve();
          };
          utterance.onerror = () => {
            clearTimeout(timer);
            resolve();
          };

          window.speechSynthesis.speak(utterance);
        } catch {
          resolve();
        }
      });
    } else {
      await new Promise((r) => setTimeout(r, 1200));
    }

    this.isAiSpeaking = false;
    if (!this.isMuted) {
      await this.startListening();
    } else {
      this.callbacks?.onStateChange('IDLE');
    }
  }

  async startListening(): Promise<void> {
    if (this.isAiSpeaking) {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
      this.isAiSpeaking = false;
    }

    this.accumulatedTranscript = '';
    this.interimTranscript = '';
    this.isListeningActive = true;

    if (!this.isMuted && this.recognition) {
      try {
        this.recognition.start();
      } catch {
        // Ignore if already running
      }
    }

    this.callbacks?.onStateChange('LISTENING');
  }

  finishCandidateTurn(): void {
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }

    const finalSpokenText = `${this.accumulatedTranscript} ${this.interimTranscript}`.trim();
    this.accumulatedTranscript = '';
    this.interimTranscript = '';
    this.stopRecognitionInternal();

    if (finalSpokenText) {
      this.callbacks?.onStateChange('PROCESSING');
      this.callbacks?.onTranscript({
        speaker: 'CANDIDATE',
        text: finalSpokenText,
        isFinal: true,
      });
    } else {
      this.callbacks?.onStateChange('LISTENING');
    }
  }

  setMuted(muted: boolean): void {
    this.isMuted = muted;
    if (this.mediaStream) {
      this.mediaStream.getAudioTracks().forEach((track) => {
        track.enabled = !muted;
      });
    }

    if (muted) {
      this.stopRecognitionInternal();
      if (!this.isAiSpeaking) {
        this.callbacks?.onStateChange('IDLE');
      }
    } else if (!this.isAiSpeaking) {
      void this.startListening();
    }
  }

  disconnect(): void {
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
    this.stopRecognitionInternal();
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    if (this.levelRafId !== null) {
      cancelAnimationFrame(this.levelRafId);
      this.levelRafId = null;
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((t) => t.stop());
      this.mediaStream = null;
    }
    if (this.audioContext) {
      void this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }
  }

  private stopRecognitionInternal(): void {
    this.isListeningActive = false;
    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch {
        // Ignore stop errors
      }
    }
  }

  private startAudioLevelLoop(): void {
    if (!this.analyser) return;
    const bufferLength = this.analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const tick = () => {
      if (!this.analyser) return;
      this.analyser.getByteFrequencyData(dataArray);
      let sum = 0;
      for (let i = 0; i < bufferLength; i++) {
        sum += dataArray[i];
      }
      const avg = sum / bufferLength;
      const normalized = this.isMuted ? 0 : Math.min(1, avg / 95);
      this.callbacks?.onAudioLevel?.(normalized);
      this.levelRafId = requestAnimationFrame(tick);
    };

    this.levelRafId = requestAnimationFrame(tick);
  }
}

export function createVoiceSessionAdapter(): VoiceSessionAdapter {
  return new BrowserWebSpeechVoiceAdapter();
}
