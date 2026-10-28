import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { TurnSpeaker } from '@interview/contracts';
import {
  evaluateTranscript,
  buildEvaluationPrompt,
  RUBRIC,
  type TranscriptTurn,
} from '../services/evaluator.service';

// One hand-written interview per quality level, shared by the evaluator, the benchmark and
// the results screen so they all test against the same material.
const TranscriptFixture = z.array(z.object({ speaker: TurnSpeaker, text: z.string() }));

function loadTranscript(name: string): TranscriptTurn[] {
  const url = new URL(`./fixtures/transcripts/${name}.json`, import.meta.url);
  return TranscriptFixture.parse(JSON.parse(readFileSync(url, 'utf8')));
}

// A realistic "good" interview from the fixtures. The LLM call is always replaced; no test
// reaches Gemini.
const SAMPLE = {
  roleLabel: 'Software Engineer',
  turns: loadTranscript('good'),
};

const VALID = JSON.stringify({
  summary: 'Clear, concrete answers about API design.',
  scores: RUBRIC.map((r, i) => ({ category: r.category, score: 3 + (i % 2), comment: 'Specific and relevant.' })),
});

describe('FB4 — evaluator', () => {
  it('given a transcript and a role, returns feedback scored against every rubric category', async () => {
    const result = await evaluateTranscript(SAMPLE, { generate: async () => VALID });
    expect(result.summary).toBe('Clear, concrete answers about API design.');
    expect(result.scores.map((s) => s.category).sort()).toEqual(RUBRIC.map((r) => r.category).sort());
  });

  it('puts the role, the rubric and both speakers into the prompt', () => {
    const prompt = buildEvaluationPrompt(SAMPLE);
    expect(prompt).toContain('Software Engineer');
    for (const r of RUBRIC) expect(prompt).toContain(r.category);
    const interviewer = SAMPLE.turns.find((t) => t.speaker === 'AI');
    const candidate = SAMPLE.turns.find((t) => t.speaker === 'CANDIDATE');
    expect(prompt).toContain(`Interviewer: ${interviewer?.text}`);
    expect(prompt).toContain(`Candidate: ${candidate?.text}`);
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
    let called = false;
    await expect(
      evaluateTranscript(
        { roleLabel: 'Software Engineer', turns: loadTranscript('empty-answers') },
        { generate: async () => { called = true; return VALID; } }
      )
    ).rejects.toThrow('no candidate answers');
    expect(called).toBe(false);
  });
});
