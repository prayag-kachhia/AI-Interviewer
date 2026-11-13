import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router';
import axios from 'axios';
import { getSession, postTurn, postNextQuestion, endSession } from '../../lib/api';
import { ROLES } from '@interview/contracts';
import type { InterviewVoiceState, SessionStatus, TurnData, TurnSpeaker } from '../../types';
import {
  BrowserWebSpeechVoiceAdapter,
  type VoiceSessionAdapter,
  type VoiceTranscriptEvent,
} from '../../lib/voiceAdapter';
import { GeminiLiveVoiceAdapter } from '../../lib/geminiLiveAdapter';

function getErrorMessage(err: unknown, fallback: string): string {
  if (axios.isAxiosError<{ message?: unknown }>(err)) {
    const serverMsg = err.response?.data?.message;
    if (typeof serverMsg === 'string' && serverMsg.trim()) return serverMsg;
  }
  if (err instanceof Error && err.message.trim()) {
    return err.message;
  }
  return fallback;
}

function computeElapsedSeconds(startedAtIso: string): number {
  const raw = (Date.now() - new Date(startedAtIso).getTime()) / 1000;
  return Math.max(0, Math.floor(raw * 10) / 10);
}

export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const mm = Math.floor(s / 60)
    .toString()
    .padStart(2, '0');
  const ss = (s % 60).toString().padStart(2, '0');
  return `${mm}:${ss}`;
}

export const DEFAULT_TIME_LIMIT_MIN = 15;

