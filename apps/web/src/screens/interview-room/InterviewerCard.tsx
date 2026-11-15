import React from 'react';
import { Volume2, RotateCcw } from 'lucide-react';
import { Card, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

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
    <Card
      className={cn(
        'p-6 flex flex-col items-center text-center transition-all duration-200 gap-4',
        isAiSpeaking
          ? 'border-primary ring-2 ring-primary/20 shadow-md'
          : 'border-border'
      )}
    >
      {/* Avatar Container */}
      <div className="relative size-24 flex items-center justify-center">
        {isAiSpeaking && (
          <div className="absolute inset-0 rounded-full bg-primary/15 animate-ping opacity-75" />
        )}
        <div
          className={cn(
            'relative size-18 rounded-full flex items-center justify-center transition-colors duration-200',
            isAiSpeaking
              ? 'bg-primary text-primary-foreground shadow-sm'
              : 'bg-secondary text-primary'
          )}
        >
          <Volume2 className="size-8" />
        </div>
      </div>

      {/* Status Badge */}
      <Badge variant={isAiSpeaking ? 'live' : interviewComplete ? 'ended' : 'outline'}>
        {isAiSpeaking
          ? 'AI is speaking...'
          : interviewComplete
            ? 'All Questions Completed'
            : 'AI Interviewer Ready'}
      </Badge>

      <CardTitle className="text-lg font-semibold text-foreground">
        AI Interviewer
      </CardTitle>

      {/* Spoken Question Speech Bubble */}
      <div className="w-full rounded-xl bg-secondary/60 dark:bg-secondary/40 border border-border/70 p-4 text-center text-sm md:text-base leading-relaxed text-foreground min-h-[4.5rem] flex items-center justify-center">
        <p className={cn(currentAiQuestion ? 'font-normal' : 'italic text-muted-foreground')}>
          {currentAiQuestion
            ? `"${currentAiQuestion}"`
            : 'Preparing your opening interview question...'}
        </p>
      </div>

      {currentAiQuestion && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onReplayAiQuestion}
          disabled={isAiSpeaking}
          className="gap-2 mt-auto"
        >
          <RotateCcw className="size-3.5" />
          Replay Spoken Question
        </Button>
      )}
    </Card>
  );
};
