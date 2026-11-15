import React from 'react';
import { Timer, AlertTriangle } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
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
    <Card
      className={cn(
        'p-4.5 mb-6 gap-3',
        variant === 'danger'
          ? 'border-destructive/40 bg-destructive/5'
          : variant === 'warning'
            ? 'border-warning/40 bg-warning/5'
            : 'border-border'
      )}
      role="region"
      aria-label="Interview time remaining"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div
            className={cn(
              'size-10 rounded-full flex items-center justify-center shrink-0',
              variant === 'danger'
                ? 'bg-destructive/15 text-destructive'
                : variant === 'warning'
                  ? 'bg-warning/15 text-warning'
                  : 'bg-primary/15 text-primary'
            )}
          >
            {variant === 'primary' ? (
              <Timer className="size-5" />
            ) : (
              <AlertTriangle className="size-5" />
            )}
          </div>
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {statusLabel}
            </div>
            <div
              className={cn(
                'text-xl font-bold font-mono tracking-tight countdown-digits',
                variant,
                variant === 'danger'
                  ? 'text-destructive'
                  : variant === 'warning'
                    ? 'text-warning'
                    : 'text-foreground'
              )}
              role="timer"
            >
              {formatClock(remainingSeconds)}
            </div>
          </div>
        </div>
        <span className="text-xs text-muted-foreground font-mono">
          {timeLimitMin} min session
        </span>
      </div>

      {/* Progress Bar */}
      <div
        role="progressbar"
        aria-valuenow={progressPercent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Interview time elapsed: ${progressPercent}%`}
        className="w-full h-2 rounded-full bg-secondary overflow-hidden"
      >
        <div
          className={cn(
            'interview-progress-fill h-full rounded-full transition-all duration-300',
            variant,
            variant === 'danger'
              ? 'bg-destructive'
              : variant === 'warning'
                ? 'bg-warning'
                : 'bg-primary'
          )}
          style={{ width: `${progressPercent}%` }}
        />
      </div>
    </Card>
  );
};
