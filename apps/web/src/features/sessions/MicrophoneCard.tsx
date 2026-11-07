import React from 'react';
import { Mic, MicOff, Check } from 'lucide-react';

interface MicrophoneCardProps {
  isMuted: boolean;
  isListening: boolean;
  isCandidateSpeaking: boolean;
  audioLevel: number;
  liveCandidateSpeech: string;
  interviewComplete: boolean;
  savingTurn: boolean;
  isAiSpeaking: boolean;
  onToggleMute: () => void;
  onFinishSpeaking: () => void;
}

export const MicrophoneCard: React.FC<MicrophoneCardProps> = ({
  isMuted,
  isListening,
  isCandidateSpeaking,
  audioLevel,
  liveCandidateSpeech,
  interviewComplete,
  savingTurn,
  isAiSpeaking,
  onToggleMute,
  onFinishSpeaking,
}) => {
  return (
    <div
      className="card stage-card"
      style={{
        border: `2px solid ${
          isCandidateSpeaking
            ? 'var(--success-color)'
            : isListening
              ? 'var(--primary-color)'
              : 'var(--border-color)'
        }`,
      }}
    >
      <div className="stage-avatar-wrapper">
        {(isListening || isCandidateSpeaking) && (
          <div
            className="stage-pulse-ring"
            style={{
              background: isCandidateSpeaking ? 'var(--success-bg)' : 'var(--primary-light)',
              transform: `scale(${1 + audioLevel * 0.35})`,
              transition: 'transform 0.1s ease-out',
            }}
          />
        )}
        <div
          className="stage-avatar-circle"
          style={{
            background: isMuted
              ? 'var(--border-color)'
              : isCandidateSpeaking
                ? 'var(--success-color)'
                : isListening
                  ? 'var(--primary-color)'
                  : 'var(--primary-light)',
            color: isMuted
              ? 'var(--text-muted)'
              : isCandidateSpeaking || isListening
                ? '#ffffff'
                : 'var(--primary-color)',
          }}
        >
          {isMuted ? <MicOff size={32} /> : <Mic size={32} />}
        </div>
      </div>

      <div
        className="stage-status-label"
        style={{
          color: isMuted
            ? 'var(--error-color)'
            : isCandidateSpeaking
              ? 'var(--success-color)'
              : isListening
                ? 'var(--primary-color)'
                : 'var(--text-muted)',
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

      <h3 className="stage-heading">Your Microphone</h3>

      <p
        className="stage-speech-bubble"
        style={{
          color: liveCandidateSpeech ? 'var(--text-main)' : 'var(--text-muted)',
          fontStyle: liveCandidateSpeech ? 'normal' : 'italic',
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
          onClick={onToggleMute}
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
            onClick={onFinishSpeaking}
            disabled={savingTurn}
            style={{ padding: '0.5rem 1.1rem', fontSize: '0.875rem' }}
          >
            <Check size={16} />
            Done Speaking
          </button>
        )}
      </div>
    </div>
  );
};
