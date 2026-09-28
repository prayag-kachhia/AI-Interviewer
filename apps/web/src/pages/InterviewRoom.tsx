import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  Mic,
  MicOff,
  Volume2,
  PhoneOff,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Radio,
  RotateCcw,
  ChevronDown,
  ChevronUp,
  Check,
  Sparkles,
  ArrowLeft,
} from 'lucide-react';
import { getSession, postTurn, endSession } from '../lib/api';
import { ROLES } from '@interview/contracts';
import {
  type InterviewVoiceState,
  type SessionStatus,
  type TurnData,
} from '../types';
import { interviewQuestionProvider } from '../lib/questionProvider';
import {
  createVoiceSessionAdapter,
  type VoiceSessionAdapter,
  type VoiceTranscriptEvent,
} from '../lib/voiceAdapter';

/**
 * Floors elapsed seconds to 0.1s precision so legitimate live turns never
 * exceed server-side `(Date.now() - session.startedAt) / 1000` due to rounding.
 */
function computeElapsedSeconds(startedAtIso: string): number {
  const raw = (Date.now() - new Date(startedAtIso).getTime()) / 1000;
  return Math.max(0, Math.floor(raw * 10) / 10);
}

function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const mm = Math.floor(s / 60)
    .toString()
    .padStart(2, '0');
  const ss = (s % 60).toString().padStart(2, '0');
  return `${mm}:${ss}`;
}

