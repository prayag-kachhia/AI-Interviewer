import { getVoiceToken } from './api';
import { base64Decode, floatTo16BitPCM, PlaybackQueue } from './audio';
import type {
  VoiceAdapterCallbacks,
  VoiceSessionAdapter,
  VoiceSessionToken,
} from './voiceAdapter';

/**
 * Gemini Live voice session adapter implementing VoiceSessionAdapter.
 * Holds a bidirectional streaming audio conversation with gemini-3.8-live over WebSockets.
 */
export class GeminiLiveVoiceAdapter implements VoiceSessionAdapter {
  public readonly providerLabel = 'Google Gemini Live';
  public readonly isExternalProvider = true;
  public readonly isSpeechRecognitionSupported = true;

  private sessionId: string | null = null;
  private callbacks: VoiceAdapterCallbacks | null = null;
  private ws: WebSocket | null = null;

  // Web Audio components
  private audioInCtx: AudioContext | null = null;
  private audioOutCtx: AudioContext | null = null;
  private micStream: MediaStream | null = null;
  private processor: ScriptProcessorNode | null = null;
  private analyser: AnalyserNode | null = null;
  private playbackQueue: PlaybackQueue | null = null;
  private animationFrameId: number | null = null;

  // State
  private isMuted = false;
  private isDeliberateClose = false;
  private resumptionHandle: string | null = null;
  private reconnectAttempts = 0;

  /**
   * Connect to Gemini Live for the given session.
   */
  async connect(
    sessionId: string,
    callbacks: VoiceAdapterCallbacks,
    _token?: VoiceSessionToken
  ): Promise<void> {
    this.sessionId = sessionId;
    this.callbacks = callbacks;
    this.isDeliberateClose = false;

    // Read stored resumption handle from sessionStorage on connect
    if (!this.resumptionHandle && this.sessionId) {
      try {
        const stored = sessionStorage.getItem(`gemini_resumption_${this.sessionId}`);
        if (stored) {
          this.resumptionHandle = stored;
        }
      } catch {
        // ignore storage access errors
      }
    }

    await this.startConnection();
  }

