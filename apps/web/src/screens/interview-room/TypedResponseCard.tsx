import React from 'react';
import { Send, Keyboard } from 'lucide-react';
import { Card, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface TypedResponseCardProps {
  value: string;
  onChange: (val: string) => void;
  onSubmit: (e?: React.FormEvent) => void;
  disabled: boolean;
  submitting: boolean;
  interviewComplete: boolean;
}

export const TypedResponseCard: React.FC<TypedResponseCardProps> = ({
  value,
  onChange,
  onSubmit,
  disabled,
  submitting,
  interviewComplete,
}) => {
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!value.trim() || disabled || submitting || interviewComplete) return;
    onSubmit(e);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      if (value.trim() && !disabled && !submitting && !interviewComplete) {
        onSubmit();
      }
    }
  };

  return (
    <Card
      className={cn(
        'p-6 flex flex-col items-center text-center transition-all duration-200 gap-4',
        submitting
          ? 'border-primary ring-2 ring-primary/20 shadow-md'
          : 'border-border'
      )}
    >
      {/* Keyboard Avatar Icon */}
      <div className="relative size-24 flex items-center justify-center">
        {submitting && (
          <div className="absolute inset-0 rounded-full bg-primary/15 animate-ping opacity-75" />
        )}
        <div
          className={cn(
            'relative size-18 rounded-full flex items-center justify-center transition-colors duration-200 shadow-sm',
            submitting
              ? 'bg-primary text-primary-foreground'
              : 'bg-secondary text-primary'
          )}
        >
          <Keyboard className="size-8" />
        </div>
      </div>

      {/* Status Badge */}
      <Badge
        variant={
          submitting
            ? 'pending'
            : interviewComplete
              ? 'ended'
              : 'outline'
        }
      >
        {submitting
          ? 'Saving transcript...'
          : interviewComplete
            ? 'All Questions Completed'
            : 'Type Your Answer'}
      </Badge>

      <CardTitle className="text-lg font-semibold text-foreground">
        Your Response
      </CardTitle>

      {/* Textarea Input Form */}
      <form onSubmit={handleSubmit} className="w-full flex flex-col gap-3 flex-1">
        <textarea
          aria-label="Type your interview answer"
          className="w-full min-h-[110px] rounded-xl border border-input bg-background p-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-y"
          placeholder={
            interviewComplete
              ? 'You have completed all questions for this session. Click End Interview when ready.'
              : 'Type your answer here... (Press Ctrl+Enter or click Submit Answer)'
          }
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled || submitting || interviewComplete}
          rows={4}
        />

        <div className="flex items-center justify-between gap-2 mt-auto">
          <span className="text-xs text-muted-foreground">
            {value.length > 0 ? `${value.length} characters` : 'Ctrl+Enter to submit'}
          </span>
          <Button
            type="submit"
            variant="default"
            size="sm"
            disabled={!value.trim() || disabled || submitting || interviewComplete}
            loading={submitting}
            className="gap-2 shrink-0"
          >
            <Send className="size-3.5" />
            Submit Answer
          </Button>
        </div>
      </form>
    </Card>
  );
};
