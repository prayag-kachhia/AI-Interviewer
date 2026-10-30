import { useState, useRef, useCallback, useEffect } from 'react';
import { getVoiceToken } from './api';
import { floatTo16BitPCM, base64Decode, PlaybackQueue } from './audio';

export type GeminiLiveState =
  | 'idle'
  | 'requesting_token'
  | 'connecting'
  | 'connected'
  | 'failed'
  | 'closed';

export interface TranscriptionEvent {
  speaker: 'candidate' | 'interviewer';
  text: string;
}

export interface UseGeminiLiveOptions {
  sessionId?: string;
  onTranscription?: (event: TranscriptionEvent) => void;
  onError?: (error: Error) => void;
  onFirstResponse?: (latencyMs: number) => void;
}

export interface UseGeminiLiveReturn {
  state: GeminiLiveState;
  connect: () => Promise<void>;
  disconnect: () => void;
  isMuted: boolean;
  setMuted: (muted: boolean) => void;
  audioLevel: number;
  partialCandidateText: string;
  partialAiText: string;
  errorMessage: string | null;
  onTranscription?: (event: TranscriptionEvent) => void;
}

/**
 * React hook managing real-time bidirectional audio and transcript streaming
 * with Gemini Live over WebSocket.
 *
 * Implements FR-12 (real-time voice), FR-14 (barge-in interruption), and NFR-01
 * (<5s response time target).
 */
