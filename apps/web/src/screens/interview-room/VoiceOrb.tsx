import React from 'react';
import { Mic, Volume2 } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { cn } from '@/lib/utils';

export type OrbState = 'idle' | 'speaking' | 'listening';

interface VoiceOrbProps {
  state: OrbState;
  /** Microphone level, 0 to 1. Only used while listening. */
  level?: number;
}

const LABELS: Record<OrbState, string> = {
  idle: 'AI interviewer is waiting',
  speaking: 'AI interviewer is speaking',
  listening: 'AI interviewer is listening',
};

/** The ring's scale animation: breathing at rest, pulsing while speaking, following the voice while listening. */
export function orbMotion(state: OrbState, level = 0) {
  if (state === 'speaking') {
    return { animate: { scale: [1, 1.2, 1] }, transition: { duration: 1.1, repeat: Infinity, ease: 'easeInOut' as const } };
  }
  if (state === 'listening') {
    const clamped = Math.min(1, Math.max(0, level));
    return { animate: { scale: 1 + clamped * 0.35 }, transition: { type: 'spring' as const, stiffness: 300, damping: 20 } };
  }
  return { animate: { scale: [1, 1.05, 1] }, transition: { duration: 4, repeat: Infinity, ease: 'easeInOut' as const } };
}

/**
 * A ring that breathes while idle, pulses while the AI speaks and swells with your voice while it
 * listens. With reduced motion it stays still and only changes colour.
 */
export const VoiceOrb: React.FC<VoiceOrbProps> = ({ state, level = 0 }) => {
  const reduceMotion = useReducedMotion();
  const active = state !== 'idle';

  const { animate, transition } = reduceMotion ? { animate: undefined, transition: undefined } : orbMotion(state, level);

  return (
    <div
      role="img"
      aria-label={LABELS[state]}
      data-state={state}
      className="relative flex size-24 items-center justify-center"
    >
      <motion.div
        aria-hidden
        className={cn('absolute inset-0 rounded-full border-2', active ? 'border-primary bg-primary/15' : 'border-border')}
        animate={animate}
        transition={transition}
      />
      <div
        aria-hidden
        className={cn(
          'relative flex size-16 items-center justify-center rounded-full transition-colors duration-200',
          active ? 'bg-primary text-primary-foreground' : 'bg-secondary text-primary',
        )}
      >
        {state === 'listening' ? <Mic className="size-7" /> : <Volume2 className="size-7" />}
      </div>
    </div>
  );
};
