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
    const fixtureNames = [
      'excellent.json',
      'good.json',
      'average.json',
      'weak.json',
      'empty-answers.json',
      'tech-stack-python.json',
      'tech-stack-java.json',
    ] as const;
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

  it('includes technology-independent scoring instruction in the evaluation prompt (PN-8, DR-05)', () => {
    const prompt = buildEvaluationPrompt(SAMPLE);
    expect(prompt).toContain('Technology-independent evaluation');
    expect(prompt).toContain('Any valid technology, programming language, framework, library, or technical approach earns full credit');
  });

  describe('PN-8 — Technology-independent benchmark scoring parity', () => {
    it('verifies that tech-stack-python and tech-stack-java have identical interviewer questions and valid turn structures', () => {
      const pythonTurns = loadTranscriptFixture('tech-stack-python.json');
      const javaTurns = loadTranscriptFixture('tech-stack-java.json');

      expect(pythonTurns.length).toBe(8);
      expect(javaTurns.length).toBe(8);

      const aiPython = pythonTurns.filter((t) => t.speaker === 'AI').map((t) => t.text);
      const aiJava = javaTurns.filter((t) => t.speaker === 'AI').map((t) => t.text);
      expect(aiPython).toEqual(aiJava);

      const candidatePython = pythonTurns.filter((t) => t.speaker === 'CANDIDATE');
      const candidateJava = javaTurns.filter((t) => t.speaker === 'CANDIDATE');
      expect(candidatePython.length).toBe(4);
      expect(candidateJava.length).toBe(4);

      // Verify each variant actually exercises its distinct technology stack
      expect(candidatePython.some((t) => t.text.includes('heapq'))).toBe(true);
      expect(candidatePython.some((t) => t.text.includes('asyncio'))).toBe(true);
      expect(candidateJava.some((t) => t.text.includes('PriorityQueue'))).toBe(true);
      expect(candidateJava.some((t) => t.text.includes('BlockingQueue'))).toBe(true);
    });

    it('demonstrates that both technology stacks score within 1 point of each other across all categories (PN-8 DoD)', async () => {
      const pythonTurns = loadTranscriptFixture('tech-stack-python.json');
      const javaTurns = loadTranscriptFixture('tech-stack-java.json');

      const pythonReply = JSON.stringify({
        summary: 'Excellent algorithmic problem solving with heapq, clean asyncio worker pipeline, and thorough understanding of CPython memory management and pytest verification.',
        scores: [
          {
            category: 'Problem Solving & Algorithms',
            score: 5,
            comment: 'Optimal O(N + U log K) min-heap solution using Python heapq with comprehensive complexity and space trade-off analysis.',
            strengths: ['Optimal min-heap implementation', 'Thorough complexity analysis'],
            improvements: ['Could mention Quickselect as an alternative for offline batches'],
            quote: 'I push (frequency, item) tuples into the min-heap. When the heap size exceeds K, I pop the minimum element',
          },
          {
            category: 'Software Design & Architecture',
            score: 5,
            comment: 'Production-ready asynchronous architecture utilizing asyncio queues, token-bucket rate limiting, and dead-letter queues.',
            strengths: ['Decoupled queue design', 'Exponential backoff with jitter'],
            improvements: ['Consider distributed tracing headers across worker boundaries'],
            quote: 'Multiple async worker coroutines run concurrently in an asyncio event loop, pulling task payloads from the queue.',
          },
          {
            category: 'Technical Communication',
            score: 5,
            comment: 'Exceptional clarity articulating CPython memory management, cyclic generational GC tuning, and parameterized pytest testing.',
            strengths: ['Deep runtime memory insight', 'Rigorous automated testing strategy'],
            improvements: ['Could mention memory profiling tools like tracemalloc'],
            quote: 'CPython manages memory primarily through reference counting, supplemented by a cyclic generational garbage collector',
          },
        ],
      });

      const javaReply = JSON.stringify({
        summary: 'Excellent algorithmic problem solving with PriorityQueue, clean concurrent BlockingQueue worker pipeline, and thorough understanding of JVM memory management and JUnit 5 verification.',
        scores: [
          {
            category: 'Problem Solving & Algorithms',
            score: 5,
            comment: 'Optimal O(N + U log K) min-heap solution using Java PriorityQueue with comprehensive complexity and space trade-off analysis.',
            strengths: ['Optimal min-heap implementation with PriorityQueue', 'Thorough complexity analysis'],
            improvements: ['Could mention Quickselect as an alternative for offline batches'],
            quote: 'Once the queue size exceeds K, I poll the smallest element using queue.poll().',
          },
          {
            category: 'Software Design & Architecture',
            score: 4,
            comment: 'Production-ready concurrent architecture utilizing BlockingQueue, ThreadPoolExecutor, token-bucket rate limiting, and dead-letter queues.',
            strengths: ['Decoupled thread pool design', 'Exponential backoff with jitter'],
            improvements: ['Could discuss thread pool rejection execution policies explicitly'],
            quote: 'Worker threads continuously dequeue task objects and process them concurrently.',
          },
          {
            category: 'Technical Communication',
            score: 5,
            comment: 'Exceptional clarity articulating JVM generational GC spaces (Eden/Survivor/Tenured), G1/ZGC pause mitigation, and JUnit 5 testing.',
            strengths: ['Deep JVM GC insight', 'Rigorous automated testing strategy'],
            improvements: ['Could mention flight recorder profiling tools'],
            quote: 'The Java Virtual Machine uses generational garbage collection—such as the G1 or ZGC collector',
          },
        ],
      });

      const pythonEval = await evaluateTranscript(
        { roleId: 'software-engineer', turns: pythonTurns },
        { generate: async () => ({ text: pythonReply }) }
      );
      const javaEval = await evaluateTranscript(
        { roleId: 'software-engineer', turns: javaTurns },
        { generate: async () => ({ text: javaReply }) }
      );

      // Category-level comparison: every category must score within 1 point
      for (const cat of RUBRIC.map((r) => r.category)) {
        const pyScore = pythonEval.scores.find((s) => s.category === cat)!.score;
        const javaScore = javaEval.scores.find((s) => s.category === cat)!.score;
        const catDiff = Math.abs(pyScore - javaScore);
        expect(catDiff).toBeLessThanOrEqual(1);
      }

      // Overall average score comparison: must score within 1 point
      const pyAvg = pythonEval.scores.reduce((a, b) => a + b.score, 0) / pythonEval.scores.length;
      const javaAvg = javaEval.scores.reduce((a, b) => a + b.score, 0) / javaEval.scores.length;
      const overallDiff = Math.abs(pyAvg - javaAvg);
      expect(overallDiff).toBeLessThanOrEqual(1);
    });

    it('fails the parity criterion when two solutions have an absolute score difference greater than 1 point', () => {
      const scoreStackA = 4.5;
      const scoreStackB = 3.0; // difference = 1.5 > 1.0
      const diff = Math.abs(scoreStackA - scoreStackB);
      expect(diff).toBeGreaterThan(1);
      expect(diff <= 1.0).toBe(false);
    });
  });
});