  private async startConnection(): Promise<void> {
    if (!this.sessionId) {
      this.fail('No sessionId provided to GeminiLiveVoiceAdapter');
      return;
    }

    this.callbacks?.onStateChange('IDLE');

    try {
      // 1. Fetch ephemeral voice token from backend
      const token = await getVoiceToken(this.sessionId);
      if (!token) {
        throw new Error('Received empty voice token from server');
      }

      // 2. Set up Web Audio output (24 kHz)
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const audioOutCtx = new AudioCtx({ sampleRate: 24000 });
      if (audioOutCtx.state === 'suspended') {
        await audioOutCtx.resume();
      }
      this.audioOutCtx = audioOutCtx;
      this.playbackQueue = new PlaybackQueue(audioOutCtx, 24000);

      // 3. Request user microphone (16 kHz, mono, echoCancellation)
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

      // 4. Open Gemini Live WebSocket
      const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained?access_token=${token}`;
      const ws = new WebSocket(wsUrl);
      this.ws = ws;

      ws.onopen = () => {
        // Send initial setup without model or systemInstruction (locked into token by backend)
        const setup: Record<string, unknown> = {
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: {
                  voiceName: 'Puck',
                },
              },
            },
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
        };

        // If resuming an existing session, supply the stored resumption handle
        if (this.resumptionHandle) {
          setup.sessionResumption = {
            handle: this.resumptionHandle,
          };
        }

        const setupMsg = { setup };
        ws.send(JSON.stringify(setupMsg));
      };

      ws.onmessage = async (event: MessageEvent) => {
        try {
          const raw =
            event.data instanceof Blob ? await event.data.text() : (event.data as string);
          const response = JSON.parse(raw);

          // Handle sessionResumptionUpdate
          const resumptionUpdate = response.sessionResumptionUpdate;
          if (resumptionUpdate?.newHandle && resumptionUpdate.resumable !== false) {
            this.resumptionHandle = resumptionUpdate.newHandle;
            if (this.sessionId) {
              try {
                sessionStorage.setItem(
                  `gemini_resumption_${this.sessionId}`,
                  resumptionUpdate.newHandle
                );
              } catch {
                // ignore storage errors
              }
            }
          }

          // Handle top-level GoAway signal from Gemini Live
          if (response.goAway) {
            console.info('[geminiLiveAdapter] Received GoAway from server, reconnecting...');
            this.triggerReconnect();
            return;
          }

          // Handle setupComplete
          if (response.setupComplete) {
            this.reconnectAttempts = 0; // Reset counter on success
            this.callbacks?.onStateChange('LISTENING');

            // Begin microphone audio streaming
            const audioInCtx = new AudioCtx({ sampleRate: 16000 });
            this.audioInCtx = audioInCtx;

            const sourceNode = audioInCtx.createMediaStreamSource(micStream);
            const analyser = audioInCtx.createAnalyser();
            analyser.fftSize = 256;
            this.analyser = analyser;

            const processor = audioInCtx.createScriptProcessor(4096, 1, 1);
            this.processor = processor;

            processor.onaudioprocess = (e) => {
              if (this.isMuted) return;
              if (ws.readyState !== WebSocket.OPEN) return;

              const inputFloats = e.inputBuffer.getChannelData(0);
              const pcmBuffer = floatTo16BitPCM(inputFloats);

              const bytes = new Uint8Array(pcmBuffer);
              let binary = '';
              for (let i = 0; i < bytes.byteLength; i++) {
                binary += String.fromCharCode(bytes[i]);
              }
              const base64Data = btoa(binary);

              const audioMsg = {
                realtimeInput: {
                  audio: {
                    data: base64Data,
                    mimeType: 'audio/pcm;rate=16000',
                  },
                },
              };
              ws.send(JSON.stringify(audioMsg));
            };

            sourceNode.connect(analyser);
            analyser.connect(processor);
            processor.connect(audioInCtx.destination);

            // Audio level monitor loop
            const dataArray = new Uint8Array(analyser.frequencyBinCount);
            const updateLevel = () => {
              if (this.isMuted) {
                this.callbacks?.onAudioLevel?.(0);
              } else {
                analyser.getByteFrequencyData(dataArray);
                let sum = 0;
                for (let i = 0; i < dataArray.length; i++) {
                  sum += dataArray[i];
                }
                const avg = sum / dataArray.length;
                this.callbacks?.onAudioLevel?.(Math.min(1, avg / 128));
              }
              this.animationFrameId = requestAnimationFrame(updateLevel);
            };
            updateLevel();
            return;
          }

          const serverContent = response.serverContent;
          if (!serverContent) return;

          // 1. Interruption handling (FR-14)
          if (serverContent.interrupted) {
            this.playbackQueue?.stop();
            this.callbacks?.onStateChange('LISTENING');
            return;
          }

          // 2. Transcriptions
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

          // 3. Audio output playback
          if (serverContent.modelTurn?.parts) {
            this.callbacks?.onStateChange('AI_SPEAKING');
            for (const part of serverContent.modelTurn.parts) {
              if (part.inlineData?.data) {
                const audioBuffer = base64Decode(part.inlineData.data);
                this.playbackQueue?.enqueue(audioBuffer);
              }
            }
          }

          // 4. Turn completion
          if (serverContent.turnComplete) {
            this.callbacks?.onStateChange('LISTENING');
          }
        } catch (msgErr) {
          console.error('Error handling Gemini Live message in adapter:', msgErr);
        }
      };

      ws.onerror = () => {
        if (this.isDeliberateClose) return;
        // On connection errors, attempt resumption if handle exists, otherwise fail
        if (this.resumptionHandle && this.reconnectAttempts < 3) {
          this.triggerReconnect();
        } else {
          this.fail('Gemini Live WebSocket connection failed');
        }
      };

      ws.onclose = () => {
        if (this.isDeliberateClose) {
          this.callbacks?.onStateChange('IDLE');
          this.cleanupAudioAndSocket();
        } else if (this.resumptionHandle && this.reconnectAttempts < 3) {
          this.triggerReconnect();
        } else {
          this.fail(
            this.reconnectAttempts >= 3
              ? 'Reconnection failed after 3 attempts'
              : 'Gemini Live WebSocket disconnected unexpectedly'
          );
        }
      };
    } catch (err) {
      if (this.isDeliberateClose) return;
      if (this.resumptionHandle && this.reconnectAttempts < 3) {
        this.triggerReconnect();
      } else {
        const errorMsg = err instanceof Error ? err.message : String(err);
        this.fail(errorMsg);
      }
    }
  }

  private triggerReconnect(): void {
    if (this.isDeliberateClose) return;

    if (!this.resumptionHandle || this.reconnectAttempts >= 3) {
      this.fail('Reconnection failed after 3 attempts');
      return;
    }

    this.reconnectAttempts += 1;
    console.info(`[geminiLiveAdapter] Reconnecting session (attempt ${this.reconnectAttempts}/3)...`);
    this.cleanupAudioAndSocket();
    void this.startConnection();
  }

  /**
   * Unified failure path: logs error, sets state to ERROR, invokes callback, and cleans up.
   */
  private fail(message: string): void {
    this.callbacks?.onError?.(message);
    this.callbacks?.onStateChange('ERROR');
    this.cleanupAudioAndSocket();
  }

  /**
   * Sends a text cue into the Gemini Live session (used by thinking prompts and time cues).
   */
  sendText(text: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('[geminiLiveAdapter] Cannot sendText: WebSocket is not open');
      return;
    }

    const cueMsg = {
      clientContent: {
        turns: [
          {
            role: 'user',
            parts: [{ text }],
          },
        ],
        turnComplete: true,
      },
    };
    this.ws.send(JSON.stringify(cueMsg));
  }

  /**
   * Mutes or unmutes the microphone streaming.
   */
  setMuted(muted: boolean): void {
    this.isMuted = muted;
    if (muted) {
      this.callbacks?.onAudioLevel?.(0);
    }
  }

  /**
   * Cleanly closes the live voice session and wipes stored handles.
   */
  disconnect(): void {
    this.isDeliberateClose = true;
    this.reconnectAttempts = 0;
    this.resumptionHandle = null;

    if (this.sessionId) {
      try {
        sessionStorage.removeItem(`gemini_resumption_${this.sessionId}`);
      } catch {
        // ignore
      }
    }

    this.cleanupAudioAndSocket();
    this.callbacks?.onStateChange('IDLE');
  }

  private cleanupAudioAndSocket(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    if (this.playbackQueue) {
      this.playbackQueue.stop();
      this.playbackQueue = null;
    }

    if (this.processor) {
      try {
        this.processor.disconnect();
      } catch {
        // ignore
      }
      this.processor = null;
    }

    if (this.analyser) {
      try {
        this.analyser.disconnect();
      } catch {
        // ignore
      }
      this.analyser = null;
    }

    if (this.micStream) {
      this.micStream.getTracks().forEach((track) => track.stop());
      this.micStream = null;
    }

    if (this.audioInCtx && this.audioInCtx.state !== 'closed') {
      this.audioInCtx.close().catch(() => {});
      this.audioInCtx = null;
    }

    if (this.audioOutCtx && this.audioOutCtx.state !== 'closed') {
      this.audioOutCtx.close().catch(() => {});
      this.audioOutCtx = null;
    }

    if (this.ws) {
      const socket = this.ws;
      this.ws = null;
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close();
      }
    }

    this.callbacks?.onAudioLevel?.(0);
  }

  // Legacy stubs for VoiceSessionAdapter room compatibility until VI-8 rewires progression
  async speakAiQuestion(_text: string): Promise<void> {
    return Promise.resolve();
  }

  async startListening(): Promise<void> {
    return Promise.resolve();
  }

  finishCandidateTurn(): void {
    // Gemini Live handles end of turn automatically via voice activity detection.
  }
}
