import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TranscriptAccumulator } from '../transcriptAccumulator';
import type { TranscriptTurnRecord, PostTurnFunction } from '../transcriptAccumulator';

describe('TranscriptAccumulator (FR-12, FR-26, Issue #88)', () => {
  const mockSessionId = 'session-test-123';
  let persistedTurns: TranscriptTurnRecord[];
  let partialUpdates: Array<{ speaker: string | null; text: string }>;
  let postTurnCalls: Array<{ sessionId: string; speaker: string; text: string; timestampSec: number }>;
  let mockPostTurn: PostTurnFunction;
  let sessionStatus: 'LIVE' | 'ENDED';
  let elapsedSec = 10;

  beforeEach(() => {
    persistedTurns = [];
    partialUpdates = [];
    postTurnCalls = [];
    sessionStatus = 'LIVE';
    elapsedSec = 10;

    mockPostTurn = vi.fn(
      async (sessionId: string, speaker: any, text: string, timestampSec: number) => {
        postTurnCalls.push({ sessionId, speaker, text, timestampSec });
        return { success: true, data: { id: `turn-${persistedTurns.length + 1}`, speaker, text, timestampSec } };
      }
    ) as unknown as PostTurnFunction;
  });

  const createAccumulator = () => {
    return new TranscriptAccumulator({
      sessionId: mockSessionId,
      postTurnFn: mockPostTurn,
      onTurnPersisted: (turn) => persistedTurns.push(turn),
      onPartialUpdate: (speaker, text) => partialUpdates.push({ speaker, text }),
      getElapsedSeconds: () => elapsedSec,
      getSessionStatus: () => sessionStatus,
    });
  };

  it('drops empty or whitespace-only chunks', async () => {
    const accumulator = createAccumulator();

    await accumulator.processServerContent({ inputTranscription: { text: '' } });
    await accumulator.processServerContent({ inputTranscription: { text: '   ' } });
    await accumulator.processServerContent({ inputTranscription: { text: '\n\t  ' } });

    expect(accumulator.getPartialText()).toBe('');
    expect(postTurnCalls.length).toBe(0);
    expect(persistedTurns).toHaveLength(0);
  });

  it('accumulates streamed chunks for a speaker and updates partial text', async () => {
    const accumulator = createAccumulator();

    await accumulator.processServerContent({ outputTranscription: { text: 'Tell me ' } });
    expect(accumulator.getPartialText()).toBe('Tell me ');
    expect(accumulator.getCurrentSpeaker()).toBe('AI');

    await accumulator.processServerContent({ outputTranscription: { text: 'about yourself.' } });
    expect(accumulator.getPartialText()).toBe('Tell me about yourself.');

    // Completing the turn flushes it
    await accumulator.processServerContent({ turnComplete: true });

    expect(accumulator.getPartialText()).toBe('');
    expect(postTurnCalls.length).toBe(1);
    expect(postTurnCalls[0]).toEqual({
      sessionId: mockSessionId,
      speaker: 'AI',
      text: 'Tell me about yourself.',
      timestampSec: 10,
    });
    expect(persistedTurns).toEqual([
      { speaker: 'AI', text: 'Tell me about yourself.', timestampSec: 10 },
    ]);
  });

  it('given candidate interrupts AI, then AI partial sentence is saved as its own turn and candidate answer starts a new one', async () => {
    const accumulator = createAccumulator();

    // AI begins speaking
    await accumulator.processServerContent({ outputTranscription: { text: 'What is your experience with ' } });
    await accumulator.processServerContent({ outputTranscription: { text: 'distributed systems and...' } });

    // Candidate interrupts mid-sentence!
    elapsedSec = 15;
    await accumulator.processServerContent({ interrupted: true });

    // AI's partial sentence should be saved as its own turn immediately
    expect(postTurnCalls.length).toBe(1);
    expect(postTurnCalls[0]).toEqual({
      sessionId: mockSessionId,
      speaker: 'AI',
      text: 'What is your experience with distributed systems and...',
      timestampSec: 15,
    });
    expect(persistedTurns).toHaveLength(1);
    expect(persistedTurns[0].speaker).toBe('AI');

    // Candidate begins speaking their response
    elapsedSec = 18;
    await accumulator.processServerContent({ inputTranscription: { text: 'Sorry to interrupt, but I have ' } });
    await accumulator.processServerContent({ inputTranscription: { text: 'built several microservices in Go.' } });
    await accumulator.processServerContent({ turnComplete: true });

    expect(postTurnCalls.length).toBe(2);
    expect(postTurnCalls[1]).toEqual({
      sessionId: mockSessionId,
      speaker: 'CANDIDATE',
      text: 'Sorry to interrupt, but I have built several microservices in Go.',
      timestampSec: 18,
    });

    expect(persistedTurns).toEqual([
      {
        speaker: 'AI',
        text: 'What is your experience with distributed systems and...',
        timestampSec: 15,
      },
      {
        speaker: 'CANDIDATE',
        text: 'Sorry to interrupt, but I have built several microservices in Go.',
        timestampSec: 18,
      },
    ]);
  });

  it('flushes previous speaker when speaker changes without an explicit turnComplete', async () => {
    const accumulator = createAccumulator();

    // Candidate speaks without explicit turnComplete
    elapsedSec = 20;
    await accumulator.processServerContent({ inputTranscription: { text: 'I am proficient in Python.' } });

    // AI starts speaking -> speaker change triggers candidate turn save
    elapsedSec = 25;
    await accumulator.processServerContent({ outputTranscription: { text: 'Great. How about SQL?' } });

    expect(postTurnCalls.length).toBe(1);
    expect(persistedTurns).toEqual([
      { speaker: 'CANDIDATE', text: 'I am proficient in Python.', timestampSec: 25 },
    ]);
    expect(accumulator.getCurrentSpeaker()).toBe('AI');
    expect(accumulator.getPartialText()).toBe('Great. How about SQL?');

    // AI finishes
    elapsedSec = 28;
    await accumulator.processServerContent({ turnComplete: true });

    expect(postTurnCalls.length).toBe(2);
    expect(persistedTurns).toHaveLength(2);
    expect(persistedTurns[1]).toEqual({
      speaker: 'AI',
      text: 'Great. How about SQL?',
      timestampSec: 28,
    });
  });

  it('simulates a 3-question spoken interview with alternating speakers and no duplicate text', async () => {
    const accumulator = createAccumulator();

    // Q1
    elapsedSec = 5;
    await accumulator.processServerContent({ outputTranscription: { text: 'Question 1: Explain React hooks.' } });
    await accumulator.processServerContent({ turnComplete: true });

    // A1
    elapsedSec = 15;
    await accumulator.processServerContent({ inputTranscription: { text: 'Hooks let you use state ' } });
    await accumulator.processServerContent({ inputTranscription: { text: 'and lifecycle features.' } });
    await accumulator.processServerContent({ turnComplete: true });

    // Q2
    elapsedSec = 25;
    await accumulator.processServerContent({ outputTranscription: { text: 'Question 2: What is the virtual DOM?' } });
    await accumulator.processServerContent({ turnComplete: true });

    // A2
    elapsedSec = 35;
    await accumulator.processServerContent({ inputTranscription: { text: 'It is a lightweight copy ' } });
    await accumulator.processServerContent({ inputTranscription: { text: 'of the real DOM.' } });
    await accumulator.processServerContent({ turnComplete: true });

    // Q3
    elapsedSec = 45;
    await accumulator.processServerContent({ outputTranscription: { text: 'Question 3: How do you optimize bundle size?' } });
    await accumulator.processServerContent({ turnComplete: true });

    // A3
    elapsedSec = 55;
    await accumulator.processServerContent({ inputTranscription: { text: 'Using code-splitting and tree-shaking.' } });
    await accumulator.processServerContent({ turnComplete: true });

    expect(persistedTurns).toHaveLength(6);
    expect(persistedTurns.map((t) => t.speaker)).toEqual([
      'AI',
      'CANDIDATE',
      'AI',
      'CANDIDATE',
      'AI',
      'CANDIDATE',
    ]);
    expect(persistedTurns[0].text).toBe('Question 1: Explain React hooks.');
    expect(persistedTurns[1].text).toBe('Hooks let you use state and lifecycle features.');
    expect(persistedTurns[2].text).toBe('Question 2: What is the virtual DOM?');
    expect(persistedTurns[3].text).toBe('It is a lightweight copy of the real DOM.');
    expect(persistedTurns[4].text).toBe('Question 3: How do you optimize bundle size?');
    expect(persistedTurns[5].text).toBe('Using code-splitting and tree-shaking.');
  });

  it('does not post turns while the session is ENDED', async () => {
    const accumulator = createAccumulator();

    sessionStatus = 'ENDED';

    await accumulator.processServerContent({ inputTranscription: { text: 'Will this be saved?' } });
    await accumulator.processServerContent({ turnComplete: true });

    expect(postTurnCalls.length).toBe(0);
    expect(persistedTurns).toHaveLength(0);
  });
});
