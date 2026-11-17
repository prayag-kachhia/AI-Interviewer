import React from 'react';
import { cn } from '@/lib/utils';

/**
 * The mark: a voice ring with three waveform bars, the same idea as the orb in the interview room.
 * The ring takes the page's ink and the middle bar the theme's accent (`--brand`), so it follows
 * all three themes. `public/favicon.svg` draws the same shapes for the browser tab.
 */
export const Logo: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 32 32" fill="none" aria-hidden="true" className={cn('size-7', className)}>
    <circle cx="16" cy="16" r="13.5" stroke="currentColor" strokeWidth="2.5" />
    <g strokeWidth="2.8" strokeLinecap="round">
      <path d="M10.5 13.5v5" stroke="currentColor" />
      <path d="M16 9.5v13" className="stroke-brand" />
      <path d="M21.5 12v8" stroke="currentColor" />
    </g>
  </svg>
);
