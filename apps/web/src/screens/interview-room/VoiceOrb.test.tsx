import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { VoiceOrb, agentStateFor, orbMotion } from './VoiceOrb';

const reduced = vi.hoisted(() => ({ value: false }));
vi.mock('motion/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('motion/react')>()),
  useReducedMotion: () => reduced.value,
}));

// jsdom can't run WebGL, so the 3D orb is replaced by a stub that shows what it was given.
vi.mock('@/components/ui/orb', () => ({
  Orb: (props: { agentState: unknown; volumeMode: string }) => (
    <div data-testid="liquid-orb" data-agent={String(props.agentState)} data-volume-mode={props.volumeMode} />
  ),
}));

/** Pretends the browser supports WebGL for one test. */
function withWebGL() {
  vi.stubGlobal('WebGLRenderingContext', function WebGLRenderingContext() {});
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as RenderingContext);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  reduced.value = false;
});

describe('VoiceOrb (P-11)', () => {
  test.each([
    ['idle', 'AI interviewer is waiting'],
    ['speaking', 'AI interviewer is speaking'],
    ['listening', 'AI interviewer is listening'],
  ] as const)('says what the interviewer is doing when %s', (state, label) => {
    render(<VoiceOrb state={state} />);
    expect(screen.getByRole('img', { name: label })).toHaveAttribute('data-state', state);
  });

  test('maps our states to the 3D orb: talking while speaking, listening while listening, calm at rest', () => {
    expect(agentStateFor('speaking')).toBe('talking');
    expect(agentStateFor('listening')).toBe('listening');
    expect(agentStateFor('idle')).toBeNull();
  });

  test('uses the 3D orb where WebGL works, following the voice only while listening', async () => {
    withWebGL();
    const { rerender } = render(<VoiceOrb state="speaking" />);
    const orb = await screen.findByTestId('liquid-orb');
    expect(orb).toHaveAttribute('data-agent', 'talking');
    expect(orb).toHaveAttribute('data-volume-mode', 'auto');

    rerender(<VoiceOrb state="listening" level={0.4} />);
    expect(await screen.findByTestId('liquid-orb')).toHaveAttribute('data-volume-mode', 'manual');
  });

  test('falls back to the ring without WebGL', () => {
    render(<VoiceOrb state="speaking" />);
    expect(screen.getByTestId('orb-ring')).toBeInTheDocument();
    expect(screen.queryByTestId('liquid-orb')).not.toBeInTheDocument();
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

  test('uses the still ring for people who prefer reduced motion, even with WebGL', () => {
    withWebGL();
    reduced.value = true;
    render(<VoiceOrb state="speaking" />);
    const ring = screen.getByTestId('orb-ring');
    expect(ring.getAttribute('style') ?? '').not.toMatch(/scale/);
    expect(screen.queryByTestId('liquid-orb')).not.toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'AI interviewer is speaking' })).toBeInTheDocument();
  });
});
