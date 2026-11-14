import React, { useState } from 'react';
import { Sparkles, MessageSquare } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
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
    <Card className="p-5 gap-4">
      {/* Drawer Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <Sparkles className="size-5 text-primary" />
          <h3 className="font-display text-base font-semibold text-foreground">
            Recorded Session Transcript
          </h3>
          <Badge variant="secondary" className="font-mono text-xs">
            {turns.length}
          </Badge>
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setShowTranscriptPanel((prev) => !prev)}
        >
          {showTranscriptPanel ? 'Hide Transcript' : 'Show Transcript'}
        </Button>
      </div>

      {/* Drawer Content / Chat Bubbles */}
      {showTranscriptPanel && (
        <div className="flex flex-col gap-3.5 max-h-80 overflow-y-auto pr-1">
          {turns.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border/80 p-8 text-center text-sm text-muted-foreground flex flex-col items-center justify-center gap-2">
              <MessageSquare className="size-6 text-muted-foreground/60" />
              <span>Transcript turns will appear here as the AI interviewer and candidate finish speaking.</span>
            </div>
          ) : (
            turns.map((turn) => {
              const isAi = turn.speaker === 'AI';
              return (
                <div
                  key={turn.id}
                  className={cn(
                    'flex flex-col max-w-[85%] rounded-2xl p-3.5 shadow-xs transition-colors',
                    isAi
                      ? 'self-start rounded-tl-xs bg-secondary/80 text-secondary-foreground border border-border'
                      : 'self-end rounded-tr-xs bg-primary/10 dark:bg-primary/20 text-foreground border border-primary/25'
                  )}
                >
                  <div
                    className={cn(
                      'text-[11px] font-medium text-muted-foreground mb-1',
                      isAi ? 'text-left' : 'text-right'
                    )}
                  >
                    Turn #{turn.turnIndex} • {isAi ? 'AI Interviewer' : 'Candidate'} •{' '}
                    <span className="font-mono">t+{turn.timestampSec.toFixed(1)}s</span>
                  </div>
                  <div className="text-sm leading-relaxed text-foreground whitespace-pre-wrap">
                    {turn.text}
                  </div>
                </div>
              );
            })
          )}
          <div ref={transcriptEndRef} />
        </div>
      )}
    </Card>
  );
};
