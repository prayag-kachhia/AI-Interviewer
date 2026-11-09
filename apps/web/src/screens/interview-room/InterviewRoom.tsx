import React from 'react';
import { Link } from 'react-router';
import {
  PhoneOff,
  Loader2,
  AlertCircle,
  CheckCircle2,
  ArrowLeft,
} from 'lucide-react';
import { useInterview, formatClock } from './useInterview';
import { InterviewerCard } from './InterviewerCard';
import { MicrophoneCard } from './MicrophoneCard';
import { TypedAnswerBox } from './TypedAnswerBox';
import { TranscriptPanel } from './TranscriptPanel';
import './InterviewRoom.css';

export const InterviewRoom: React.FC = () => {
  const {
    sessionId,
    roleLabel,
    status,
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
  } = useInterview();

  if (loading) {
    return (
      <div className="container page-wrapper" style={{ textAlign: 'center', paddingTop: '10rem' }}>
        <Loader2
          size={40}
          color="var(--primary-color)"
          style={{ animation: 'spin 1s linear infinite', marginBottom: '1rem' }}
        />
        <p style={{ fontWeight: 500 }}>Connecting to your interview room...</p>
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
          <Link className="btn btn-primary" to="/new-interview">
            Start a New Interview
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="container page-wrapper interview-room-container">
      {/* Top Header Bar */}
      <div className="interview-header">
        <div>
          <div className="interview-title-row">
            <h2 className="interview-title">AI Interview — {roleLabel}</h2>
            <span
              className={`interview-badge ${
                status === 'LIVE' ? 'interview-badge-live' : 'interview-badge-ended'
              }`}
            >
              <span
                className={`interview-badge-dot ${
                  status === 'LIVE' ? 'interview-badge-dot-live' : 'interview-badge-dot-ended'
                }`}
              />
              {status === 'LIVE' ? `LIVE • ${formatClock(elapsed)}` : 'ENDED'}
            </span>
          </div>
          <p className="interview-session-info">
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

      {/* Error & Warning Banners */}
      {error && (
        <div className="alert alert-error" role="alert" style={{ marginBottom: '1.25rem' }}>
          <AlertCircle size={20} />
          <span>{error}</span>
        </div>
      )}

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
                <Link className="btn btn-primary" to="/new-interview">
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
        <div className="interview-stage-grid">
          <InterviewerCard
            isAiSpeaking={isAiSpeaking}
            interviewComplete={interviewComplete}
            currentAiQuestion={currentAiQuestion}
            onReplayAiQuestion={handleReplayAiQuestion}
          />
          <MicrophoneCard
            isMuted={isMuted}
            isListening={isListening}
            isCandidateSpeaking={isCandidateSpeaking}
            audioLevel={audioLevel}
            liveCandidateSpeech={liveCandidateSpeech}
            interviewComplete={interviewComplete}
            savingTurn={savingTurn}
            isAiSpeaking={isAiSpeaking}
            onToggleMute={handleToggleMute}
            onFinishSpeaking={handleFinishSpeaking}
          />
        </div>
      )}

      {/* Collapsible Accessibility / Simulated Speech Trigger */}
      {status === 'LIVE' && !interviewComplete && (
        <TypedAnswerBox
          show={showAccessibilityFallback}
          onToggleShow={() => setShowAccessibilityFallback((prev) => !prev)}
          value={fallbackSpeechInput}
          onChange={setFallbackSpeechInput}
          onSubmit={handleFallbackSpokenSubmit}
          disabled={savingTurn || isAiSpeaking}
          savingTurn={savingTurn}
        />
      )}

      {/* Live Stored Transcript Drawer */}
      <TranscriptPanel
        turns={turns}
        transcriptEndRef={transcriptEndRef}
      />
    </div>
  );
};
