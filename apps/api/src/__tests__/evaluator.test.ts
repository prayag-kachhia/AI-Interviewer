import { describe, it, expect } from 'vitest';
import { evaluateTranscript, buildEvaluationPrompt, RUBRIC } from '../services/evaluator.service';

// A short sample interview. The LLM call is always replaced; no test reaches Gemini.
const SAMPLE = {
  roleLabel: 'Backend Developer',
  turns: [
    { speaker: 'AI' as const, text: 'Tell me about an API you designed.' },
    { speaker: 'CANDIDATE' as const, text: 'I built a REST API for orders with Postgres and added idempotency keys.' },
    { speaker: 'AI' as const, text: 'How did you handle retries?' },
    { speaker: 'CANDIDATE' as const, text: 'Clients retry with the same key, so the server returns the first result.' },
  ],
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
    expect(prompt).toContain('Backend Developer');
    for (const r of RUBRIC) expect(prompt).toContain(r.category);
    expect(prompt).toContain('Interviewer: Tell me about an API you designed.');
    expect(prompt).toContain('Candidate: Clients retry with the same key');
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
        { roleLabel: 'Data Analyst', turns: [{ speaker: 'AI', text: 'Tell me about yourself.' }] },
        { generate: async () => { called = true; return VALID; } }
      )
    ).rejects.toThrow('no candidate answers');
    expect(called).toBe(false);
  });
});
