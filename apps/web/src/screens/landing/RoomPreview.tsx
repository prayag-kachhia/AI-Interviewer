import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { VoiceOrb } from '../interview-room/VoiceOrb';

/* Bars of the static voice meter, as literal classes so Tailwind generates them. Decorative only. */
const METER = [
  'h-[20%]', 'h-[40%]', 'h-[70%]', 'h-full', 'h-[80%]', 'h-1/2', 'h-[90%]', 'h-[60%]', 'h-[30%]',
  'h-[70%]', 'h-full', 'h-[60%]', 'h-[40%]', 'h-[20%]', 'h-1/2', 'h-[80%]', 'h-[40%]', 'h-[20%]',
];

/** Corner brackets in the theme's accent: hairline in Haute, thick in Swiss, emerald in Graphite. */
const Corner: React.FC<{ className: string }> = ({ className }) => (
  <span aria-hidden className={`pointer-events-none absolute size-3 border-brand ${className}`} />
);

/**
 * A still picture of the interview room, built from the same parts the room uses. The orb is the
 * real one, so it breathes (and stops when the visitor prefers reduced motion).
 */
export const RoomPreview: React.FC = () => (
  <figure
    aria-label="Preview of the interview room"
    className="relative m-0 flex flex-col gap-5 border-(length:--border-w) border-border bg-card p-6 text-card-foreground [box-shadow:var(--shadow-card)] sm:p-8"
  >
    <Corner className="-top-1 -left-1 border-t-2 border-l-2" />
    <Corner className="-top-1 -right-1 border-t-2 border-r-2" />
    <Corner className="-bottom-1 -left-1 border-b-2 border-l-2" />
    <Corner className="-right-1 -bottom-1 border-r-2 border-b-2" />

    <div className="flex items-center justify-between gap-3 border-b-(length:--border-w) border-border pb-4">
      <span className="label text-xs text-muted-foreground">Interview room</span>
      <Badge variant="live">Live</Badge>
    </div>

    <div className="flex items-center gap-5">
      <div className="shrink-0">
        <VoiceOrb className="size-24 sm:size-28" state="speaking" />
      </div>
      <div className="flex flex-col gap-1">
        <span className="label text-xs text-brand">Software Engineer, system design</span>
        <p className="heading text-xl leading-snug text-card-foreground sm:text-2xl">
          Walk me through a system you designed. Where would it break first under load?
        </p>
      </div>
    </div>

    <div className="flex h-10 items-end gap-1" aria-hidden>
      {METER.map((height, i) => (
        <span key={i} className={`flex-1 bg-brand/70 ${height}`} />
      ))}
    </div>

    <div className="flex flex-col gap-2">
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>Time left</span>
        <span className="font-mono">09:20</span>
      </div>
      <Progress value={62} aria-label="Time left in this example interview" />
    </div>
  </figure>
);
