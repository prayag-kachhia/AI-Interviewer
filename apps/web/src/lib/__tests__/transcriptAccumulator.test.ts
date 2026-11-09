import { describe, it, expect, beforeEach } from 'vitest';
import { TranscriptAccumulator } from '../transcriptAccumulator';
import type { FinishedTurn } from '../transcriptAccumulator';

describe('TranscriptAccumulator', () => {
  let finishedTurns: FinishedTurn[];
  let partialUpdates: Array<{ speaker: string | null; text: string }>;
  let sessionEnded: boolean;

  beforeEach(() => {
    finishedTurns = [];
    partialUpdates = [];
    sessionEnded = false;
  });

  const createAccumulator = () => {
    return new TranscriptAccumulator({
      onTurn: (turn) => finishedTurns.push(turn),
      onPartialUpdate: (speaker, text) => partialUpdates.push({ speaker, text }),
      isSessionEnded: () => sessionEnded,
    });
  };

  it('drops empty or whitespace-only chunks', () => {
    const accumulator = createAccumulator();

    accumulator.handleChunk('CANDIDATE', '');
    accumulator.handleChunk('CANDIDATE', '   ');
    accumulator.handleChunk('CANDIDATE', '\n\t  ');

    expect(partialUpdates).toHaveLength(0);
    expect(finishedTurns).toHaveLength(0);
  });

  it('accumulates streamed chunks for a speaker and updates partial text', () => {
    const accumulator = createAccumulator();

    accumulator.handleChunk('AI', 'Tell me ');
    expect(partialUpdates.at(-1)).toEqual({ speaker: 'AI', text: 'Tell me ' });

    accumulator.handleChunk('AI', 'about yourself.');
    expect(partialUpdates.at(-1)).toEqual({ speaker: 'AI', text: 'Tell me about yourself.' });

    accumulator.flushTurn();

    expect(partialUpdates.at(-1)).toEqual({ speaker: null, text: '' });
    expect(finishedTurns).toEqual([
      { speaker: 'AI', text: 'Tell me about yourself.' },
    ]);
  });

  it('given candidate interrupts AI, then AI partial sentence is saved as its own turn and candidate answer starts a new one', () => {
    const accumulator = createAccumulator();

    // AI begins speaking
    accumulator.handleChunk('AI', 'What is your experience with ');
    accumulator.handleChunk('AI', 'distributed systems and...');

    // Candidate interrupts mid-sentence: flush the in-flight AI turn
    accumulator.flushTurn();

    // AI partial sentence is emitted immediately
    expect(finishedTurns).toHaveLength(1);
    expect(finishedTurns[0]).toEqual({
      speaker: 'AI',
      text: 'What is your experience with distributed systems and...',
    });

    // Candidate begins speaking
    accumulator.handleChunk('CANDIDATE', 'Sorry to interrupt, but I have ');
    accumulator.handleChunk('CANDIDATE', 'built several microservices in Go.');
    accumulator.flushTurn();

    expect(finishedTurns).toHaveLength(2);
    expect(finishedTurns[1]).toEqual({
      speaker: 'CANDIDATE',
      text: 'Sorry to interrupt, but I have built several microservices in Go.',
    });
  });

  it('flushes previous speaker when speaker changes without an explicit flush', () => {
    const accumulator = createAccumulator();

    // Candidate speaks without explicit flush
    accumulator.handleChunk('CANDIDATE', 'I am proficient in Python.');

    // AI starts speaking -> speaker change flushes candidate turn
    accumulator.handleChunk('AI', 'Great. How about SQL?');

    expect(finishedTurns).toEqual([
      { speaker: 'CANDIDATE', text: 'I am proficient in Python.' },
    ]);
    expect(partialUpdates.at(-1)).toEqual({ speaker: 'AI', text: 'Great. How about SQL?' });

    // AI finishes
    accumulator.flushTurn();

    expect(finishedTurns).toHaveLength(2);
    expect(finishedTurns[1]).toEqual({
      speaker: 'AI',
      text: 'Great. How about SQL?',
    });
  });

  it('simulates a 3-question spoken interview with alternating speakers and no duplicate text', () => {
    const accumulator = createAccumulator();

    // Q1
    accumulator.handleChunk('AI', 'Question 1: Explain React hooks.');

    // A1
    accumulator.handleChunk('CANDIDATE', 'Hooks let you use state ');
    accumulator.handleChunk('CANDIDATE', 'and lifecycle features.');

    // Q2
    accumulator.handleChunk('AI', 'Question 2: What is the virtual DOM?');

    // A2
    accumulator.handleChunk('CANDIDATE', 'It is a lightweight copy ');
    accumulator.handleChunk('CANDIDATE', 'of the real DOM.');

    // Q3
    accumulator.handleChunk('AI', 'Question 3: How do you optimize bundle size?');

    // A3
    accumulator.handleChunk('CANDIDATE', 'Using code-splitting and tree-shaking.');
    accumulator.flushTurn();

    expect(finishedTurns).toHaveLength(6);
    expect(finishedTurns.map((t) => t.speaker)).toEqual([
      'AI',
      'CANDIDATE',
      'AI',
      'CANDIDATE',
      'AI',
      'CANDIDATE',
    ]);
    expect(finishedTurns[0].text).toBe('Question 1: Explain React hooks.');
    expect(finishedTurns[1].text).toBe('Hooks let you use state and lifecycle features.');
    expect(finishedTurns[2].text).toBe('Question 2: What is the virtual DOM?');
    expect(finishedTurns[3].text).toBe('It is a lightweight copy of the real DOM.');
    expect(finishedTurns[4].text).toBe('Question 3: How do you optimize bundle size?');
    expect(finishedTurns[5].text).toBe('Using code-splitting and tree-shaking.');
  });

  it('does not emit turns while the session is ended', () => {
    const accumulator = createAccumulator();

    sessionEnded = true;

    accumulator.handleChunk('CANDIDATE', 'Will this be saved?');
    accumulator.flushTurn();

    expect(finishedTurns).toHaveLength(0);
  });

  it('reset clears the buffer without emitting a turn', () => {
    const accumulator = createAccumulator();

    accumulator.handleChunk('AI', 'Incomplete thought');
    accumulator.reset();
    accumulator.flushTurn();

    expect(finishedTurns).toHaveLength(0);
    expect(partialUpdates.at(-1)).toEqual({ speaker: null, text: '' });
  });
});
