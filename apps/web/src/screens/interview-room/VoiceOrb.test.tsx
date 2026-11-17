import '@testing-library/jest-dom/vitest';
import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { VoiceOrb, orbMotion } from './VoiceOrb';

const reduced = vi.hoisted(() => ({ value: false }));
vi.mock('motion/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('motion/react')>()),
  useReducedMotion: () => reduced.value,
}));

describe('VoiceOrb (P-11)', () => {
  test.each([
    ['idle', 'AI interviewer is waiting'],
    ['speaking', 'AI interviewer is speaking'],
    ['listening', 'AI interviewer is listening'],
  ] as const)('says what the interviewer is doing when %s', (state, label) => {
    reduced.value = false;
    render(<VoiceOrb state={state} />);
    expect(screen.getByRole('img', { name: label })).toHaveAttribute('data-state', state);
  });

  test('swells with the microphone level while listening, and clamps it', () => {
    expect(orbMotion('listening', 0).animate.scale).toBe(1);
    expect(orbMotion('listening', 1).animate.scale).toBeCloseTo(1.35);
    expect(orbMotion('listening', 5).animate.scale).toBeCloseTo(1.35);
    expect(orbMotion('listening', -1).animate.scale).toBe(1);
  });

  test('pulses while speaking and breathes slowly at rest', () => {
    expect(orbMotion('speaking').animate.scale).toEqual([1, 1.2, 1]);
    expect(orbMotion('idle').transition.duration).toBeGreaterThan(orbMotion('speaking').transition.duration as number);
  });

  test('stays still for people who prefer reduced motion', () => {
    reduced.value = true;
    const { container } = render(<VoiceOrb state="speaking" />);
    const ring = container.querySelector('[class*="border-2"]') as HTMLElement;
    expect(ring.getAttribute('style') ?? '').not.toMatch(/scale/);
    expect(screen.getByRole('img', { name: 'AI interviewer is speaking' })).toBeInTheDocument();
  });
});
