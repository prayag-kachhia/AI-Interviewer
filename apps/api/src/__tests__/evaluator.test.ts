import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { TurnSpeaker } from '@interview/contracts';
import {
  evaluateTranscript,
  buildEvaluationPrompt,
  RUBRIC,
  type EvaluationInput,
  type TranscriptTurn,
} from '../services/evaluator.service';

// Established schema validation for transcript turn fixtures against shared contracts
const TranscriptTurnSchema = z.object({
  speaker: TurnSpeaker,
  text: z.string(),
});
const TranscriptFixtureSchema = z.array(TranscriptTurnSchema);

function loadTranscriptFixture(filename: string): TranscriptTurn[] {
  const fileUrl = new URL(`./fixtures/transcripts/${filename}`, import.meta.url);
  const raw = readFileSync(fileUrl, 'utf-8');
  return TranscriptFixtureSchema.parse(JSON.parse(raw));
}

// Primary fixture loaded from good.json for normal evaluation tests.
const GOOD_TRANSCRIPT = loadTranscriptFixture('good.json');
const SAMPLE: EvaluationInput = {
  roleLabel: 'Software Engineer',
  turns: GOOD_TRANSCRIPT,
};

const VALID = JSON.stringify({
  summary: 'Clear, concrete answers about asynchronous architecture and idempotency.',
  scores: RUBRIC.map((r, i) => ({ category: r.category, score: 3 + (i % 2), comment: 'Specific and relevant.' })),
});

describe('FB4 — evaluator', () => {
  it('validates all hand-written transcript fixtures against the TurnSpeaker contract and turn constraints', () => {
    const fixtureNames = ['excellent.json', 'good.json', 'average.json', 'weak.json', 'empty-answers.json'] as const;
    for (const name of fixtureNames) {
      const turns = loadTranscriptFixture(name);
      expect(turns.length).toBeGreaterThanOrEqual(6);
      expect(turns.length).toBeLessThanOrEqual(10);
      for (const turn of turns) {
        expect(['AI', 'CANDIDATE']).toContain(turn.speaker);
        expect(typeof turn.text).toBe('string');
      }
    }
  });

  it('given a transcript and a role, returns feedback scored against every rubric category', async () => {
    const result = await evaluateTranscript(SAMPLE, { generate: async () => VALID });
    expect(result.summary).toBe('Clear, concrete answers about asynchronous architecture and idempotency.');
    expect(result.scores.map((s) => s.category).sort()).toEqual(RUBRIC.map((r) => r.category).sort());
  });

  it('puts the role, the rubric and both speakers into the prompt', () => {
    const prompt = buildEvaluationPrompt(SAMPLE);
    expect(prompt).toContain('Software Engineer');
    for (const r of RUBRIC) expect(prompt).toContain(r.category);
    expect(prompt).toContain('Interviewer: Welcome to the Software Engineer interview.');
    expect(prompt).toContain('Candidate: I would decouple the notification requests');
  });

  it('given the LLM call times out, then it fails well inside the 15-second budget', async () => {
    const started = Date.now();
    await expect(
      evaluateTranscript(SAMPLE, { generate: () => new Promise(() => {}), timeoutMs: 50 })
    ).rejects.toThrow('timed out');
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('given the LLM call fails, then the error is passed on', async () => {
    await expect(
      evaluateTranscript(SAMPLE, { generate: async () => { throw new Error('503 from provider'); } })
    ).rejects.toThrow('503 from provider');
  });

  it('given a reply that is not JSON, then it fails', async () => {
    await expect(evaluateTranscript(SAMPLE, { generate: async () => 'Great interview!' })).rejects.toThrow(
      'valid JSON'
    );
  });

  it('given scores outside 1–5 or a missing category, then it fails', async () => {
    const outOfRange = JSON.stringify({
      summary: 'x',
      scores: RUBRIC.map((r) => ({ category: r.category, score: 9, comment: 'x' })),
    });
    await expect(evaluateTranscript(SAMPLE, { generate: async () => outOfRange })).rejects.toThrow();

    const missing = JSON.stringify({
      summary: 'x',
      scores: [{ category: 'Communication', score: 4, comment: 'x' }],
    });
    await expect(evaluateTranscript(SAMPLE, { generate: async () => missing })).rejects.toThrow(
      'instead of the rubric categories'
    );
  });

  it('given a transcript with no candidate answers, then it fails without calling the LLM', async () => {
    const emptyTranscript = loadTranscriptFixture('empty-answers.json');
    let called = false;
    await expect(
      evaluateTranscript(
        { roleLabel: 'Software Engineer', turns: emptyTranscript },
        { generate: async () => { called = true; return VALID; } }
      )
    ).rejects.toThrow('no candidate answers');
    expect(called).toBe(false);
  });
});
