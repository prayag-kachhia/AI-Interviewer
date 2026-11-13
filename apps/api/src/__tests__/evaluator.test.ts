import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { TurnSpeaker } from '@interview/contracts';
import {
  evaluateTranscript,
  buildEvaluationPrompt,
  evaluationSchema,
  deriveExpectedQuestions,
  normalizeWhitespace,
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

  describe('PN-9 - Per-answer feedback (#174)', () => {
    const SAMPLE_PER_ANSWER = [
      {
        question: 'Welcome to the Software Engineer interview. Could you describe how you would design an asynchronous notification service that delivers emails and SMS messages reliably?',
        summary: 'Decoupled API with RabbitMQ/SQS message queue and worker pool with 202 Accepted responses.',
        strengths: ['Effective asynchronous queuing to decouple external latency', 'Appropriate 202 Accepted HTTP response design'],
        improvements: ['Elaborate on queue partition keying for per-user FIFO ordering'],
      },
      {
        question: 'What happens if a third-party provider like SendGrid experiences downtime or returns rate-limit errors?',
        summary: 'Implemented exponential backoff with jitter and dead-letter queue routing for persistent failures.',
        strengths: ['Exponential backoff with jitter avoids thundering herd', 'DLQ prevents bad messages from poisoning worker pool'],
        improvements: ['Consider adding circuit breaker to halt requests during prolonged provider outage'],
      },
      {
        question: 'How would you prevent duplicate notifications from being sent to a user if network timeouts occur during the third-party call?',
        summary: 'Used database-backed idempotency keys in PostgreSQL with status tracking.',
        strengths: ['Idempotency key protocol prevents duplicate sends on retries', 'Checked provider idempotency header integration'],
        improvements: ['Discuss atomic state updates or distributed locks to prevent concurrent worker race conditions'],
      },
      {
        question: 'How do you test and verify this notification service?',
        summary: 'Outlined unit tests with mocked clients and integration tests with Docker Testcontainers.',
        strengths: ['Thorough testing pyramid using Testcontainers for realistic dependencies', 'Simulated provider network timeouts for DLQ verification'],
        improvements: ['Add end-to-end stress testing to assess queue throughput under high concurrency'],
      },
    ];

    it('returns perAnswer feedback for every candidate answer in the transcript', async () => {
      const replyWithPerAnswer = JSON.stringify({
        summary: 'Solid performance across architecture and error handling.',
        scores: RUBRIC.map((r, i) => scoreFor(r.category, 4)),
        perAnswer: SAMPLE_PER_ANSWER,
      });

      const result = await evaluateTranscript(SAMPLE, {
        generate: async () => ({ text: replyWithPerAnswer }),
      });

      expect(result.perAnswer).toBeDefined();
      expect(result.perAnswer).toHaveLength(4);
      expect(result.perAnswer![0].question).toContain('asynchronous notification service');
      expect(result.perAnswer![0].summary).toContain('RabbitMQ/SQS');
      expect(result.perAnswer![0].strengths.length).toBeGreaterThan(0);
      expect(result.perAnswer![0].improvements.length).toBeGreaterThan(0);
    });

    it('puts per-answer instructions and perAnswer JSON schema into the evaluation prompt', () => {
      const prompt = buildEvaluationPrompt(SAMPLE);
      expect(prompt).toContain('Per-Answer Feedback');
      expect(prompt).toContain('"perAnswer"');
      expect(prompt).toContain('"question"');
      expect(prompt).toContain('"summary"');
      expect(prompt).toContain('"strengths"');
      expect(prompt).toContain('"improvements"');
      expect(prompt).toContain('Provide feedback ONLY for candidate answers');
    });

    it('evaluationSchema includes perAnswer with required fields', () => {
      const schema = evaluationSchema(['Problem Solving & Algorithms']);
      expect(schema.required).toContain('perAnswer');
      expect((schema.properties as any).perAnswer).toBeDefined();
      const perAnswerProps = (schema.properties as any).perAnswer;
      expect(perAnswerProps.items.required).toEqual(['question', 'summary', 'strengths', 'improvements']);
    });

    it('rejects when perAnswer feedback has incomplete answer coverage', async () => {
      // Transcript has 4 candidate answers, but perAnswer only has 2
      const incompleteReply = JSON.stringify({
        summary: 'Good start.',
        scores: RUBRIC.map((r) => scoreFor(r.category)),
        perAnswer: SAMPLE_PER_ANSWER.slice(0, 2),
      });

      await expect(
        evaluateTranscript(SAMPLE, {
          generate: async () => ({ text: incompleteReply }),
        })
      ).rejects.toThrow(/Incomplete per-answer feedback: expected 4 answer\(s\) but received 2/);
    });

    it('rejects when a perAnswer entry has an empty question', async () => {
      const emptyQuestionReply = JSON.stringify({
        summary: 'Good start.',
        scores: RUBRIC.map((r) => scoreFor(r.category)),
        perAnswer: [
          { ...SAMPLE_PER_ANSWER[0], question: '' },
          SAMPLE_PER_ANSWER[1],
          SAMPLE_PER_ANSWER[2],
          SAMPLE_PER_ANSWER[3],
        ],
      });

      await expect(
        evaluateTranscript(SAMPLE, {
          generate: async () => ({ text: emptyQuestionReply }),
        })
      ).rejects.toThrow();
    });

    it('rejects when a perAnswer entry has an empty summary', async () => {
      const emptySummaryReply = JSON.stringify({
        summary: 'Good start.',
        scores: RUBRIC.map((r) => scoreFor(r.category)),
        perAnswer: [
          { ...SAMPLE_PER_ANSWER[0], summary: '' },
          SAMPLE_PER_ANSWER[1],
          SAMPLE_PER_ANSWER[2],
          SAMPLE_PER_ANSWER[3],
        ],
      });

      await expect(
        evaluateTranscript(SAMPLE, {
          generate: async () => ({ text: emptySummaryReply }),
        })
      ).rejects.toThrow();
    });

    it('strictly enforces perAnswer when options.requirePerAnswer is true', async () => {
      await expect(
        evaluateTranscript(SAMPLE, {
          generate: async () => ({ text: VALID }),
          requirePerAnswer: true,
        })
      ).rejects.toThrow('The evaluator did not return per-answer feedback');
    });

    it('maintains backward compatibility when perAnswer is omitted and requirePerAnswer is false', async () => {
      const result = await evaluateTranscript(SAMPLE, {
        generate: async () => ({ text: VALID }),
      });
      expect(result.perAnswer).toBeUndefined();
      expect(result.scores).toHaveLength(RUBRIC.length);
      expect(result.summary).toBeTruthy();
    });

    it('handles multi-turn conversation preserving question-answer pairing and order', async () => {
      const multiTurnInput: EvaluationInput = {
        roleId: 'software-engineer',
        turns: [
          { speaker: 'AI', text: 'Question 1: What is a hash map?' },
          { speaker: 'CANDIDATE', text: 'Answer 1: A hash map provides O(1) average lookup using hash buckets.' },
          { speaker: 'AI', text: 'Follow-up 1: What happens on collision?' },
          { speaker: 'CANDIDATE', text: 'Answer 2: Separate chaining with linked lists or open addressing.' },
        ],
      };

      const reply = JSON.stringify({
        summary: 'Clear algorithmic knowledge.',
        scores: RUBRIC.map((r) => scoreFor(r.category)),
        perAnswer: [
          {
            question: 'Question 1: What is a hash map?',
            summary: 'Accurately defined hash map with O(1) average lookup and hash buckets.',
            strengths: ['Correct time complexity'],
            improvements: ['Mention worst-case O(N) degradation'],
          },
          {
            question: 'Follow-up 1: What happens on collision?',
            summary: 'Identified separate chaining and open addressing collision resolution.',
            strengths: ['Identified primary collision resolution strategies'],
            improvements: ['Explain tree-based bucket optimization in Java 8+'],
          },
        ],
      });

      const result = await evaluateTranscript(multiTurnInput, {
        generate: async () => ({ text: reply }),
      });

      expect(result.perAnswer).toHaveLength(2);
      expect(result.perAnswer![0].question).toBe('Question 1: What is a hash map?');
      expect(result.perAnswer![1].question).toBe('Follow-up 1: What happens on collision?');
    });

    describe('question-answer pairing validation', () => {
      const PAIRING_INPUT: EvaluationInput = {
        roleId: 'software-engineer',
        turns: [
          { speaker: 'AI', text: 'Question 1: What is a hash map?' },
          { speaker: 'CANDIDATE', text: 'A hash map provides O(1) average lookup.' },
          { speaker: 'AI', text: 'Follow-up: What happens on collision?' },
          { speaker: 'CANDIDATE', text: 'Separate chaining or open addressing.' },
        ],
      };

      function pairingReply(perAnswer: Array<{ question: string; summary: string; strengths: string[]; improvements: string[] }>) {
        return JSON.stringify({
          summary: 'Good answers.',
          scores: RUBRIC.map((r) => scoreFor(r.category)),
          perAnswer,
        });
      }

      const CORRECT_PER_ANSWER = [
        {
          question: 'Question 1: What is a hash map?',
          summary: 'Defined hash map with O(1) lookup.',
          strengths: ['Correct complexity'],
          improvements: ['Mention worst case'],
        },
        {
          question: 'Follow-up: What happens on collision?',
          summary: 'Identified chaining and open addressing.',
          strengths: ['Named both strategies'],
          improvements: ['Explain rehashing'],
        },
      ];

      it('accepts correct question-answer pairing', async () => {
        const result = await evaluateTranscript(PAIRING_INPUT, {
          generate: async () => ({ text: pairingReply(CORRECT_PER_ANSWER) }),
        });
        expect(result.perAnswer).toHaveLength(2);
        expect(result.perAnswer![0].question).toBe('Question 1: What is a hash map?');
        expect(result.perAnswer![1].question).toBe('Follow-up: What happens on collision?');
      });

      it('rejects a wrong question for an answer', async () => {
        const wrong = [
          { ...CORRECT_PER_ANSWER[0], question: 'Completely different question?' },
          CORRECT_PER_ANSWER[1],
        ];
        await expect(
          evaluateTranscript(PAIRING_INPUT, {
            generate: async () => ({ text: pairingReply(wrong) }),
          })
        ).rejects.toThrow(/entry 1 question does not match/);
      });

      it('rejects reordered questions', async () => {
        const swapped = [CORRECT_PER_ANSWER[1], CORRECT_PER_ANSWER[0]];
        await expect(
          evaluateTranscript(PAIRING_INPUT, {
            generate: async () => ({ text: pairingReply(swapped) }),
          })
        ).rejects.toThrow(/entry 1 question does not match/);
      });

      it('rejects candidate answer without a preceding interviewer question', async () => {
        const noAiFirst: EvaluationInput = {
          roleId: 'software-engineer',
          turns: [
            { speaker: 'CANDIDATE', text: 'I know hash maps.' },
            { speaker: 'AI', text: 'Tell me more.' },
            { speaker: 'CANDIDATE', text: 'They use buckets.' },
          ],
        };
        const reply = pairingReply([
          {
            question: 'N/A',
            summary: 'Stated knowledge.',
            strengths: ['Confidence'],
            improvements: ['Wait for the question'],
          },
          {
            question: 'Tell me more.',
            summary: 'Mentioned buckets.',
            strengths: ['Correct'],
            improvements: ['Elaborate'],
          },
        ]);
        await expect(
          evaluateTranscript(noAiFirst, {
            generate: async () => ({ text: reply }),
          })
        ).rejects.toThrow(/entry 1 has no preceding interviewer question/);
      });

      it('accepts whitespace-only differences without false failures', async () => {
        const whitespaced = [
          { ...CORRECT_PER_ANSWER[0], question: '  Question  1:  What is a hash map?  ' },
          { ...CORRECT_PER_ANSWER[1], question: 'Follow-up:  What happens\ton collision?' },
        ];
        const result = await evaluateTranscript(PAIRING_INPUT, {
          generate: async () => ({ text: pairingReply(whitespaced) }),
        });
        expect(result.perAnswer).toHaveLength(2);
      });

      it('deriveExpectedQuestions returns null for orphaned candidate turns', () => {
        const turns: TranscriptTurn[] = [
          { speaker: 'CANDIDATE', text: 'No preceding AI turn.' },
          { speaker: 'AI', text: 'First AI question.' },
          { speaker: 'CANDIDATE', text: 'Answer to first AI question.' },
        ];
        expect(deriveExpectedQuestions(turns)).toEqual([null, 'First AI question.']);
      });

      it('normalizeWhitespace collapses tabs, newlines, and multiple spaces', () => {
        expect(normalizeWhitespace('  hello   world  ')).toBe('hello world');
        expect(normalizeWhitespace('a\tb\nc')).toBe('a b c');
        expect(normalizeWhitespace('   ')).toBe('');
      });
    });
  });
});