export function useInterview(timeLimitMin = DEFAULT_TIME_LIMIT_MIN) {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [startedAt, setStartedAt] = useState<string | null>(null);
  const [endedAt, setEndedAt] = useState<string | null>(null);
  const [role, setRole] = useState<string>('software-engineer');
  const [status, setStatus] = useState<SessionStatus>('LIVE');
  const [turns, setTurns] = useState<TurnData[]>([]);
  const [voiceState, setVoiceState] = useState<InterviewVoiceState>('IDLE');
  const [isMuted, setIsMuted] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [liveCandidateSpeech, setLiveCandidateSpeech] = useState('');
  const [currentAiQuestion, setCurrentAiQuestion] = useState('');
  const interviewComplete = status === 'ENDED';
  const [savingTurn, setSavingTurn] = useState(false);
  const [ending, setEnding] = useState(false);
  const [error, setError] = useState('');
  const [voiceWarning, setVoiceWarning] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [showAccessibilityFallback, setShowAccessibilityFallback] = useState(false);
  const [fallbackSpeechInput, setFallbackSpeechInput] = useState('');

  const adapterRef = useRef<VoiceSessionAdapter | null>(null);
  const turnsRef = useRef<TurnData[]>([]);
  const startedAtRef = useRef<string | null>(null);
  const statusRef = useRef<SessionStatus>('LIVE');
  const isMutedRef = useRef(false);
  const liveSpeakerRef = useRef<TurnSpeaker | null>(null);
  const initialQuestionTriggeredRef = useRef(false);
  const endingRef = useRef(false);
  const hasAutoEndedRef = useRef(false);
  const transcriptEndRef = useRef<HTMLDivElement>(null);

  turnsRef.current = turns;
  startedAtRef.current = startedAt;
  statusRef.current = status;
  isMutedRef.current = isMuted;

  const roleLabel = useMemo(() => {
    const match = ROLES.find((r) => r.id === role);
    return match ? match.label : role.replace(/-/g, ' ');
  }, [role]);

  const persistTurnToServer = useCallback(
    async (speaker: 'AI' | 'CANDIDATE', text: string): Promise<TurnData | null> => {
      if (!sessionId || !startedAtRef.current || statusRef.current !== 'LIVE') {
        return null;
      }
      const trimmed = text.trim();
      if (!trimmed) return null;

      setSavingTurn(true);
      setError('');
      try {
        const res = await postTurn(sessionId, speaker, trimmed);
        if (res.success && res.data) {
          const savedTurn = res.data;
          setTurns((prev) => {
            const next = [...prev, savedTurn];
            turnsRef.current = next;
            return next;
          });
          return savedTurn;
        } else {
          setError(res.message || 'Could not save transcript turn.');
          return null;
        }
      } catch (err: unknown) {
        setError(getErrorMessage(err, 'Failed to record interview turn.'));
        return null;
      } finally {
        setSavingTurn(false);
      }
    },
    [sessionId]
  );

  // Ask PK-3 for the next AI question (server saves the AI turn before returning it).
  const requestNextQuestion = useCallback(async () => {
    if (!sessionId || !startedAtRef.current || statusRef.current !== 'LIVE') {
      return;
    }

    setError('');
    try {
      const res = await postNextQuestion(sessionId);
      if (statusRef.current !== 'LIVE') return;

      if (res.success && res.data) {
        const aiTurn = res.data;
        setCurrentAiQuestion(aiTurn.text);
        setTurns((prev) => {
          if (prev.some((turn) => turn.id === aiTurn.id)) {
            return prev;
          }
          const next = [...prev, aiTurn];
          turnsRef.current = next;
          return next;
        });

        if (adapterRef.current instanceof BrowserWebSpeechVoiceAdapter) {
          await adapterRef.current.speakAiQuestion(aiTurn.text);
        }
      } else {
        setError(res.message || 'Could not generate the next interview question.');
        setShowAccessibilityFallback(true);
      }
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to generate next interview question.'));
      setShowAccessibilityFallback(true);
    }
  }, [sessionId]);

  const handleAdapterTranscript = useCallback(
    async (event: VoiceTranscriptEvent) => {
      if (statusRef.current !== 'LIVE') return;

      // Gemini Live emits incremental text chunks; accumulate captions cleanly while VI-2 is separate.
      if (adapterRef.current?.isExternalProvider && !event.isFinal) {
        if (event.speaker === 'AI') {
          if (liveSpeakerRef.current !== 'AI') {
            liveSpeakerRef.current = 'AI';
            setLiveCandidateSpeech('');
            setCurrentAiQuestion(event.text);
          } else {
            setCurrentAiQuestion((prev) => `${prev}${event.text}`);
          }
          return;
        }

        if (event.speaker === 'CANDIDATE') {
          if (liveSpeakerRef.current !== 'CANDIDATE') {
            liveSpeakerRef.current = 'CANDIDATE';
            setLiveCandidateSpeech(event.text);
          } else {
            setLiveCandidateSpeech((prev) => `${prev}${event.text}`);
          }
          return;
        }
      }

      if (event.speaker === 'AI' && event.isFinal) {
        setCurrentAiQuestion(event.text);
        await persistTurnToServer('AI', event.text);
        return;
      }

      if (event.speaker === 'CANDIDATE') {
        if (!event.isFinal) {
          setLiveCandidateSpeech(event.text);
          return;
        }

        setLiveCandidateSpeech('');
        const savedCandidateTurn = await persistTurnToServer('CANDIDATE', event.text);
        if (!savedCandidateTurn || statusRef.current !== 'LIVE') return;

        await requestNextQuestion();
      }
    },
    [persistTurnToServer, requestNextQuestion]
  );

  // Load session & verify ownership
  useEffect(() => {
    if (!sessionId) return;
    setLoading(true);
    getSession(sessionId)
      .then((res) => {
        if (res.success && res.data) {
          setStartedAt(res.data.startedAt);
          setEndedAt(res.data.endedAt ?? null);
          setRole(res.data.role);
          setStatus(res.data.status);
          const existingTurns = res.data.turns ?? [];
          setTurns(existingTurns);
          turnsRef.current = existingTurns;

          const lastAi = [...existingTurns].reverse().find((t) => t.speaker === 'AI');
          if (lastAi) {
            setCurrentAiQuestion(lastAi.text);
          }
          setElapsed(computeElapsedSeconds(res.data.startedAt));
        } else {
          setNotFound(true);
        }
      })
      .catch(() => {
        setNotFound(true);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [sessionId]);

  // Connect Gemini Live first, automatically falling back to Browser Web Speech + /next-question.
  useEffect(() => {
    if (loading || notFound || status !== 'LIVE' || !sessionId || !startedAt) return;

    let cancelled = false;
    let fallbackStarted = false;
    let activeAdapter: VoiceSessionAdapter | null = null;

    const startFallback = async (reason: string) => {
      if (cancelled || fallbackStarted) return;
      fallbackStarted = true;

      const failedAdapter = activeAdapter;
      const fallbackAdapter = new BrowserWebSpeechVoiceAdapter();
      // Swap activeAdapter before disconnecting Live so its cleanup IDLE state does not overwrite fallback.
      activeAdapter = fallbackAdapter;
      adapterRef.current = fallbackAdapter;
      liveSpeakerRef.current = null;
      setLiveCandidateSpeech('');
      setAudioLevel(0);
      failedAdapter?.disconnect();

      setVoiceWarning(`Live voice unavailable (${reason}). Switched to browser speech fallback.`);

      await fallbackAdapter.connect(sessionId, {
        onStateChange: (nextState) => {
          if (!cancelled && activeAdapter === fallbackAdapter) setVoiceState(nextState);
        },
        onTranscript: (evt) => {
          if (!cancelled && activeAdapter === fallbackAdapter) {
            void handleAdapterTranscript(evt);
          }
        },
        onAudioLevel: (lvl) => {
          if (!cancelled && activeAdapter === fallbackAdapter) setAudioLevel(lvl);
        },
        onError: (msg) => {
          if (!cancelled && activeAdapter === fallbackAdapter) {
            setVoiceWarning(msg);
            setShowAccessibilityFallback(true);
          }
        },
      });

      if (cancelled || activeAdapter !== fallbackAdapter) return;

      if (isMutedRef.current) {
        fallbackAdapter.setMuted(true);
      }

      if (!fallbackAdapter.isSpeechRecognitionSupported) {
        setShowAccessibilityFallback(true);
      }

      const lastTurn = turnsRef.current[turnsRef.current.length - 1];
      if (lastTurn?.speaker === 'AI') {
        setCurrentAiQuestion(lastTurn.text);
        await fallbackAdapter.speakAiQuestion(lastTurn.text);
      } else {
        await requestNextQuestion();
      }
    };

    const startAudioSession = async () => {
      const liveAdapter = new GeminiLiveVoiceAdapter();
      activeAdapter = liveAdapter;
      adapterRef.current = liveAdapter;

      try {
        await liveAdapter.connect(sessionId, {
          onStateChange: (nextState) => {
            if (cancelled || activeAdapter !== liveAdapter) return;
            setVoiceState(nextState);
            if (
              nextState === 'LISTENING' &&
              turnsRef.current.length === 0 &&
              !initialQuestionTriggeredRef.current
            ) {
              initialQuestionTriggeredRef.current = true;
              liveAdapter.sendText(
                'The candidate is ready. Please introduce yourself briefly and ask your first interview question.'
              );
            }
          },
          onTranscript: (evt) => {
            if (!cancelled && activeAdapter === liveAdapter) {
              void handleAdapterTranscript(evt);
            }
          },
          onAudioLevel: (lvl) => {
            if (!cancelled && activeAdapter === liveAdapter) setAudioLevel(lvl);
          },
          onError: (msg) => {
            if (!cancelled && activeAdapter === liveAdapter) {
              void startFallback(msg);
            }
          },
        });
      } catch (err: unknown) {
        if (!cancelled && activeAdapter === liveAdapter) {
          await startFallback(getErrorMessage(err, 'Live connection failed'));
        }
      }
    };

    void startAudioSession();

    return () => {
      cancelled = true;
      activeAdapter?.disconnect();
      adapterRef.current = null;
    };
  }, [loading, notFound, status, sessionId, startedAt, handleAdapterTranscript, requestNextQuestion]);

  // Live elapsed timer
  useEffect(() => {
    if (!startedAt || status !== 'LIVE') return;
    const interval = setInterval(() => {
      setElapsed(computeElapsedSeconds(startedAt));
    }, 500);
    return () => clearInterval(interval);
  }, [startedAt, status]);

  // Auto-scroll transcript list
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns, liveCandidateSpeech]);

  const handleToggleMute = () => {
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);
    adapterRef.current?.setMuted(nextMuted);
  };

  const handleFinishSpeaking = () => {
    if (liveCandidateSpeech.trim() && adapterRef.current instanceof BrowserWebSpeechVoiceAdapter) {
      adapterRef.current.finishCandidateTurn();
    }
  };

  const handleReplayAiQuestion = () => {
    if (!currentAiQuestion || typeof window === 'undefined' || !('speechSynthesis' in window)) {
      return;
    }
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(currentAiQuestion);
      utterance.rate = 1.02;
      setVoiceState('AI_SPEAKING');
      utterance.onend = () => {
        setVoiceState(isMuted ? 'IDLE' : 'LISTENING');
      };
      utterance.onerror = () => {
        setVoiceState(isMuted ? 'IDLE' : 'LISTENING');
      };
      window.speechSynthesis.speak(utterance);
    } catch {
      // Ignore synthesis errors
    }
  };

  const handleFallbackSpokenSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const spokenText = fallbackSpeechInput.trim();
    if (!spokenText || savingTurn || status !== 'LIVE') return;
    setFallbackSpeechInput('');
    if (adapterRef.current?.isExternalProvider) {
      adapterRef.current.sendText(spokenText);
      return;
    }
    await handleAdapterTranscript({
      speaker: 'CANDIDATE',
      text: spokenText,
      isFinal: true,
    });
  };

  const handleEndInterview = useCallback(async () => {
    if (!sessionId || endingRef.current) return;
    endingRef.current = true;
    setEnding(true);
    setError('');
    try {
      adapterRef.current?.disconnect();
      const res = await endSession(sessionId);
      if (res.success && res.data) {
        setStatus('ENDED');
        setEndedAt(res.data.endedAt ?? new Date().toISOString());
        setVoiceState('IDLE');
        navigate(`/interview/${sessionId}/feedback`);
      } else {
        setError(res.message || 'Failed to end the interview session.');
      }
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to end the interview session.');
    } finally {
      endingRef.current = false;
      setEnding(false);
    }
  }, [sessionId, navigate]);

  const remainingSeconds = Math.max(0, timeLimitMin * 60 - elapsed);

  useEffect(() => {
    if (status !== 'LIVE' || !startedAt || hasAutoEndedRef.current) return;
    if (remainingSeconds === 0) {
      hasAutoEndedRef.current = true;
      void handleEndInterview();
    }
  }, [status, startedAt, remainingSeconds, handleEndInterview]);

  const isAiSpeaking = voiceState === 'AI_SPEAKING';
  const isCandidateSpeaking = voiceState === 'CANDIDATE_SPEAKING' || Boolean(liveCandidateSpeech);
  const isListening = voiceState === 'LISTENING' && !isCandidateSpeaking && !isMuted;
  const isReconnecting = voiceState === 'RECONNECTING';

  return {
    sessionId,
    roleLabel,
    status,
    startedAt,
    endedAt,
    turns,
    elapsed,
    timeLimitMin,
    remainingSeconds,
    loading,
    notFound,
    error,
    voiceWarning,
    isAiSpeaking,
    isCandidateSpeaking,
    isListening,
    isReconnecting,
    isMuted,
    audioLevel,
    liveCandidateSpeech,
    currentAiQuestion,
    interviewComplete,
    savingTurn,
    ending,
    showAccessibilityFallback,
    setShowAccessibilityFallback,
    fallbackSpeechInput,
    setFallbackSpeechInput,
    transcriptEndRef,
    handleToggleMute,
    handleFinishSpeaking,
    handleReplayAiQuestion,
    handleFallbackSpokenSubmit,
    handleEndInterview,
    navigate,
  };
}
