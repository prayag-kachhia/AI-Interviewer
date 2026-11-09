import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router';
import { getSession, postTurn, endSession } from '../../lib/api';
import { ROLES } from '@interview/contracts';
import type { InterviewVoiceState, SessionStatus, TurnData } from '../../types';
import { interviewQuestionProvider } from '../../lib/questionProvider';
import {
  createVoiceSessionAdapter,
  type VoiceSessionAdapter,
  type VoiceTranscriptEvent,
} from '../../lib/voiceAdapter';

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

export function useInterview() {
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
  const [interviewComplete, setInterviewComplete] = useState(false);
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
  const roleRef = useRef<string>('software-engineer');
  const statusRef = useRef<SessionStatus>('LIVE');
  const initialQuestionTriggeredRef = useRef(false);
  const transcriptEndRef = useRef<HTMLDivElement>(null);

  turnsRef.current = turns;
  startedAtRef.current = startedAt;
  roleRef.current = role;
  statusRef.current = status;

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
      } catch (err: any) {
        setError(err.response?.data?.message || 'Failed to record interview turn.');
        return null;
      } finally {
        setSavingTurn(false);
      }
    },
    [sessionId]
  );

  const handleAdapterTranscript = useCallback(
    async (event: VoiceTranscriptEvent) => {
      if (statusRef.current !== 'LIVE') return;

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

        const updatedTranscript = turnsRef.current;
        const nextQuestion = interviewQuestionProvider.getNextQuestion(
          roleRef.current,
          updatedTranscript
        );

        if (nextQuestion && adapterRef.current) {
          await adapterRef.current.speakAiQuestion(nextQuestion);
        } else {
          setInterviewComplete(true);
          setVoiceState('IDLE');
        }
      }
    },
    [persistTurnToServer]
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

  // Connect VoiceSessionAdapter and start spoken interview when LIVE
  useEffect(() => {
    if (loading || notFound || status !== 'LIVE' || !sessionId || !startedAt) return;

    const adapter = createVoiceSessionAdapter();
    adapterRef.current = adapter;

    let cancelled = false;

    const startAudioSession = async () => {
      await adapter.connect(sessionId, {
        onStateChange: (nextState) => {
          if (!cancelled) setVoiceState(nextState);
        },
        onTranscript: (evt) => {
          if (!cancelled) {
            void handleAdapterTranscript(evt);
          }
        },
        onAudioLevel: (lvl) => {
          if (!cancelled) setAudioLevel(lvl);
        },
        onError: (msg) => {
          if (!cancelled) {
            setVoiceWarning(msg);
            setShowAccessibilityFallback(true);
          }
        },
      });

      if (!adapter.isSpeechRecognitionSupported) {
        setShowAccessibilityFallback(true);
      }

      if (cancelled) return;

      if (turnsRef.current.length === 0 && !initialQuestionTriggeredRef.current) {
        initialQuestionTriggeredRef.current = true;
        const firstQuestion = interviewQuestionProvider.getInitialQuestion(roleRef.current);
        await adapter.speakAiQuestion(firstQuestion);
      } else {
        const nextQ = interviewQuestionProvider.getNextQuestion(
          roleRef.current,
          turnsRef.current
        );
        if (!nextQ) {
          setInterviewComplete(true);
        } else {
          await adapter.startListening();
        }
      }
    };

    void startAudioSession();

    return () => {
      cancelled = true;
      adapter.disconnect();
      adapterRef.current = null;
    };
  }, [loading, notFound, status, sessionId, startedAt, handleAdapterTranscript]);

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
    if (liveCandidateSpeech.trim()) {
      adapterRef.current?.finishCandidateTurn();
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
    await handleAdapterTranscript({
      speaker: 'CANDIDATE',
      text: spokenText,
      isFinal: true,
    });
  };

  const handleEndInterview = async () => {
    if (!sessionId || ending) return;
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
      setEnding(false);
    }
  };

  const isAiSpeaking = voiceState === 'AI_SPEAKING';
  const isCandidateSpeaking = voiceState === 'CANDIDATE_SPEAKING' || Boolean(liveCandidateSpeech);
  const isListening = voiceState === 'LISTENING' && !isCandidateSpeaking && !isMuted;

  return {
    sessionId,
    roleLabel,
    status,
    startedAt,
    endedAt,
    turns,
    elapsed,
    loading,
    notFound,
    error,
    voiceWarning,
    isAiSpeaking,
    isCandidateSpeaking,
    isListening,
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
