import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import app from '../server';
import prisma from '../db';
import {
  matchResumeWithJobDescription,
  buildResumeMatchPrompt,
  MAX_RESUME_TEXT_LENGTH,
} from '../services/resume-match.service';
import { calculateResumeMatchOverallScore } from '@interview/contracts';

const mockGenerateContent = vi.fn();

vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn().mockImplementation(function (this: any) {
    return {
      models: {
        generateContent: mockGenerateContent,
      },
    };
  }),
}));

vi.mock('@supabase/supabase-js', () => {
  const getUserMock = vi.fn();
  return {
    createClient: vi.fn(() => ({
      auth: {
        getUser: getUserMock,
      },
    })),
    __getUserMock: getUserMock,
  };
});

vi.mock('../db', () => ({
  default: {
    user: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    resume: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    resumeMatch: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

import * as supabase from '@supabase/supabase-js';
const { __getUserMock } = supabase as any;

describe('RJ-15 — Resume Match: Gemini Grading and API (FR-34, Issue #293)', () => {
  const authUser = {
    id: 'user-123',
    supabaseUserId: 'sub-user-123',
    email: 'candidate@example.com',
    name: 'Candidate User',
  };

  const ownedResume = {
    id: 'resume-456',
    userId: 'user-123',
    fileName: 'resume.pdf',
    extractedText: 'Senior Full Stack Engineer with 5 years in TypeScript, React, and Node.js.',
    parsedProfile: JSON.stringify({
      name: 'Candidate User',
      skills: ['TypeScript', 'React', 'Node.js', 'PostgreSQL'],
      experience: ['Senior Engineer at Tech Corp for 5 years'],
    }),
    createdAt: new Date('2026-01-01T10:00:00.000Z'),
  };

  const sampleValidGeminiResponse = {
    categories: [
      {
        category: 'Skills match',
        score: 90,
        comment: 'Candidate demonstrates strong proficiency in TypeScript and React.',
      },
      {
        category: 'Experience relevance',
        score: 80,
        comment: '5 years of full stack experience fits well with senior requirements.',
      },
      {
        category: 'Keyword coverage',
        score: 70,
        comment: 'Covers core backend and frontend keywords.',
      },
      {
        category: 'Education and credentials',
        score: 100,
        comment: 'Relevant credentials align with expectations.',
      },
    ],
    matchedKeywords: ['TypeScript', 'React', 'Node.js'],
    missingKeywords: ['Docker', 'AWS'],
    strengths: ['Strong full-stack foundation', 'Hands-on TypeScript expertise'],
    gaps: ['Cloud infrastructure experience is limited'],
    suggestions: ['Highlight Docker and cloud deployments on projects'],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GEMINI_API_KEY = 'test-key-ai-fake-key-12345';
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify(sampleValidGeminiResponse),
    });
    __getUserMock.mockResolvedValue({
      data: {
        user: {
          id: authUser.supabaseUserId,
          email: authUser.email,
        },
      },
      error: null,
    });
    (prisma.user.findUnique as any).mockResolvedValue(authUser);
  });

  describe('1. Gemini Resume Match Service Unit Tests', () => {
    it('returns a valid source: "ai" result when Gemini responds successfully', async () => {
      const mockGenerate = vi.fn().mockResolvedValue({
        text: JSON.stringify(sampleValidGeminiResponse),
      });

      const result = await matchResumeWithJobDescription(
        {
          extractedText: ownedResume.extractedText,
          parsedProfile: ownedResume.parsedProfile,
        },
        'Looking for a Senior TypeScript and React engineer.',
        { generate: mockGenerate }
      );

      expect(mockGenerate).toHaveBeenCalledTimes(1);
      expect(result.source).toBe('ai');
      expect(result.categories).toHaveLength(4);
      expect(result.matchedKeywords).toContain('TypeScript');
      expect(result.missingKeywords).toContain('Docker');
      expect(result.strengths.length).toBeGreaterThan(0);
      expect(result.gaps.length).toBeGreaterThan(0);
      expect(result.suggestions.length).toBeGreaterThan(0);
    });

    it('calculates authoritative overall score using RJ-14 weighted helper and ignores model overall score', async () => {
      // 0.40 * 90 + 0.30 * 80 + 0.20 * 70 + 0.10 * 100 = 36 + 24 + 14 + 10 = 84
      const expectedWeightedScore = calculateResumeMatchOverallScore(
        sampleValidGeminiResponse.categories
      );
      expect(expectedWeightedScore).toBe(84);

      // Even if Gemini returned a bogus overall score in the payload, service recalculates locally
      const mockGenerate = vi.fn().mockResolvedValue({
        text: JSON.stringify({
          ...sampleValidGeminiResponse,
          score: 12, // bogus overall score to be ignored
        }),
      });

      const result = await matchResumeWithJobDescription(
        {
          extractedText: ownedResume.extractedText,
          parsedProfile: ownedResume.parsedProfile,
        },
        'Job description here',
        { generate: mockGenerate }
      );

      expect(result.score).toBe(84);
      expect(result.source).toBe('ai');
    });

    it('falls back to keyword scorer when Gemini returns invalid JSON', async () => {
      const mockGenerate = vi.fn().mockResolvedValue({
        text: 'Not JSON: Server error or malformed stream',
      });

      const result = await matchResumeWithJobDescription(
        {
          extractedText: ownedResume.extractedText,
          parsedProfile: ownedResume.parsedProfile,
        },
        'We need TypeScript, React, and Node.js developers.',
        { generate: mockGenerate }
      );

      expect(result.source).toBe('keywords');
      expect(result.categories).toHaveLength(4);
      expect(result.score).toBeGreaterThan(0);
      expect(result.matchedKeywords).toContain('TypeScript');
    });

    it('falls back to keyword scorer when Gemini request times out', async () => {
      const mockHangingGenerate = vi.fn().mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 500))
      );

      const result = await matchResumeWithJobDescription(
        {
          extractedText: ownedResume.extractedText,
          parsedProfile: ownedResume.parsedProfile,
        },
        'Job description',
        { generate: mockHangingGenerate, timeoutMs: 20 }
      );

      expect(result.source).toBe('keywords');
      expect(result.score).toBeDefined();
    });

    it('falls back to keyword scorer when GEMINI_API_KEY is missing or placeholder', async () => {
      const savedKey = process.env.GEMINI_API_KEY;
      try {
        delete process.env.GEMINI_API_KEY;

        const result = await matchResumeWithJobDescription(
          {
            extractedText: ownedResume.extractedText,
            parsedProfile: ownedResume.parsedProfile,
          },
          'Need TypeScript engineers'
        );

        expect(result.source).toBe('keywords');
      } finally {
        process.env.GEMINI_API_KEY = savedKey;
      }
    });

    it('falls back to keyword scorer when response fails Zod schema validation', async () => {
      const mockGenerate = vi.fn().mockResolvedValue({
        text: JSON.stringify({
          categories: 'not-an-array',
          matchedKeywords: [],
        }),
      });

      const result = await matchResumeWithJobDescription(
        {
          extractedText: ownedResume.extractedText,
          parsedProfile: ownedResume.parsedProfile,
        },
        'Job description',
        { generate: mockGenerate }
      );

      expect(result.source).toBe('keywords');
    });

    it('falls back to keyword scorer when required categories are missing or duplicated', async () => {
      // Missing 'Education and credentials'
      const missingCategory = {
        ...sampleValidGeminiResponse,
        categories: sampleValidGeminiResponse.categories.slice(0, 3),
      };

      const mockGenerateMissing = vi.fn().mockResolvedValue({
        text: JSON.stringify(missingCategory),
      });

      const resultMissing = await matchResumeWithJobDescription(
        {
          extractedText: ownedResume.extractedText,
          parsedProfile: ownedResume.parsedProfile,
        },
        'Job description',
        { generate: mockGenerateMissing }
      );

      expect(resultMissing.source).toBe('keywords');

      // Duplicate category
      const duplicateCategory = {
        ...sampleValidGeminiResponse,
        categories: [
          sampleValidGeminiResponse.categories[0],
          sampleValidGeminiResponse.categories[0],
          sampleValidGeminiResponse.categories[1],
          sampleValidGeminiResponse.categories[2],
        ],
      };

      const mockGenerateDuplicate = vi.fn().mockResolvedValue({
        text: JSON.stringify(duplicateCategory),
      });

      const resultDuplicate = await matchResumeWithJobDescription(
        {
          extractedText: ownedResume.extractedText,
          parsedProfile: ownedResume.parsedProfile,
        },
        'Job description',
        { generate: mockGenerateDuplicate }
      );

      expect(resultDuplicate.source).toBe('keywords');
    });

    it('truncates resume text exceeding MAX_RESUME_TEXT_LENGTH and wraps with safe delimiters', () => {
      const longResume = 'A'.repeat(MAX_RESUME_TEXT_LENGTH + 5000);
      const jd = 'Target Job Description';

      const prompt = buildResumeMatchPrompt(longResume, jd);

      expect(prompt).toContain('<<<START_CANDIDATE_RESUME_DATA>>>');
      expect(prompt).toContain('<<<END_CANDIDATE_RESUME_DATA>>>');
      expect(prompt).toContain('<<<START_TARGET_JOB_DESCRIPTION_DATA>>>');
      expect(prompt).toContain('<<<END_TARGET_JOB_DESCRIPTION_DATA>>>');
      expect(prompt).toContain('UNTRUSTED USER DATA');

      // The extracted resume inside prompt must not exceed MAX_RESUME_TEXT_LENGTH
      const extractedPortion = prompt
        .split('<<<START_CANDIDATE_RESUME_DATA>>>\n')[1]
        .split('\n<<<END_CANDIDATE_RESUME_DATA>>>')[0];

      expect(extractedPortion.length).toBe(MAX_RESUME_TEXT_LENGTH);
    });
  });

  describe('2. Resume Match API Routes (Route Tests)', () => {
    describe('Authentication & Authorization', () => {
      it('returns HTTP 401 when no authorization token is provided', async () => {
        const res = await request(app)
          .post('/api/resume/resume-456/matches')
          .send({ jobDescription: 'Need React developer' });

        expect(res.status).toBe(401);
      });

      it('returns HTTP 404 when requesting a match for another user resume (FR-27 anti-enumeration)', async () => {
        (prisma.resume.findFirst as any).mockResolvedValue(null);

        const res = await request(app)
          .post('/api/resume/other-user-resume/matches')
          .set('Authorization', 'Bearer valid-token')
          .send({ jobDescription: 'Need React developer' });

        expect(res.status).toBe(404);
        expect(res.body.message).toBe('Resource not found');
      });

      it('returns HTTP 404 when deleting another user match or resume (FR-27)', async () => {
        // Resume owned, but match belongs to someone else
        (prisma.resume.findFirst as any).mockResolvedValue(ownedResume);
        (prisma.resumeMatch.findFirst as any).mockResolvedValue(null);

        const res = await request(app)
          .delete('/api/resume/resume-456/matches/other-match-999')
          .set('Authorization', 'Bearer valid-token');

        expect(res.status).toBe(404);
      });
    });

    describe('Route A — POST /api/resume/:id/matches (Create Match)', () => {
      it('returns HTTP 400 for empty or whitespace-only job description', async () => {
        (prisma.resume.findFirst as any).mockResolvedValue(ownedResume);

        const resEmpty = await request(app)
          .post('/api/resume/resume-456/matches')
          .set('Authorization', 'Bearer valid-token')
          .send({ jobDescription: '' });

        expect(resEmpty.status).toBe(400);

        const resWhitespace = await request(app)
          .post('/api/resume/resume-456/matches')
          .set('Authorization', 'Bearer valid-token')
          .send({ jobDescription: '    \n  \t  ' });

        expect(resWhitespace.status).toBe(400);
      });

      it('returns HTTP 400 for job description exceeding 4000 characters', async () => {
        (prisma.resume.findFirst as any).mockResolvedValue(ownedResume);

        const resTooLong = await request(app)
          .post('/api/resume/resume-456/matches')
          .set('Authorization', 'Bearer valid-token')
          .send({ jobDescription: 'X'.repeat(4001) });

        expect(resTooLong.status).toBe(400);
        expect(resTooLong.body.message).toContain('must not exceed 4000 characters');
      });

      it('returns HTTP 201 and persists match record in a transaction', async () => {
        (prisma.resume.findFirst as any).mockResolvedValue(ownedResume);

        const createdRecord = {
          id: '550e8400-e29b-41d4-a716-446655440000',
          resumeId: ownedResume.id,
          userId: authUser.id,
          jobDescription: 'Software Engineer with TypeScript skills.',
          score: 85,
          source: 'keywords',
          result: {
            categories: [
              { category: 'Skills match', score: 85, comment: 'Good match' },
              { category: 'Experience relevance', score: 80, comment: 'Relevant' },
              { category: 'Keyword coverage', score: 90, comment: 'High coverage' },
              { category: 'Education and credentials', score: 85, comment: 'Satisfied' },
            ],
            matchedKeywords: ['TypeScript'],
            missingKeywords: [],
            strengths: ['TypeScript experience'],
            gaps: [],
            suggestions: [],
          },
          createdAt: new Date('2026-01-02T12:00:00.000Z'),
        };

        // Mock transaction implementation
        (prisma.$transaction as any).mockImplementation(async (callback: any) => {
          const tx = {
            resumeMatch: {
              create: vi.fn().mockResolvedValue(createdRecord),
              findMany: vi.fn().mockResolvedValue([{ id: createdRecord.id }]),
              deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
            },
          };
          return callback(tx);
        });

        const res = await request(app)
          .post('/api/resume/resume-456/matches')
          .set('Authorization', 'Bearer valid-token')
          .send({ jobDescription: 'Software Engineer with TypeScript skills.' });

        expect(res.status).toBe(201);
        expect(res.body.success).toBe(true);
        expect(res.body.data.id).toBe(createdRecord.id);
        expect(res.body.data.score).toBe(85);
        expect(res.body.data.resumeId).toBe(ownedResume.id);
        expect(res.body.data.categories).toHaveLength(4);
        expect(res.body.data.matchedKeywords).toContain('TypeScript');
        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      });
    });

    describe('Route B — GET /api/resume/:id/matches (List Matches)', () => {
      it('returns HTTP 200 with list of matches ordered newest first', async () => {
        (prisma.resume.findFirst as any).mockResolvedValue(ownedResume);

        const match1 = {
          id: 'uuid-1',
          resumeId: ownedResume.id,
          userId: authUser.id,
          jobDescription: 'Senior Backend Engineer',
          score: 88,
          source: 'keywords',
          result: {
            categories: [],
            matchedKeywords: ['TypeScript', 'Node.js'],
            missingKeywords: [],
            strengths: [],
            gaps: [],
            suggestions: [],
          },
          createdAt: new Date('2026-01-03T10:00:00.000Z'),
        };

        const match2 = {
          id: 'uuid-2',
          resumeId: ownedResume.id,
          userId: authUser.id,
          jobDescription: 'Full Stack Engineer',
          score: 75,
          source: 'keywords',
          result: {
            categories: [],
            matchedKeywords: ['React'],
            missingKeywords: [],
            strengths: [],
            gaps: [],
            suggestions: [],
          },
          createdAt: new Date('2026-01-01T10:00:00.000Z'),
        };

        (prisma.resumeMatch.findMany as any).mockResolvedValue([match1, match2]);

        const res = await request(app)
          .get('/api/resume/resume-456/matches')
          .set('Authorization', 'Bearer valid-token');

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data).toHaveLength(2);
        expect(res.body.data[0].id).toBe('uuid-1');
        expect(res.body.data[1].id).toBe('uuid-2');
        expect(prisma.resumeMatch.findMany).toHaveBeenCalledWith({
          where: {
            resumeId: ownedResume.id,
            userId: authUser.id,
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        });
      });
    });

    describe('Route C — DELETE /api/resume/:id/matches/:matchId', () => {
      it('returns HTTP 204 and deletes match when owned by caller', async () => {
        (prisma.resume.findFirst as any).mockResolvedValue(ownedResume);
        (prisma.resumeMatch.findFirst as any).mockResolvedValue({
          id: 'match-to-delete',
          resumeId: ownedResume.id,
          userId: authUser.id,
        });
        (prisma.resumeMatch.delete as any).mockResolvedValue({ id: 'match-to-delete' });

        const res = await request(app)
          .delete('/api/resume/resume-456/matches/match-to-delete')
          .set('Authorization', 'Bearer valid-token');

        expect(res.status).toBe(204);
        expect(prisma.resumeMatch.delete).toHaveBeenCalledWith({
          where: { id: 'match-to-delete' },
        });
      });
    });

    describe('Twenty-Result Retention Cap', () => {
      it('identifies and deletes older records beyond 20 across all resumes in the same transaction', async () => {
        (prisma.resume.findFirst as any).mockResolvedValue(ownedResume);

        // Simulate 22 matches existing for this user
        const simulatedMatches = Array.from({ length: 22 }, (_, i) => ({
          id: `match-${i + 1}`,
          createdAt: new Date(Date.now() - i * 1000),
        }));

        let deleteManyCalledWith: any = null;

        (prisma.$transaction as any).mockImplementation(async (callback: any) => {
          const tx = {
            resumeMatch: {
              create: vi.fn().mockResolvedValue({
                id: 'match-1',
                resumeId: ownedResume.id,
                userId: authUser.id,
                jobDescription: 'Frontend Dev',
                score: 80,
                source: 'keywords',
                result: {},
                createdAt: new Date(),
              }),
              findMany: vi.fn().mockResolvedValue(simulatedMatches),
              deleteMany: vi.fn().mockImplementation((args) => {
                deleteManyCalledWith = args;
                return { count: 2 };
              }),
            },
          };
          return callback(tx);
        });

        const res = await request(app)
          .post('/api/resume/resume-456/matches')
          .set('Authorization', 'Bearer valid-token')
          .send({ jobDescription: 'Frontend developer' });

        expect(res.status).toBe(201);
        expect(deleteManyCalledWith).not.toBeNull();
        // Excess IDs must be matches at index 20 and 21 (match-21 and match-22)
        expect(deleteManyCalledWith.where.id.in).toEqual(['match-21', 'match-22']);
        expect(deleteManyCalledWith.where.userId).toBe(authUser.id);
      });
    });
  });
});