export const InterviewRoom: React.FC = () => {
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
  const [showTranscriptPanel, setShowTranscriptPanel] = useState(true);
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

  // Persist a turn to POST /api/sessions/:id/turns
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
        const timestampSec = computeElapsedSeconds(startedAtRef.current);
        const res = await postTurn(sessionId, speaker, trimmed, timestampSec);
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

  // Handle transcript events emitted by VoiceSessionAdapter
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

        // Finalized candidate spoken turn -> store in DB -> trigger next AI question
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

      // If no turns have been asked yet, ask the initial role question
      if (turnsRef.current.length === 0 && !initialQuestionTriggeredRef.current) {
        initialQuestionTriggeredRef.current = true;
        const firstQuestion = interviewQuestionProvider.getInitialQuestion(roleRef.current);
        await adapter.speakAiQuestion(firstQuestion);
      } else {
        // Resuming an existing live session
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

  if (loading) {
    return (
      <div className="container page-wrapper" style={{ textAlign: 'center', paddingTop: '10rem' }}>
        <Loader2
          size={40}
          color="var(--primary-color)"
          style={{ animation: 'spin 1s linear infinite', marginBottom: '1rem' }}
        />
        <p style={{ fontWeight: 500 }}>Connecting to your interview room...</p>
        <style>{`@keyframes spin { 100% { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="container page-wrapper" style={{ maxWidth: '600px', textAlign: 'center' }}>
        <div className="card">
          <div className="alert alert-error" style={{ justifyContent: 'center' }}>
            <AlertCircle size={20} />
            <span>Interview session not found or inaccessible.</span>
          </div>
          <p style={{ marginBottom: '1.75rem' }}>
            This session may not exist or belongs to a different candidate account.
          </p>
          <Link className="btn btn-primary" to="/interview/new">
            Start a New Interview
          </Link>
        </div>
      </div>
    );
  }

  const isAiSpeaking = voiceState === 'AI_SPEAKING';
  const isCandidateSpeaking = voiceState === 'CANDIDATE_SPEAKING' || Boolean(liveCandidateSpeech);
  const isListening = voiceState === 'LISTENING' && !isCandidateSpeaking && !isMuted;

  return (
    <div className="container page-wrapper" style={{ maxWidth: '920px' }}>
      <style>{`
        @keyframes spin { 100% { transform: rotate(360deg); } }
        @keyframes pulseRing {
          0% { transform: scale(0.95); opacity: 0.75; }
          50% { transform: scale(1.12); opacity: 0.35; }
          100% { transform: scale(0.95); opacity: 0.75; }
        }
        @keyframes liveDot {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.35; }
        }
      `}</style>

      {/* Top Header Bar */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '1rem',
          marginBottom: '1.5rem',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.35rem' }}>
            <h2 style={{ margin: 0, fontSize: '1.65rem', textTransform: 'capitalize' }}>
              AI Interview — {roleLabel}
            </h2>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.4rem',
                padding: '0.25rem 0.75rem',
                borderRadius: '9999px',
                fontSize: '0.78rem',
                fontWeight: 600,
                background: status === 'LIVE' ? 'var(--success-bg)' : 'var(--border-color)',
                color: status === 'LIVE' ? 'var(--success-text)' : 'var(--text-muted)',
              }}
            >
              <span
                style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  background: status === 'LIVE' ? 'var(--success-color)' : 'var(--text-muted)',
                  animation: status === 'LIVE' ? 'liveDot 1.5s infinite' : 'none',
                }}
              />
              {status === 'LIVE' ? `LIVE • ${formatClock(elapsed)}` : 'ENDED'}
            </span>
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: 0 }}>
            Session ID: <code>{sessionId}</code> • {turns.length} transcript{' '}
            {turns.length === 1 ? 'turn' : 'turns'} recorded
          </p>
        </div>

        {status === 'LIVE' ? (
          <button
            type="button"
            className="btn"
            onClick={handleEndInterview}
            disabled={ending}
            style={{
              backgroundColor: 'var(--error-color)',
              color: '#ffffff',
              padding: '0.65rem 1.35rem',
            }}
          >
            {ending ? (
              <>
                <Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} />
                Ending Session...
              </>
            ) : (
              <>
                <PhoneOff size={18} />
                End Interview
              </>
            )}
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-outline"
            onClick={() => navigate('/dashboard')}
            style={{ padding: '0.6rem 1.2rem' }}
          >
            <ArrowLeft size={18} />
            Back to Dashboard
          </button>
        )}
      </div>

      {/* Error Banner */}
      {error && (
        <div className="alert alert-error" role="alert" style={{ marginBottom: '1.25rem' }}>
          <AlertCircle size={20} />
          <span>{error}</span>
        </div>
      )}

      {/* Voice / Microphone Advisory */}
      {voiceWarning && status === 'LIVE' && (
        <div className="alert alert-info" style={{ marginBottom: '1.25rem' }}>
          <AlertCircle size={20} />
          <span>{voiceWarning}</span>
        </div>
      )}

      {/* Ended Confirmation Banner */}
      {status === 'ENDED' && (
        <div className="card" style={{ marginBottom: '1.5rem', padding: '2rem', borderColor: 'var(--success-color)' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1rem' }}>
            <div className="stat-icon success">
              <CheckCircle2 size={28} />
            </div>
            <div style={{ flexGrow: 1 }}>
              <h3 style={{ marginBottom: '0.35rem', color: 'var(--text-main)' }}>
                Interview Ended — Queued for Feedback Evaluation
              </h3>
              <p style={{ marginBottom: '1rem', fontSize: '0.95rem' }}>
                Your session has been marked <strong>ENDED</strong> and a <code>session.ended</code> job has been
                recorded in the database for the Feedback module to evaluate your transcript.
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
                <Link className="btn btn-primary" to="/interview/new">
                  Practice Another Role
                </Link>
                <Link className="btn btn-outline" to="/dashboard">
                  Return to Dashboard
                </Link>
              </div>
              {endedAt && (
                <p style={{ marginTop: '0.85rem', fontSize: '0.8rem', color: 'var(--text-light)' }}>
                  Ended at {new Date(endedAt).toLocaleTimeString()}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Primary Spoken Audio Studio Stage */}
      {status === 'LIVE' && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
            gap: '1.25rem',
            marginBottom: '1.5rem',
          }}
        >
          {/* AI Interviewer Audio Stage Card */}
          <div
            className="card"
            style={{
              padding: '2rem 1.5rem',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              textAlign: 'center',
              border: `2px solid ${isAiSpeaking ? 'var(--primary-color)' : 'var(--border-color)'}`,
              boxShadow: isAiSpeaking ? '0 0 0 4px var(--primary-glow)' : 'var(--shadow-sm)',
            }}
          >
            <div
              style={{
                position: 'relative',
                width: '96px',
                height: '96px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: '1.25rem',
              }}
            >
              {isAiSpeaking && (
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    borderRadius: '50%',
                    background: 'var(--primary-light)',
                    animation: 'pulseRing 1.6s ease-in-out infinite',
                  }}
                />
              )}
              <div
                style={{
                  position: 'relative',
                  width: '72px',
                  height: '72px',
                  borderRadius: '50%',
                  background: isAiSpeaking ? 'var(--primary-color)' : 'var(--primary-light)',
                  color: isAiSpeaking ? '#ffffff' : 'var(--primary-color)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all 0.25s ease',
                }}
              >
                <Volume2 size={32} />
              </div>
            </div>

            <div
              style={{
                fontSize: '0.8rem',
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                color: isAiSpeaking ? 'var(--primary-color)' : 'var(--text-muted)',
                marginBottom: '0.4rem',
              }}
            >
              {isAiSpeaking
                ? '🔊 AI is speaking...'
                : interviewComplete
                  ? 'All Questions Completed'
                  : 'AI Interviewer Ready'}
            </div>

            <h3 style={{ fontSize: '1.15rem', marginBottom: '0.75rem' }}>AI Interviewer</h3>

            <p
              style={{
                fontSize: '0.98rem',
                color: 'var(--text-main)',
                lineHeight: 1.55,
                minHeight: '3.2rem',
                marginBottom: '1.25rem',
              }}
            >
              {currentAiQuestion
                ? `"${currentAiQuestion}"`
                : 'Preparing your opening interview question...'}
            </p>

            {currentAiQuestion && (
              <button
                type="button"
                className="btn btn-outline"
                onClick={handleReplayAiQuestion}
                disabled={isAiSpeaking}
                style={{ padding: '0.45rem 1rem', fontSize: '0.85rem' }}
              >
                <RotateCcw size={15} />
                Replay Spoken Question
              </button>
            )}
          </div>

          {/* Candidate Microphone Stage Card */}
          <div
            className="card"
            style={{
              padding: '2rem 1.5rem',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              textAlign: 'center',
              border: `2px solid ${
                isCandidateSpeaking
                  ? 'var(--success-color)'
                  : isListening
                    ? 'var(--primary-color)'
                    : 'var(--border-color)'
              }`,
            }}
          >
            <div
              style={{
                position: 'relative',
                width: '96px',
                height: '96px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: '1.25rem',
              }}
            >
              {(isListening || isCandidateSpeaking) && (
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    borderRadius: '50%',
                    background: isCandidateSpeaking ? 'var(--success-bg)' : 'var(--primary-light)',
                    transform: `scale(${1 + audioLevel * 0.35})`,
                    transition: 'transform 0.1s ease-out',
                  }}
                />
              )}
              <div
                style={{
                  position: 'relative',
                  width: '72px',
                  height: '72px',
                  borderRadius: '50%',
                  background: isMuted
                    ? 'var(--border-color)'
                    : isCandidateSpeaking
                      ? 'var(--success-color)'
                      : isListening
                        ? 'var(--primary-color)'
                        : 'var(--primary-light)',
                  color:
                    isMuted
                      ? 'var(--text-muted)'
                      : isCandidateSpeaking || isListening
                        ? '#ffffff'
                        : 'var(--primary-color)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all 0.25s ease',
                }}
              >
                {isMuted ? <MicOff size={32} /> : <Mic size={32} />}
              </div>
            </div>

            <div
              style={{
                fontSize: '0.8rem',
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                color: isMuted
                  ? 'var(--error-color)'
                  : isCandidateSpeaking
                    ? 'var(--success-color)'
                    : isListening
                      ? 'var(--primary-color)'
                      : 'var(--text-muted)',
                marginBottom: '0.4rem',
              }}
            >
              {savingTurn
                ? '⏳ Storing transcript turn...'
                : isMuted
                  ? '🔇 Microphone Muted'
                  : isCandidateSpeaking
                    ? '🗣️ Candidate is speaking...'
                    : isListening
                      ? '🎤 Listening for your answer...'
                      : 'Waiting for AI question to finish'}
            </div>

            <h3 style={{ fontSize: '1.15rem', marginBottom: '0.75rem' }}>Your Microphone</h3>

            <p
              style={{
                fontSize: '0.95rem',
                color: liveCandidateSpeech ? 'var(--text-main)' : 'var(--text-muted)',
                fontStyle: liveCandidateSpeech ? 'normal' : 'italic',
                minHeight: '3.2rem',
                marginBottom: '1.25rem',
              }}
            >
              {liveCandidateSpeech
                ? `"${liveCandidateSpeech}"`
                : interviewComplete
                  ? 'You have completed all questions for this session. Click End Interview above when ready.'
                  : isAiSpeaking
                    ? 'Listen to the interviewer, then speak your answer clearly.'
                    : 'Speak naturally into your microphone. Your spoken answer will be transcribed and saved automatically.'}
            </p>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.65rem', justifyContent: 'center' }}>
              <button
                type="button"
                className="btn btn-outline"
                onClick={handleToggleMute}
                style={{ padding: '0.5rem 1rem', fontSize: '0.875rem' }}
              >
                {isMuted ? (
                  <>
                    <Mic size={16} />
                    Unmute Mic
                  </>
                ) : (
                  <>
                    <MicOff size={16} />
                    Mute Mic
                  </>
                )}
              </button>

              {liveCandidateSpeech && (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleFinishSpeaking}
                  disabled={savingTurn}
                  style={{ padding: '0.5rem 1.1rem', fontSize: '0.875rem' }}
                >
                  <Check size={16} />
                  Done Speaking
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Collapsible Accessibility / Simulated Speech Trigger (for browsers/VMs without hardware mic STT) */}
      {status === 'LIVE' && !interviewComplete && (
        <div style={{ marginBottom: '1.5rem' }}>
          <button
            type="button"
            onClick={() => setShowAccessibilityFallback((prev) => !prev)}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-muted)',
              fontSize: '0.84rem',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.35rem',
              cursor: 'pointer',
              padding: '0.25rem 0',
            }}
          >
            <Radio size={14} />
            <span>
              {showAccessibilityFallback
                ? 'Hide microphone accessibility fallback'
                : 'Microphone unavailable? Use spoken-turn accessibility fallback'}
            </span>
            {showAccessibilityFallback ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>

          {showAccessibilityFallback && (
            <form
              onSubmit={handleFallbackSpokenSubmit}
              className="card"
              style={{
                marginTop: '0.6rem',
                padding: '1rem 1.25rem',
                display: 'flex',
                gap: '0.75rem',
                alignItems: 'center',
              }}
            >
              <input
                type="text"
                className="form-input"
                placeholder="Speak via accessibility fallback if hardware microphone STT is unavailable..."
                value={fallbackSpeechInput}
                onChange={(e) => setFallbackSpeechInput(e.target.value)}
                disabled={savingTurn || isAiSpeaking}
                style={{ flexGrow: 1 }}
              />
              <button
                type="submit"
                className="btn btn-primary"
                disabled={!fallbackSpeechInput.trim() || savingTurn || isAiSpeaking}
                style={{ whiteSpace: 'nowrap', padding: '0.7rem 1.2rem' }}
              >
                {savingTurn ? (
                  <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
                ) : (
                  'Submit Spoken Turn'
                )}
              </button>
            </form>
          )}
        </div>
      )}

      {/* Live Stored Transcript Drawer */}
      <div className="card" style={{ padding: '1.5rem' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: showTranscriptPanel ? '1rem' : 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <Sparkles size={18} color="var(--primary-color)" />
            <h3 style={{ margin: 0, fontSize: '1.05rem' }}>
              Recorded Session Transcript ({turns.length})
            </h3>
          </div>
          <button
            type="button"
            className="btn btn-outline"
            onClick={() => setShowTranscriptPanel((prev) => !prev)}
            style={{ padding: '0.35rem 0.8rem', fontSize: '0.8rem' }}
          >
            {showTranscriptPanel ? 'Hide Transcript' : 'Show Transcript'}
          </button>
        </div>

        {showTranscriptPanel && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '0.75rem',
              maxHeight: '320px',
              overflowY: 'auto',
              paddingRight: '0.25rem',
            }}
          >
            {turns.length === 0 ? (
              <div className="empty-state" style={{ padding: '1.5rem' }}>
                Transcript turns will appear here as the AI interviewer and candidate finish speaking.
              </div>
            ) : (
              turns.map((turn) => (
                <div
                  key={turn.id}
                  style={{
                    alignSelf: turn.speaker === 'AI' ? 'flex-start' : 'flex-end',
                    maxWidth: '85%',
                    background:
                      turn.speaker === 'AI' ? 'var(--primary-light)' : 'var(--bg-color)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '14px',
                    padding: '0.75rem 1rem',
                  }}
                >
                  <div
                    style={{
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      color: 'var(--text-muted)',
                      marginBottom: '0.25rem',
                    }}
                  >
                    Turn #{turn.turnIndex} •{' '}
                    {turn.speaker === 'AI' ? 'AI Interviewer' : 'Candidate'} • t+
                    {turn.timestampSec.toFixed(1)}s
                  </div>
                  <div style={{ color: 'var(--text-main)', fontSize: '0.95rem' }}>{turn.text}</div>
                </div>
              ))
            )}
            <div ref={transcriptEndRef} />
          </div>
        )}
      </div>
    </div>
  );
};
