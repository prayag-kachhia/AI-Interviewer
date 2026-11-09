import React from 'react';
import { Volume2, RotateCcw } from 'lucide-react';

interface InterviewerCardProps {
  isAiSpeaking: boolean;
  interviewComplete: boolean;
  currentAiQuestion: string;
  onReplayAiQuestion: () => void;
}

export const InterviewerCard: React.FC<InterviewerCardProps> = ({
  isAiSpeaking,
  interviewComplete,
  currentAiQuestion,
  onReplayAiQuestion,
}) => {
  return (
    <div
      className="card stage-card"
      style={{
        border: `2px solid ${isAiSpeaking ? 'var(--primary-color)' : 'var(--border-color)'}`,
        boxShadow: isAiSpeaking ? '0 0 0 4px var(--primary-glow)' : 'var(--shadow-sm)',
      }}
    >
      <div className="stage-avatar-wrapper">
        {isAiSpeaking && (
          <div
            className="stage-pulse-ring"
            style={{ background: 'var(--primary-light)' }}
          />
        )}
        <div
          className="stage-avatar-circle"
          style={{
            background: isAiSpeaking ? 'var(--primary-color)' : 'var(--primary-light)',
            color: isAiSpeaking ? '#ffffff' : 'var(--primary-color)',
          }}
        >
          <Volume2 size={32} />
        </div>
      </div>

      <div
        className="stage-status-label"
        style={{ color: isAiSpeaking ? 'var(--primary-color)' : 'var(--text-muted)' }}
      >
        {isAiSpeaking
          ? '🔊 AI is speaking...'
          : interviewComplete
            ? 'All Questions Completed'
            : 'AI Interviewer Ready'}
      </div>

      <h3 className="stage-heading">AI Interviewer</h3>

      <p
        className="stage-speech-bubble"
        style={{ color: 'var(--text-main)' }}
      >
        {currentAiQuestion
          ? `"${currentAiQuestion}"`
          : 'Preparing your opening interview question...'}
      </p>

      {currentAiQuestion && (
        <button
          type="button"
          className="btn btn-outline"
          onClick={onReplayAiQuestion}
          disabled={isAiSpeaking}
          style={{ padding: '0.45rem 1rem', fontSize: '0.85rem' }}
        >
          <RotateCcw size={15} />
          Replay Spoken Question
        </button>
      )}
    </div>
  );
};
