import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { TurnSpeaker } from '@interview/contracts';
import {
  evaluateTranscript,
  buildEvaluationPrompt,
  RUBRIC,
  normalizeQuote,
  isQuoteInCandidateTurns,
  type EvaluationInput,
  type TranscriptTurn,
} from '../services/evaluator.service';
import {
  getRubric,
  UnknownRoleError,
  SOFTWARE_ENGINEER_RUBRIC,
  DATA_ANALYST_RUBRIC,
  BACKEND_DEVELOPER_RUBRIC,
} from '../services/rubrics';

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

// Fixtures loaded for testing
const EXCELLENT_TRANSCRIPT = loadTranscriptFixture('excellent.json');
const GOOD_TRANSCRIPT = loadTranscriptFixture('good.json');
const AVERAGE_TRANSCRIPT = loadTranscriptFixture('average.json');
const WEAK_TRANSCRIPT = loadTranscriptFixture('weak.json');
const EMPTY_TRANSCRIPT = loadTranscriptFixture('empty-answers.json');

const SAMPLE: EvaluationInput = {
  roleLabel: 'Software Engineer',
  turns: GOOD_TRANSCRIPT,
};

// Verbatim candidate quotes from good.json
const GOOD_CANDIDATE_QUOTES = [
  'I would decouple the notification requests from the main web API using a message queue',
  'We should handle failures by implementing exponential backoff retries with jitter.',
  'I would use idempotency keys.',
];

const VALID_SOFTWARE_ENGINEER_EVALUATION = JSON.stringify({
  summary: 'Clear, concrete answers about asynchronous architecture and idempotency.',
  scores: SOFTWARE_ENGINEER_RUBRIC.map((r, i) => ({
    category: r.category,
    score: 4,
    comment: 'Specific and relevant approach to system engineering.',
    strengths: ['Clear explanation of queue decoupling', 'Understands retry and backoff semantics'],
    improvements: ['Could detail dead-letter monitoring in production'],
    quote: GOOD_CANDIDATE_QUOTES[i % GOOD_CANDIDATE_QUOTES.length],
  })),
});

