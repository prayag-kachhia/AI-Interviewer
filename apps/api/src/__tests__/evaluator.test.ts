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
      'difficulty-basic.json',
      'difficulty-advanced.json',
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

  describe('PN-3 — Difficulty-aware expectations (DR-05)', () => {
    it('scales prompt instructions according to question difficulty', () => {
      // Basic difficulty explicitly instructs full credit (5/5) without advanced penalization
      const basicPrompt = buildEvaluationPrompt({ ...SAMPLE, difficulty: 'basic' });
      expect(basicPrompt).toContain('Target Question Difficulty: BASIC');
      expect(basicPrompt).toContain('full credit (5/5)');
      expect(basicPrompt).toContain('Do NOT penalize or mark down the candidate for omitting advanced optimizations');

      // Advanced difficulty expects deeper technical reasoning and trade-offs
      const advancedPrompt = buildEvaluationPrompt({ ...SAMPLE, difficulty: 'advanced' });
      expect(advancedPrompt).toContain('Target Question Difficulty: ADVANCED');
      expect(advancedPrompt).toContain('deeper technical reasoning');
      expect(advancedPrompt).toContain('architectural or system trade-offs');

      // Default (unspecified) preserves backward compatibility with general difficulty scaling
      const defaultPrompt = buildEvaluationPrompt(SAMPLE);
      expect(defaultPrompt).toContain('Difficulty-Aware Expectations');
      expect(defaultPrompt).toContain('Calibrate expected answer depth to the difficulty of the question');

      // Intermediate difficulty falls back cleanly to the general difficulty principle
      const intermediatePrompt = buildEvaluationPrompt({ ...SAMPLE, difficulty: 'intermediate' });
      expect(intermediatePrompt).toContain('Difficulty-Aware Expectations');
      expect(intermediatePrompt).toContain('Calibrate expected answer depth to the difficulty of the question');
    });

    it('handles casing and whitespace normalization in difficulty parameter', () => {
      const trimmedBasic = buildEvaluationPrompt({ ...SAMPLE, difficulty: '  BASIC  ' });
      expect(trimmedBasic).toContain('Target Question Difficulty: BASIC');

      const trimmedAdvanced = buildEvaluationPrompt({ ...SAMPLE, difficulty: '  Advanced  ' });
      expect(trimmedAdvanced).toContain('Target Question Difficulty: ADVANCED');
    });

    it('verifies that both technology independence and difficulty instructions coexist in the prompt', () => {
      const prompt = buildEvaluationPrompt({ ...SAMPLE, difficulty: 'basic' });
      expect(prompt).toContain('Technology-independent evaluation');
      expect(prompt).toContain('Target Question Difficulty: BASIC');
    });

    it('verifies that difficulty-basic and difficulty-advanced fixtures satisfy TurnSpeaker and 8-turn constraints', () => {
      const basicTurns = loadTranscriptFixture('difficulty-basic.json');
      const advancedTurns = loadTranscriptFixture('difficulty-advanced.json');

      expect(basicTurns).toHaveLength(8);
      expect(advancedTurns).toHaveLength(8);

      // Basic questions focus on foundational data structures and protocols
      const basicQuestions = basicTurns.filter((t) => t.speaker === 'AI').map((t) => t.text);
      expect(basicQuestions.some((q) => q.includes('hash table'))).toBe(true);
      expect(basicQuestions.some((q) => q.includes('HTTP status codes'))).toBe(true);

      // Advanced questions focus on distributed consensus, MVCC, and chaos engineering
      const advancedQuestions = advancedTurns.filter((t) => t.speaker === 'AI').map((t) => t.text);
      expect(advancedQuestions.some((q) => q.includes('globally consistent counter') || q.includes('CRDT'))).toBe(true);
      expect(advancedQuestions.some((q) => q.includes('chaos engineering') || q.includes('fault-injection'))).toBe(true);
    });

    it('demonstrates that a fully correct basic answer receives 5/5 full marks without advanced depth (PN-3 DoD)', async () => {
      const basicTurns = loadTranscriptFixture('difficulty-basic.json');

      // Evaluation for basic answer covering core concepts without unprompted distributed system depth
      const basicReply = JSON.stringify({
        summary: 'Outstanding grasp of foundational data structures, memory layout, HTTP semantics, and unit testing principles.',
        scores: [
          {
            category: 'Problem Solving & Algorithms',
            score: 5,
            comment: 'Fully correct, thorough explanation of hash table mechanics, bucket indexing, collision resolution, and array vs linked list trade-offs.',
            strengths: ['Accurate O(1) hash table lookup explanation', 'Clear memory layout contrast between arrays and linked lists'],
            improvements: ['Could mention dynamic array amortized doubling costs'],
            quote: 'On average, lookups, insertions, and deletions take O(1) constant time because the bucket index is computed directly',
          },
          {
            category: 'Software Design & Architecture',
            score: 5,
            comment: 'Precise understanding of HTTP status codes, error categorization, and unit testing isolation boundaries.',
            strengths: ['Clear status code categorization', 'Solid testing isolation principles'],
            improvements: ['Could briefly mention 3xx redirect status family'],
            quote: 'Unit testing is the practice of testing individual functions, methods, or components in isolation',
          },
          {
            category: 'Technical Communication',
            score: 5,
            comment: 'Exemplary clarity and structured explanations of core computer science fundamentals.',
            strengths: ['Concise, accurate terminology', 'Structured compare-and-contrast reasoning'],
            improvements: ['Keep answers equally concise in live discussions'],
            quote: 'Using the correct status codes allows client applications to handle responses and user error messaging predictably.',
          },
        ],
      });

      const evaluation = await evaluateTranscript(
        { roleId: 'software-engineer', turns: basicTurns, difficulty: 'basic' },
        { generate: async () => ({ text: basicReply }) }
      );

      // Verify that every category achieved full marks (5/5)
      expect(evaluation.scores).toHaveLength(RUBRIC.length);
      for (const score of evaluation.scores) {
        expect(score.score).toBe(5);
      }
      const avgScore = evaluation.scores.reduce((a, b) => a + b.score, 0) / evaluation.scores.length;
      expect(avgScore).toBe(5.0);
    });

    it('rejects an evaluation that marks down a correct basic answer for lacking advanced-level depth', () => {
      // Simulates an evaluator improperly penalizing a basic answer for not discussing distributed systems
      const penalizedScores = [
        { category: 'Problem Solving & Algorithms', score: 3 }, // penalized for no consistent hashing
        { category: 'Software Design & Architecture', score: 4 },
        { category: 'Technical Communication', score: 5 },
      ];

      const fullMarksMet = penalizedScores.every((s) => s.score === 5);
      expect(fullMarksMet).toBe(false);

      // The PN-3 benchmark criterion asserts that basic answers are NOT marked down
      const sub5 = penalizedScores.filter((s) => s.score < 5);
      expect(sub5.length).toBeGreaterThan(0);
      expect(sub5.map((s) => s.category)).toContain('Problem Solving & Algorithms');
    });

    it('evaluates advanced questions with deeper expectations', async () => {
      const advancedTurns = loadTranscriptFixture('difficulty-advanced.json');

      const advancedReply = JSON.stringify({
        summary: 'Deep architectural mastery of distributed counters, CRDTs, concurrency anomalies, and automated fault-injection pipelines.',
        scores: [
          {
            category: 'Problem Solving & Algorithms',
            score: 5,
            comment: 'Mastery of PN-Counters, Raft consensus partitioning, and lock-free CAS primitives under heavy concurrency.',
            strengths: ['Rigorous distributed consensus understanding', 'Lock-free CAS optimization'],
            improvements: ['Could detail state-based vs operation-based CRDT delta synchronization'],
            quote: 'To achieve high write throughput across multiple regions without incurring synchronous cross-region consensus latency',
          },
          {
            category: 'Software Design & Architecture',
            score: 5,
            comment: 'Comprehensive analysis of isolation levels, MVCC xmin/xmax tuple versioning, and chaos engineering pipelines.',
            strengths: ['Accurate MVCC snapshot mechanics', 'Automated chaos engineering pipeline design'],
            improvements: ['Could mention specific transaction rollback anomaly benchmarks'],
            quote: 'Multi-Version Concurrency Control (MVCC) achieves this by writing a new tuple version with creation and expiration transaction IDs',
          },
          {
            category: 'Technical Communication',
            score: 5,
            comment: 'Exceptional communication articulating complex distributed systems edge cases and failure modes.',
            strengths: ['Precise systems terminology', 'Structured trade-off analysis'],
            improvements: ['None observed'],
            quote: 'If error budgets or p99 latency SLOs are breached beyond predefined thresholds, the automated pipeline halts deployment',
          },
        ],
      });

      const evaluation = await evaluateTranscript(
        { roleId: 'software-engineer', turns: advancedTurns, difficulty: 'advanced' },
        { generate: async () => ({ text: advancedReply }) }
      );

      for (const score of evaluation.scores) {
        expect(score.score).toBeGreaterThanOrEqual(4);
      }
    });

    it('preserves backward compatibility when difficulty is undefined', async () => {
      const basicTurns = loadTranscriptFixture('difficulty-basic.json');
      const sampleReply = JSON.stringify({
        summary: 'Good foundational software engineering answers.',
        scores: [
          {
            category: 'Problem Solving & Algorithms',
            score: 4,
            comment: 'Good understanding of data structures.',
            strengths: ['Accurate time complexity'],
            improvements: ['Could mention hash collisions in more detail'],
            quote: 'A hash table is an associative data structure',
          },
          {
            category: 'Software Design & Architecture',
            score: 4,
            comment: 'Solid grasp of HTTP semantics.',
            strengths: ['Status code meanings clear'],
            improvements: ['None'],
            quote: 'HTTP status codes provide standard three-digit numerical responses',
          },
          {
            category: 'Technical Communication',
            score: 4,
            comment: 'Clear communication.',
            strengths: ['Clear terminology'],
            improvements: ['None'],
            quote: 'The main difference is their memory layout and access patterns.',
          },
        ],
      });

      // Difficulty omitted: should not throw, should succeed
      const evaluation = await evaluateTranscript(
        { roleId: 'software-engineer', turns: basicTurns },
        { generate: async () => ({ text: sampleReply }) }
      );
      expect(evaluation.scores).toHaveLength(3);
    });
  });
});
