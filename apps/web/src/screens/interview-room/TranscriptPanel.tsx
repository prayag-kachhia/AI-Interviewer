import React, { useState } from 'react';
import { Sparkles } from 'lucide-react';
import type { TurnData } from '../../types';

interface TranscriptPanelProps {
  turns: TurnData[];
  transcriptEndRef: React.RefObject<HTMLDivElement | null>;
}

export const TranscriptPanel: React.FC<TranscriptPanelProps> = ({
  turns,
  transcriptEndRef,
}) => {
  const [showTranscriptPanel, setShowTranscriptPanel] = useState(true);

  return (
    <div className="card transcript-drawer">
      <div
        className="transcript-header"
        style={{ marginBottom: showTranscriptPanel ? '1rem' : 0 }}
      >
        <div className="transcript-title">
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
        <div className="transcript-list">
          {turns.length === 0 ? (
            <div className="empty-state" style={{ padding: '1.5rem' }}>
              Transcript turns will appear here as the AI interviewer and candidate finish speaking.
            </div>
          ) : (
            turns.map((turn) => (
              <div
                key={turn.id}
                className={`transcript-bubble ${
                  turn.speaker === 'AI' ? 'transcript-bubble-ai' : 'transcript-bubble-candidate'
                }`}
              >
                <div className="transcript-meta">
                  Turn #{turn.turnIndex} •{' '}
                  {turn.speaker === 'AI' ? 'AI Interviewer' : 'Candidate'} • t+
                  {turn.timestampSec.toFixed(1)}s
                </div>
                <div className="transcript-text">{turn.text}</div>
              </div>
            ))
          )}
          <div ref={transcriptEndRef} />
        </div>
      )}
    </div>
  );
};
