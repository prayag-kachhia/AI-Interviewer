import React, { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { Mic, Volume2 } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import type { AgentState } from '@/components/ui/orb';
import { cn } from '@/lib/utils';

// three.js is large, so the 3D orb is only downloaded by pages that show it.
const LiquidOrb = lazy(() => import('@/components/ui/orb').then((m) => ({ default: m.Orb })));

export type OrbState = 'idle' | 'speaking' | 'listening';

interface VoiceOrbProps {
  state: OrbState;
  /** Microphone level, 0 to 1. Only used while listening. */
  level?: number;
  /** Size of the orb, as Tailwind size classes. */
  className?: string;
}

const LABELS: Record<OrbState, string> = {
  idle: 'AI interviewer is waiting',
  speaking: 'AI interviewer is speaking',
  listening: 'AI interviewer is listening',
};

/** The ElevenLabs orb's state for each of ours. */
export function agentStateFor(state: OrbState): AgentState {
  if (state === 'speaking') return 'talking';
  if (state === 'listening') return 'listening';
  return null;
}

/** True when the browser can draw WebGL (jsdom and some locked-down browsers can't). */
export function canUseWebGL(): boolean {
  if (typeof window === 'undefined' || typeof WebGLRenderingContext === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

/** The theme's two orb colours (--orb-1, --orb-2 in styles.css), kept current when the theme changes. */
function useOrbColors() {
  const colorsRef = useRef<[string, string]>(['#c5a059', '#f3e7c4']);
  useEffect(() => {
    const read = () => {
      const style = getComputedStyle(document.documentElement);
      const first = style.getPropertyValue('--orb-1').trim();
      const second = style.getPropertyValue('--orb-2').trim();
      if (first && second) colorsRef.current = [first, second];
    };
    read();
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);
  return colorsRef;
}

/** The fallback ring's scale animation: breathing at rest, pulsing while speaking, following the voice while listening. */
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

/** The simple ring: shown with reduced motion (where it stays still), without WebGL, and while the 3D orb loads. */
const RingOrb: React.FC<{ state: OrbState; level: number; still: boolean }> = ({ state, level, still }) => {
  const active = state !== 'idle';
  const { animate, transition } = still ? { animate: undefined, transition: undefined } : orbMotion(state, level);
  return (
    <>
      <motion.div
        aria-hidden
        data-testid="orb-ring"
        className={cn('absolute inset-0 rounded-full border-2', active ? 'border-primary bg-primary/15' : 'border-border')}
        animate={animate}
        transition={transition}
      />
      <div
        aria-hidden
        className={cn(
          'relative flex size-2/3 items-center justify-center rounded-full transition-colors duration-200',
          active ? 'bg-primary text-primary-foreground' : 'bg-secondary text-primary',
        )}
      >
        {state === 'listening' ? <Mic className="size-7" /> : <Volume2 className="size-7" />}
      </div>
    </>
  );
};

/**
 * The interviewer's orb. Where WebGL works and motion is welcome it is the ElevenLabs liquid orb in the
 * theme's colours: calm at rest, lively while the AI talks, and swelling with your voice while it
 * listens. Otherwise it is a simple ring that, with reduced motion, stays still.
 */
export const VoiceOrb: React.FC<VoiceOrbProps> = ({ state, level = 0, className = 'size-24' }) => {
  const reduceMotion = useReducedMotion();
  const [webgl] = useState(canUseWebGL);
  const colorsRef = useOrbColors();
  const inputRef = useRef(0);
  // Speech reads about 0.15–0.5 on the room's meter; scale it up so the orb visibly answers a normal voice.
  inputRef.current = Math.min(1, Math.max(0, level) * 1.6);

  const ring = <RingOrb state={state} level={level} still={Boolean(reduceMotion)} />;

  return (
    <div
      role="img"
      aria-label={LABELS[state]}
      data-state={state}
      className={cn('relative flex shrink-0 items-center justify-center', className)}
    >
      {webgl && !reduceMotion ? (
        <Suspense fallback={ring}>
          <LiquidOrb
            className="absolute inset-0"
            colors={colorsRef.current}
            colorsRef={colorsRef}
            agentState={agentStateFor(state)}
            volumeMode={state === 'listening' ? 'manual' : 'auto'}
            inputVolumeRef={inputRef}
            manualOutput={0.35}
          />
        </Suspense>
      ) : (
        ring
      )}
    </div>
  );
};
