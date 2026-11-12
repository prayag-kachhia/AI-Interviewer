import React from 'react';
import { Timer, AlertTriangle } from 'lucide-react';
import { formatClock } from './useInterview';

interface InterviewCountdownProps {
  elapsed: number;
  timeLimitMin: number;
}

export const InterviewCountdown: React.FC<InterviewCountdownProps> = ({
  elapsed,
  timeLimitMin,
}) => {
  const totalSeconds = timeLimitMin * 60;
  const remainingSeconds = Math.max(0, totalSeconds - elapsed);
  const progressPercent = Math.min(100, Math.round((elapsed / totalSeconds) * 100));

  const variant =
    remainingSeconds <= 60 ? 'danger' : remainingSeconds <= 180 ? 'warning' : 'primary';

  const statusLabel =
    remainingSeconds === 0
      ? 'Time Limit Reached'
      : remainingSeconds <= 60
        ? 'Final Minute — Concluding'
        : remainingSeconds <= 180
          ? 'Wrapping Up Soon'
          : 'Time Remaining';

  return (
    <div
      className={`card interview-countdown countdown-${variant}`}
      role="region"
      aria-label="Interview time remaining"
    >
      <div className="interview-countdown-row">
        <div className="interview-countdown-meta">
          <div className={`stat-icon ${variant}`}>
            {variant === 'primary' ? <Timer size={22} /> : <AlertTriangle size={22} />}
          </div>
          <div>
            <div className="countdown-label">{statusLabel}</div>
            <div className={`countdown-digits ${variant}`} role="timer">
              {formatClock(remainingSeconds)}
            </div>
          </div>
        </div>
        <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
          {timeLimitMin} min session
        </span>
      </div>

      <div
        role="progressbar"
        aria-valuenow={progressPercent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Interview time elapsed: ${progressPercent}%`}
        className="interview-progress"
      >
        <div
          className={`interview-progress-fill ${variant}`}
          style={{ width: `${progressPercent}%` }}
        />
      </div>
    </div>
  );
};
