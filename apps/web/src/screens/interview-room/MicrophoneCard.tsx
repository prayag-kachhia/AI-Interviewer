import React from 'react';
import { Mic, MicOff, Check } from 'lucide-react';
import { Card, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

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
    <Card
      className={cn(
        'p-6 flex flex-col items-center text-center transition-all duration-200 gap-4',
        isCandidateSpeaking
          ? 'border-success ring-2 ring-success/20 shadow-md'
          : isListening
            ? 'border-primary ring-2 ring-primary/20 shadow-md'
            : 'border-border'
      )}
    >
      {/* Microphone Avatar & Pulse Ring */}
      <div className="relative size-24 flex items-center justify-center">
        {(isListening || isCandidateSpeaking) && !isMuted && (
          <div
            className={cn(
              'absolute inset-0 rounded-full transition-transform duration-100',
              isCandidateSpeaking
                ? 'bg-success/20 animate-pulse'
                : 'bg-primary/20 animate-pulse'
            )}
            style={{
              transform: `scale(${1 + Math.min(audioLevel * 0.4, 0.4)})`,
            }}
          />
        )}
        <div
          className={cn(
            'relative size-18 rounded-full flex items-center justify-center transition-colors duration-200 shadow-sm',
            isMuted
              ? 'bg-muted text-muted-foreground'
              : isCandidateSpeaking
                ? 'bg-success text-white'
                : isListening
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-secondary text-primary'
          )}
        >
          {isMuted ? <MicOff className="size-8" /> : <Mic className="size-8" />}
        </div>
      </div>

      {/* Status Badge */}
      <Badge
        variant={
          savingTurn
            ? 'pending'
            : isMuted
              ? 'error'
              : isCandidateSpeaking
                ? 'success'
                : isListening
                  ? 'live'
                  : 'outline'
        }
      >
        {savingTurn
          ? 'Saving transcript...'
          : isMuted
            ? 'Microphone Muted'
            : isCandidateSpeaking
              ? 'Candidate Speaking'
              : isListening
                ? 'Listening for your answer...'
                : 'Waiting for AI'}
      </Badge>

      <CardTitle className="text-lg font-semibold text-foreground">
        Your Microphone
      </CardTitle>

      {/* Spoken Answer Bubble */}
      <div className="w-full rounded-xl bg-secondary/60 dark:bg-secondary/40 border border-border/70 p-4 text-center text-sm md:text-base leading-relaxed text-foreground min-h-[4.5rem] flex items-center justify-center">
        <p
          className={cn(
            liveCandidateSpeech
              ? 'font-normal text-foreground'
              : 'italic text-muted-foreground text-xs md:text-sm'
          )}
        >
          {liveCandidateSpeech
            ? `"${liveCandidateSpeech}"`
            : interviewComplete
              ? 'You have completed all questions for this session. Click End Interview when ready.'
              : isAiSpeaking
                ? 'Listen to the interviewer, then speak your answer clearly.'
                : 'Speak naturally into your microphone. Your answer will be transcribed and saved automatically.'}
        </p>
      </div>

      {/* Microphone Controls */}
      <div className="flex flex-wrap items-center justify-center gap-2 mt-auto">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onToggleMute}
          className="gap-2"
        >
          {isMuted ? (
            <>
              <Mic className="size-3.5" />
              Unmute Mic
            </>
          ) : (
            <>
              <MicOff className="size-3.5" />
              Mute Mic
            </>
          )}
        </Button>

        {liveCandidateSpeech && (
          <Button
            type="button"
            variant="default"
            size="sm"
            onClick={onFinishSpeaking}
            disabled={savingTurn}
            loading={savingTurn}
            className="gap-1.5 bg-success hover:bg-success/90 text-white"
          >
            <Check className="size-3.5" />
            Done Speaking
          </Button>
        )}
      </div>
    </Card>
  );
};
