import React from 'react';
import { AlertCircle, RotateCcw, Keyboard, PhoneOff } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';

export interface VoiceFailureCardProps {
  error?: string;
  onRetry: () => void;
  onTypeInstead: () => void;
  onEndInterview: () => void;
  isRetrying?: boolean;
}

export const VoiceFailureCard: React.FC<VoiceFailureCardProps> = ({
  error,
  onRetry,
  onTypeInstead,
  onEndInterview,
  isRetrying = false,
}) => {
  return (
    <Card
      className="p-6 border-destructive/40 bg-destructive/5 flex flex-col gap-4 mb-2"
      data-testid="voice-failure-screen"
    >
      <Alert variant="error">
        <AlertCircle className="size-5" />
        <AlertTitle className="font-semibold text-base">Voice Connection Unavailable</AlertTitle>
        <AlertDescription className="mt-1 text-sm leading-relaxed">
          {error ||
            'Unable to establish a voice connection with the AI interviewer or the browser speech fallback.'}
        </AlertDescription>
      </Alert>

      <p className="text-sm text-muted-foreground leading-relaxed m-0">
        A voice connection could not be established. You can retry connecting your audio, switch to
        typed mode to continue your interview using text, or end the interview.
      </p>

      <div className="flex flex-wrap items-center gap-3 pt-2">
        <Button
          type="button"
          variant="default"
          onClick={onRetry}
          disabled={isRetrying}
          loading={isRetrying}
          className="gap-2"
        >
          <RotateCcw className="size-4" />
          Retry
        </Button>

        <Button
          type="button"
          variant="secondary"
          onClick={onTypeInstead}
          className="gap-2"
        >
          <Keyboard className="size-4" />
          Type instead
        </Button>

        <Button
          type="button"
          variant="outline"
          onClick={onEndInterview}
          className="gap-2 text-destructive hover:text-destructive hover:bg-destructive/10"
        >
          <PhoneOff className="size-4" />
          End Interview
        </Button>
      </div>
    </Card>
  );
};