export function useGeminiLive(options: UseGeminiLiveOptions): UseGeminiLiveReturn {
  const { sessionId, onTranscription, onError, onFirstResponse } = options;

  const [state, setState] = useState<GeminiLiveState>('idle');
  const [isMuted, setIsMutedState] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [partialCandidateText, setPartialCandidateText] = useState('');
  const [partialAiText, setPartialAiText] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // References to keep persistent audio and network instances across renders
  const wsRef = useRef<WebSocket | null>(null);
  const audioInCtxRef = useRef<AudioContext | null>(null);
  const audioOutCtxRef = useRef<AudioContext | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const playbackQueueRef = useRef<PlaybackQueue | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  const isMutedRef = useRef(false);
  const setupCompleteTimeRef = useRef<number | null>(null);
  const firstAudioLoggedRef = useRef(false);

  // Keep callback refs fresh
  const onTranscriptionRef = useRef(onTranscription);
  onTranscriptionRef.current = onTranscription;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const onFirstResponseRef = useRef(onFirstResponse);
  onFirstResponseRef.current = onFirstResponse;

  const cleanupAudioAndSocket = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    if (playbackQueueRef.current) {
      playbackQueueRef.current.stop();
      playbackQueueRef.current = null;
    }

    if (processorRef.current) {
      try {
        processorRef.current.disconnect();
      } catch {
        // ignore
      }
      processorRef.current = null;
    }

    if (analyserRef.current) {
      try {
        analyserRef.current.disconnect();
      } catch {
        // ignore
      }
      analyserRef.current = null;
    }

    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((track) => track.stop());
      micStreamRef.current = null;
    }

    if (audioInCtxRef.current && audioInCtxRef.current.state !== 'closed') {
      audioInCtxRef.current.close().catch(() => {});
      audioInCtxRef.current = null;
    }

    if (audioOutCtxRef.current && audioOutCtxRef.current.state !== 'closed') {
      audioOutCtxRef.current.close().catch(() => {});
      audioOutCtxRef.current = null;
    }

    if (wsRef.current) {
      const ws = wsRef.current;
      wsRef.current = null;
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
    }

    setAudioLevel(0);
  }, []);

  const disconnect = useCallback(() => {
    cleanupAudioAndSocket();
    setState('closed');
  }, [cleanupAudioAndSocket]);

  const setMuted = useCallback((muted: boolean) => {
    setIsMutedState(muted);
    isMutedRef.current = muted;
    if (muted) {
      setAudioLevel(0);
    }
  }, []);

  const connect = useCallback(async () => {
    if (!sessionId) {
      const err = new Error('No sessionId provided to useGeminiLive');
      setErrorMessage(err.message);
      setState('failed');
      onErrorRef.current?.(err);
      return;
    }

    cleanupAudioAndSocket();
    setErrorMessage(null);
    firstAudioLoggedRef.current = false;
    setupCompleteTimeRef.current = null;

    try {
      // 1. Fetch ephemeral voice token from backend
      setState('requesting_token');
      const token = await getVoiceToken(sessionId);
      if (!token) {
        throw new Error('Received empty voice token from server');
      }

      setState('connecting');

      // 2. Set up Web Audio output (24 kHz)
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const audioOutCtx = new AudioCtx({ sampleRate: 24000 });
      if (audioOutCtx.state === 'suspended') {
        await audioOutCtx.resume();
      }
      audioOutCtxRef.current = audioOutCtx;
      playbackQueueRef.current = new PlaybackQueue(audioOutCtx, 24000);

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
      micStreamRef.current = micStream;

      // 4. Open Gemini Live WebSocket
      const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained?access_token=${token}`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        // Send initial setup without model or systemInstruction (locked into token by backend)
        const setupMsg = {
          setup: {
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
          },
        };
        ws.send(JSON.stringify(setupMsg));
      };

      ws.onmessage = async (event: MessageEvent) => {
        try {
          const raw =
            event.data instanceof Blob ? await event.data.text() : (event.data as string);
          const response = JSON.parse(raw);

          // Handle setupComplete
          if (response.setupComplete) {
            setupCompleteTimeRef.current = performance.now();
            setState('connected');

            // Begin microphone audio streaming
            const audioInCtx = new AudioCtx({ sampleRate: 16000 });
            audioInCtxRef.current = audioInCtx;

            const sourceNode = audioInCtx.createMediaStreamSource(micStream);
            const analyser = audioInCtx.createAnalyser();
            analyser.fftSize = 256;
            analyserRef.current = analyser;

            const processor = audioInCtx.createScriptProcessor(4096, 1, 1);
            processorRef.current = processor;

            processor.onaudioprocess = (e) => {
              if (isMutedRef.current) return;
              if (ws.readyState !== WebSocket.OPEN) return;

              const inputFloats = e.inputBuffer.getChannelData(0);
              const pcmBuffer = floatTo16BitPCM(inputFloats);

              // Use base64 encoding from lib/audio
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
              if (isMutedRef.current) {
                setAudioLevel(0);
              } else {
                analyser.getByteFrequencyData(dataArray);
                let sum = 0;
                for (let i = 0; i < dataArray.length; i++) {
                  sum += dataArray[i];
                }
                const avg = sum / dataArray.length;
                setAudioLevel(Math.min(1, avg / 128));
              }
              animationFrameRef.current = requestAnimationFrame(updateLevel);
            };
            updateLevel();
            return;
          }

          const serverContent = response.serverContent;
          if (!serverContent) return;

          // 1. Interruption handling (FR-14)
          if (serverContent.interrupted) {
            playbackQueueRef.current?.stop();
            setPartialAiText('');
            return;
          }

          // 2. Transcriptions
          if (serverContent.inputTranscription?.text) {
            const text = serverContent.inputTranscription.text as string;
            setPartialCandidateText((prev) => prev + text);
            onTranscriptionRef.current?.({ speaker: 'candidate', text });
          }

          if (serverContent.outputTranscription?.text) {
            const text = serverContent.outputTranscription.text as string;
            setPartialAiText((prev) => prev + text);
            onTranscriptionRef.current?.({ speaker: 'interviewer', text });
          }

          // 3. Audio output playback
          if (serverContent.modelTurn?.parts) {
            for (const part of serverContent.modelTurn.parts) {
              if (part.inlineData?.data) {
                // Record first response latency (NFR-01)
                if (!firstAudioLoggedRef.current && setupCompleteTimeRef.current) {
                  const latency = performance.now() - setupCompleteTimeRef.current;
                  firstAudioLoggedRef.current = true;
                  console.info(`[NFR-01] First audio response latency: ${Math.round(latency)}ms`);
                  onFirstResponseRef.current?.(latency);
                }

                const audioBuffer = base64Decode(part.inlineData.data);
                playbackQueueRef.current?.enqueue(audioBuffer);
              }
            }
          }

          // 4. Turn completion: clear partial previews
          if (serverContent.turnComplete) {
            setPartialCandidateText('');
            setPartialAiText('');
          }
        } catch (msgErr) {
          console.error('Error handling Gemini Live message:', msgErr);
        }
      };

      ws.onerror = () => {
        const err = new Error('Gemini Live WebSocket connection failed');
        setErrorMessage(err.message);
        setState('failed');
        onErrorRef.current?.(err);
        cleanupAudioAndSocket();
      };

      ws.onclose = () => {
        setState((curr) => (curr === 'failed' ? 'failed' : 'closed'));
        cleanupAudioAndSocket();
      };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setErrorMessage(error.message);
      setState('failed');
      onErrorRef.current?.(error);
      cleanupAudioAndSocket();
    }
  }, [sessionId, cleanupAudioAndSocket]);

  // Clean up on component unmount
  useEffect(() => {
    return () => {
      cleanupAudioAndSocket();
    };
  }, [cleanupAudioAndSocket]);

  return {
    state,
    connect,
    disconnect,
    isMuted,
    setMuted,
    audioLevel,
    partialCandidateText,
    partialAiText,
    errorMessage,
    onTranscription: onTranscriptionRef.current,
  };
}
