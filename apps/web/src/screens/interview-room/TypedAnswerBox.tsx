import React from 'react';
import { Radio, ChevronDown, ChevronUp } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

interface TypedAnswerBoxProps {
  show: boolean;
  onToggleShow: () => void;
  value: string;
  onChange: (val: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  disabled: boolean;
  savingTurn: boolean;
  onSwitchToTyped?: () => void;
}

export const TypedAnswerBox: React.FC<TypedAnswerBoxProps> = ({
  show,
  onToggleShow,
  value,
  onChange,
  onSubmit,
  disabled,
  savingTurn,
  onSwitchToTyped,
}) => {
  return (
    <div className="mb-6 flex flex-wrap items-center gap-3">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onToggleShow}
        className="h-auto p-0 text-xs text-muted-foreground hover:text-foreground gap-1.5 font-normal"
      >
        <Radio className="size-3.5" />
        <span>
          {show
            ? 'Hide microphone accessibility fallback'
            : 'Microphone unavailable? Use spoken-turn accessibility fallback'}
        </span>
        {show ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
      </Button>

      {onSwitchToTyped && (
        <>
          <span className="text-xs text-muted-foreground">•</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onSwitchToTyped}
            className="h-auto p-0 text-xs text-muted-foreground hover:text-foreground font-normal underline underline-offset-2"
          >
            Type instead
          </Button>
        </>
      )}

      {show && (
        <Card className="mt-2.5 p-3.5 gap-0">
          <form onSubmit={onSubmit} className="flex flex-col sm:flex-row gap-2.5 items-stretch sm:items-center">
            <input
              type="text"
              className="flex-1 h-9 rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              placeholder="Speak via accessibility fallback if hardware microphone STT is unavailable..."
              value={value}
              onChange={(e) => onChange(e.target.value)}
              disabled={disabled}
            />
            <Button
              type="submit"
              variant="default"
              size="default"
              disabled={!value.trim() || disabled}
              loading={savingTurn}
              className="shrink-0"
            >
              Submit Spoken Turn
            </Button>
          </form>
        </Card>
      )}
    </div>
  );
};
