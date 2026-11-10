import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { TurnSpeaker } from '@interview/contracts';
import {
  evaluateTranscript,
  buildEvaluationPrompt,
  evaluationSchema,
  type EvaluationInput,
  type TranscriptTurn,
} from '../services/evaluator.service';
import { getRubric, UnknownRoleError } from '../services/rubrics';

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
  roleId: 'software-engineer',
  turns: GOOD_TRANSCRIPT,
};
const RUBRIC = getRubric('software-engineer');

function scoreFor(category: string, score = 4) {
  return {
    category,
    score,
    comment: 'Specific and relevant.',
    strengths: ['Explained the trade-off'],
    improvements: ['Quantify the impact'],
    quote: 'I would decouple the notification requests',
  };
}

const VALID = JSON.stringify({
  summary: 'Clear, concrete answers about asynchronous architecture and idempotency.',
  scores: RUBRIC.map((r, i) => scoreFor(r.category, 3 + (i % 2))),
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
    const result = await evaluateTranscript(SAMPLE, { generate: async () => ({ text: VALID }) });
    expect(result.summary).toBe('Clear, concrete answers about asynchronous architecture and idempotency.');
    expect(result.scores.map((s) => s.category).sort()).toEqual(RUBRIC.map((r) => r.category).sort());
  });

  it('returns usageMetadata when provided by the generator', async () => {
    const result = await evaluateTranscript(SAMPLE, {
      generate: async () => ({
        text: VALID,
        usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 80, totalTokenCount: 230 },
      }),
    });
    expect(result.usageMetadata).toEqual({
      promptTokenCount: 150,
      candidatesTokenCount: 80,
      totalTokenCount: 230,
    });
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
    await expect(evaluateTranscript(SAMPLE, { generate: async () => ({ text: 'Great interview!' }) })).rejects.toThrow(
      'valid JSON'
    );
  });

  it('given scores outside 1–5 or a missing category, then it fails', async () => {
    const outOfRange = JSON.stringify({
      summary: 'x',
      scores: RUBRIC.map((r) => scoreFor(r.category, 9)),
    });
    await expect(evaluateTranscript(SAMPLE, { generate: async () => ({ text: outOfRange }) })).rejects.toThrow();

    const missing = JSON.stringify({
      summary: 'x',
      scores: [scoreFor(RUBRIC[0].category)],
    });
    await expect(evaluateTranscript(SAMPLE, { generate: async () => ({ text: missing }) })).rejects.toThrow(
      'instead of the rubric categories'
    );
  });

  it('given a transcript with no candidate answers, then it fails without calling the LLM', async () => {
    const emptyTranscript = loadTranscriptFixture('empty-answers.json');
    let called = false;
    await expect(
      evaluateTranscript(
        { roleId: 'software-engineer', turns: emptyTranscript },
        { generate: async () => { called = true; return { text: VALID }; } }
      )
    ).rejects.toThrow('no candidate answers');
    expect(called).toBe(false);
  });

  it('gives each role its own rubric categories', () => {
    expect(getRubric('software-engineer').map((r) => r.category)).toContain('Problem Solving & Algorithms');
    expect(getRubric('data-analyst').map((r) => r.category)).toContain('SQL & Analytical Reasoning');
    expect(getRubric('backend-developer').map((r) => r.category)).toContain('Database Modeling & Performance');
  });

  it('rejects a role without a rubric', () => {
    expect(() => getRubric('product-manager')).toThrow(UnknownRoleError);
  });

  it.each(['software-engineer', 'data-analyst', 'backend-developer'])(
    "puts the %s rubric into the prompt and checks the reply against it",
    async (roleId) => {
      const rubric = getRubric(roleId);
      const input = { roleId, turns: GOOD_TRANSCRIPT };
      for (const r of rubric) expect(buildEvaluationPrompt(input)).toContain(r.category);

      const reply = JSON.stringify({ summary: 'x', scores: rubric.map((r) => scoreFor(r.category)) });
      const result = await evaluateTranscript(input, { generate: async () => ({ text: reply }) });
      expect(result.scores).toHaveLength(rubric.length);
    }
  );

  it('asks for STAR only on behavioural answers, and for strengths, improvements and a quote', () => {
    const prompt = buildEvaluationPrompt(SAMPLE);
    expect(prompt).toContain('STAR');
    expect(prompt).toMatch(/DO NOT force STAR onto purely technical/);
    expect(prompt).toContain('"strengths"');
    expect(prompt).toContain('"improvements"');
    expect(prompt).toContain('"quote"');
  });

  it("limits Gemini's structured output to the role's rubric categories", () => {
    const categories = getRubric('data-analyst').map((r) => r.category);
    const item = evaluationSchema(categories).properties?.scores?.items;

    expect(item?.properties?.category?.enum).toEqual(categories);
    expect(item?.required).toEqual(['category', 'score', 'comment', 'strengths', 'improvements', 'quote']);
  });
});