describe('FB4 & Issue #93 — Evaluator & Rubrics', () => {
  describe('Fixture Constraints', () => {
    it('validates all hand-written transcript fixtures against the TurnSpeaker contract and turn constraints', () => {
      const fixtureNames = [
        'excellent.json',
        'good.json',
        'average.json',
        'weak.json',
        'empty-answers.json',
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
  });

  describe('A. Role-specific Rubrics (rubrics.ts)', () => {
    it('produces genuinely distinct evaluation categories for Software Engineer and Data Analyst', () => {
      const sweRubric = getRubric('software-engineer');
      const daRubric = getRubric('data-analyst');

      const sweCategories = sweRubric.map((r) => r.category);
      const daCategories = daRubric.map((r) => r.category);

      expect(sweCategories).not.toEqual(daCategories);
      expect(sweCategories).toContain('Problem Solving & Algorithms');
      expect(daCategories).toContain('SQL & Analytical Reasoning');
      expect(daCategories).toContain('Data Interpretation & Business Insights');
    });

    it('produces a dedicated rubric for Backend Developer with relevant categories', () => {
      const backendRubric = getRubric('backend-developer');
      const backendCategories = backendRubric.map((r) => r.category);

      expect(backendCategories).toContain('API Design & Architecture');
      expect(backendCategories).toContain('Database Modeling & Performance');
      expect(backendCategories).toContain('System Reliability & Scalability');
    });

    it('resolves rubrics case-insensitively and by role label', () => {
      expect(getRubric('Software Engineer')).toEqual(SOFTWARE_ENGINEER_RUBRIC);
      expect(getRubric('data-analyst')).toEqual(DATA_ANALYST_RUBRIC);
      expect(getRubric('Backend Developer')).toEqual(BACKEND_DEVELOPER_RUBRIC);
    });

    it('rejects unknown or unsupported roles explicitly with UnknownRoleError', () => {
      expect(() => getRubric('devops-engineer')).toThrow(UnknownRoleError);
      expect(() => getRubric('')).toThrow(UnknownRoleError);
      expect(() => getRubric('product-manager')).toThrow('Unsupported or unknown role');
    });
  });

  describe('B. Prompt Integration & STAR Guidance', () => {
    it('includes role-specific rubric categories in the prompt', () => {
      const swePrompt = buildEvaluationPrompt({
        roleLabel: 'Software Engineer',
        turns: GOOD_TRANSCRIPT,
      });
      for (const r of SOFTWARE_ENGINEER_RUBRIC) {
        expect(swePrompt).toContain(r.category);
      }

      const daPrompt = buildEvaluationPrompt({
        roleLabel: 'Data Analyst',
        turns: GOOD_TRANSCRIPT,
      });
      for (const r of DATA_ANALYST_RUBRIC) {
        expect(daPrompt).toContain(r.category);
      }

      const backendPrompt = buildEvaluationPrompt({
        roleLabel: 'Backend Developer',
        turns: GOOD_TRANSCRIPT,
      });
      for (const r of BACKEND_DEVELOPER_RUBRIC) {
        expect(backendPrompt).toContain(r.category);
      }
    });

    it('includes STAR methodology guidance for behavioural answers in prompt', () => {
      const prompt = buildEvaluationPrompt(SAMPLE);
      expect(prompt).toContain('STAR');
      expect(prompt).toContain('Situation');
      expect(prompt).toContain('Task');
      expect(prompt).toContain('Action');
      expect(prompt).toContain('Result');
    });

    it('instructs evaluator not to force STAR onto purely technical answers', () => {
      const prompt = buildEvaluationPrompt(SAMPLE);
      expect(prompt).toMatch(/DO NOT force STAR onto purely technical/i);
      expect(prompt).toMatch(/Do NOT penalize candidates for omitting STAR components in technical answers/i);
    });

    it('puts both speakers into the prompt transcript', () => {
      const prompt = buildEvaluationPrompt(SAMPLE);
      expect(prompt).toContain('Interviewer: Welcome to the Software Engineer interview.');
      expect(prompt).toContain('Candidate: I would decouple the notification requests');
    });
  });

  describe('C. Transcript Evidence & Strict Quote Validation', () => {
    it('accepts evaluation when all quotes are genuine verbatim candidate excerpts', async () => {
      const result = await evaluateTranscript(SAMPLE, {
        generate: async () => VALID_SOFTWARE_ENGINEER_EVALUATION,
      });

      expect(result.summary).toBe('Clear, concrete answers about asynchronous architecture and idempotency.');
      expect(result.scores.length).toBe(SOFTWARE_ENGINEER_RUBRIC.length);
      for (const score of result.scores) {
        expect(score.strengths.length).toBeGreaterThan(0);
        expect(score.improvements.length).toBeGreaterThan(0);
        expect(isQuoteInCandidateTurns(score.quote, GOOD_TRANSCRIPT)).toBe(true);
      }
    });

    it('is robust against surrounding quotation marks and extra whitespace in quotes', () => {
      const candidateTurns = GOOD_TRANSCRIPT.filter((t) => t.speaker === 'CANDIDATE');
      const quoteWithWhitespaceAndQuotes = '  "I would decouple the notification requests   from the main web API"  ';
      expect(isQuoteInCandidateTurns(quoteWithWhitespaceAndQuotes, candidateTurns)).toBe(true);
      expect(normalizeQuote(quoteWithWhitespaceAndQuotes)).toBe(
        'I would decouple the notification requests from the main web API'
      );
    });

    it('rejects a quote that does not appear in candidate transcript text', async () => {
      const fabricatedOutput = JSON.stringify({
        summary: 'Solid answers.',
        scores: SOFTWARE_ENGINEER_RUBRIC.map((r) => ({
          category: r.category,
          score: 4,
          comment: 'Good.',
          strengths: ['Great work'],
          improvements: ['Minor polish'],
          quote: 'I personally implemented a raft consensus algorithm in Rust from scratch.',
        })),
      });

      await expect(
        evaluateTranscript(SAMPLE, { generate: async () => fabricatedOutput })
      ).rejects.toThrow(/Quote validation failed.*was not found in candidate transcript/i);
    });

    it('rejects quotes taken from the interviewer instead of the candidate', async () => {
      const interviewerQuoteOutput = JSON.stringify({
        summary: 'Solid answers.',
        scores: SOFTWARE_ENGINEER_RUBRIC.map((r) => ({
          category: r.category,
          score: 4,
          comment: 'Good.',
          strengths: ['Great work'],
          improvements: ['Minor polish'],
          // Taken directly from AI speaker in turn 1
          quote: 'Welcome to the Software Engineer interview. Could you describe how you would design',
        })),
      });

      await expect(
        evaluateTranscript(SAMPLE, { generate: async () => interviewerQuoteOutput })
      ).rejects.toThrow(/Quote validation failed.*was not found in candidate transcript/i);
    });

    it('rejects evaluation when a quote is empty or whitespace only', async () => {
      const emptyQuoteOutput = JSON.stringify({
        summary: 'Solid answers.',
        scores: SOFTWARE_ENGINEER_RUBRIC.map((r) => ({
          category: r.category,
          score: 4,
          comment: 'Good.',
          strengths: ['Great work'],
          improvements: ['Minor polish'],
          quote: '   ',
        })),
      });

      await expect(
        evaluateTranscript(SAMPLE, { generate: async () => emptyQuoteOutput })
      ).rejects.toThrow(/Quote validation failed.*empty/i);
    });
  });

  describe('D. Score Ordering (Excellent vs Weak Transcripts)', () => {
    it('verifies excellent transcript scores higher than weak transcript in every category', async () => {
      // Mocked output for excellent.json with genuine quotes
      const excellentOutput = JSON.stringify({
        summary: 'Exceptional answers demonstrating deep systems knowledge and clear architecture.',
        scores: [
          {
            category: 'Problem Solving & Algorithms',
            score: 5,
            comment: 'Mastery of time/space complexity with O(1) Lua token bucket implementation.',
            strengths: ['Atomic Lua token bucket', 'Clear analysis of Redis shard key hashing'],
            improvements: ['None needed for senior level'],
            quote: 'I would implement a token bucket algorithm backed by a Redis cluster.',
          },
          {
            category: 'Software Design & Architecture',
            score: 5,
            comment: 'Highly resilient design with multi-AZ replication and local in-memory fail-open fallback.',
            strengths: ['Fail-open local memory resilience', 'Understands distributed race conditions'],
            improvements: ['Consider active-active cross-region considerations'],
            quote: 'Executing the token evaluation and decrement inside a Redis Lua script prevents race conditions',
          },
          {
            category: 'Technical Communication',
            score: 5,
            comment: 'Articulate, precise explanation with mathematical rigor and trade-off analysis.',
            strengths: ['Accurate EXPLAIN plan breakdown', 'Concise composite B-tree indexing rationale'],
            improvements: ['Excellent technical delivery'],
            quote: 'First, I would run EXPLAIN (ANALYZE, BUFFERS) on the query in a staging environment',
          },
        ],
      });

      // Mocked output for weak.json with genuine quotes
      const weakOutput = JSON.stringify({
        summary: 'Superficial answers lacking architectural depth, scalability, and security reasoning.',
        scores: [
          {
            category: 'Problem Solving & Algorithms',
            score: 2,
            comment: 'Shows basic familiarity with Express but lacks algorithmic and performance depth.',
            strengths: ['Understands basic HTTP POST endpoint creation'],
            improvements: ['Needs to understand file storage bottlenecks and memory limits'],
            quote: 'Then we can convert the image into a base64 string and save it into a text column',
          },
          {
            category: 'Software Design & Architecture',
            score: 2,
            comment: 'Proposes saving files directly to server disk without multi-instance awareness.',
            strengths: ['Identifies that local server disk fails across multiple servers'],
            improvements: ['Learn cloud object storage patterns like S3 presigned URLs'],
            quote: 'saving on the server disk works fine on my laptop, but if the app runs on multiple servers',
          },
          {
            category: 'Technical Communication',
            score: 2,
            comment: 'Relies on superficial file extension checks and admits unfamiliarity with file verification.',
            strengths: ['Honest about knowledge limits'],
            improvements: ['Study magic numbers and MIME type verification'],
            quote: 'To be honest, I\'m not really sure how to inspect the contents past checking the file extension',
          },
        ],
      });

      const excellentResult = await evaluateTranscript(
        { roleLabel: 'Software Engineer', turns: EXCELLENT_TRANSCRIPT },
        { generate: async () => excellentOutput }
      );

      const weakResult = await evaluateTranscript(
        { roleLabel: 'Software Engineer', turns: WEAK_TRANSCRIPT },
        { generate: async () => weakOutput }
      );

      expect(excellentResult.scores.length).toBe(weakResult.scores.length);
      for (let i = 0; i < excellentResult.scores.length; i++) {
        const excellentScore = excellentResult.scores[i];
        const weakScore = weakResult.scores.find((s) => s.category === excellentScore.category);
        expect(weakScore).toBeDefined();
        expect(excellentScore.score).toBeGreaterThan(weakScore!.score);
      }
    });
  });

  describe('E. Existing Behaviour & Edge Cases', () => {
    it('fails well inside the 15-second budget when LLM call times out', async () => {
      const started = Date.now();
      await expect(
        evaluateTranscript(SAMPLE, { generate: () => new Promise(() => {}), timeoutMs: 50 })
      ).rejects.toThrow('timed out');
      expect(Date.now() - started).toBeLessThan(1000);
    });

    it('passes provider error on when LLM call fails', async () => {
      await expect(
        evaluateTranscript(SAMPLE, {
          generate: async () => {
            throw new Error('503 from provider');
          },
        })
      ).rejects.toThrow('503 from provider');
    });

    it('fails when LLM reply is not valid JSON', async () => {
      await expect(
        evaluateTranscript(SAMPLE, { generate: async () => 'Great interview!' })
      ).rejects.toThrow('valid JSON');
    });

    it('fails when score is outside 1–5 or a category is missing', async () => {
      const outOfRange = JSON.stringify({
        summary: 'x',
        scores: SOFTWARE_ENGINEER_RUBRIC.map((r) => ({
          category: r.category,
          score: 9,
          comment: 'x',
          strengths: ['s'],
          improvements: ['i'],
          quote: GOOD_CANDIDATE_QUOTES[0],
        })),
      });
      await expect(
        evaluateTranscript(SAMPLE, { generate: async () => outOfRange })
      ).rejects.toThrow();

      const missing = JSON.stringify({
        summary: 'x',
        scores: [
          {
            category: SOFTWARE_ENGINEER_RUBRIC[0].category,
            score: 4,
            comment: 'x',
            strengths: ['s'],
            improvements: ['i'],
            quote: GOOD_CANDIDATE_QUOTES[0],
          },
        ],
      });
      await expect(
        evaluateTranscript(SAMPLE, { generate: async () => missing })
      ).rejects.toThrow('instead of the rubric categories');
    });

    it('fails without calling the LLM when transcript has no candidate answers', async () => {
      let called = false;
      await expect(
        evaluateTranscript(
          { roleLabel: 'Software Engineer', turns: EMPTY_TRANSCRIPT },
          {
            generate: async () => {
              called = true;
              return VALID_SOFTWARE_ENGINEER_EVALUATION;
            },
          }
        )
      ).rejects.toThrow('no candidate answers');
      expect(called).toBe(false);
    });
  });
});
