import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import app from '../server';
import prisma from '../db';
import { analyzeResumeWithAI } from '../services/gemini.service';

const mockGenerateContent = vi.fn();

vi.mock('@google/genai', () => {
  return {
    GoogleGenAI: vi.fn().mockImplementation(function (this: any) {
      return {
        models: {
          generateContent: mockGenerateContent,
        },
      };
    }),
  };
});

vi.mock('../services/pdf.service', () => ({
  extractTextFromPdfBuffer: vi.fn().mockResolvedValue('Sample resume text for John Doe with React and Node.js skills.'),
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
      create: vi.fn(),
    },
    resume: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
  },
}));

import * as supabase from '@supabase/supabase-js';
const { __getUserMock } = supabase as any;

describe('Resume Analysis and Fallback (Issue #78 / RJ-1)', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('analyzeResumeWithAI service', () => {
    it('returns source: "ai" with parsed profile when Gemini succeeds', async () => {
      process.env.GEMINI_API_KEY = 'AIzaSyRealValidKey1234567890';

      const mockAiProfile = {
        name: 'Jane Doe',
        email: 'jane@example.com',
        phone: '123-456-7890',
        summary: 'Experienced software engineer',
        skills: ['TypeScript', 'Node.js', 'React'],
        education: ['B.S. in Computer Science'],
        projects: ['Project Alpha'],
        experience: ['Software Engineer at Tech Corp'],
        certifications: ['AWS Certified'],
        achievements: ['Hackathon Winner'],
        languages: ['English', 'Spanish'],
      };

      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify(mockAiProfile),
      });

      const result = await analyzeResumeWithAI('Resume text content');

      expect(result.source).toBe('ai');
      expect(result.profile.name).toBe('Jane Doe');
      expect(result.profile.skills).toEqual(['TypeScript', 'Node.js', 'React']);
      expect(result.profile.email).toBe('jane@example.com');
    });

    it('returns source: "heuristic" when GEMINI_API_KEY is missing or placeholder', async () => {
      process.env.GEMINI_API_KEY = 'AIzaSy...'; // Placeholder key

      const result = await analyzeResumeWithAI('John Doe\njohn@example.com\nSkills: TypeScript, React');

      expect(result.source).toBe('heuristic');
      expect(result.profile).toBeDefined();
      expect(mockGenerateContent).not.toHaveBeenCalled();
    });

    it('returns source: "heuristic" when Gemini call throws an error', async () => {
      process.env.GEMINI_API_KEY = 'AIzaSyRealValidKey1234567890';
      mockGenerateContent.mockRejectedValueOnce(new Error('Quota exceeded or network timeout'));

      const result = await analyzeResumeWithAI('John Doe\njohn@example.com\nSkills: Python, Docker');

      expect(result.source).toBe('heuristic');
      expect(result.profile).toBeDefined();
    });

    it('returns source: "heuristic" when Gemini output is not valid JSON', async () => {
      process.env.GEMINI_API_KEY = 'AIzaSyRealValidKey1234567890';
      mockGenerateContent.mockResolvedValueOnce({
        text: 'This is not valid JSON string',
      });

      const result = await analyzeResumeWithAI('John Doe\njohn@example.com\nSkills: Go, Kubernetes');

      expect(result.source).toBe('heuristic');
      expect(result.profile).toBeDefined();
    });
  });

  describe('Resume API endpoints', () => {
    const authUser = {
      id: 'local-user-1',
      supabaseUserId: 'supabase-1',
      email: 'test@example.com',
      name: 'Test Candidate',
    };

    beforeEach(() => {
      __getUserMock.mockResolvedValue({
        data: { user: { id: authUser.supabaseUserId, email: authUser.email } },
        error: null,
      });
      (prisma.user.findUnique as any).mockResolvedValue(authUser);
    });

    describe('POST /api/resume/analyze', () => {
      it('returns source: "ai" in data when Gemini successfully analyzes the uploaded PDF', async () => {
        process.env.GEMINI_API_KEY = 'AIzaSyRealValidKey1234567890';

        const mockAiProfile = {
          name: 'Alex Smith',
          email: 'alex@example.com',
          phone: '',
          summary: 'Cloud Engineer',
          skills: ['AWS', 'Terraform'],
          education: [],
          projects: [],
          experience: [],
          certifications: [],
          achievements: [],
          languages: [],
        };

        mockGenerateContent.mockResolvedValueOnce({
          text: JSON.stringify(mockAiProfile),
        });

        (prisma.resume.create as any).mockImplementation(({ data }: any) => ({
          id: 'resume-new-1',
          userId: data.userId,
          fileName: data.fileName,
          createdAt: new Date('2026-03-01T12:00:00Z'),
          extractedText: data.extractedText,
          parsedProfile: data.parsedProfile,
        }));

        const res = await request(app)
          .post('/api/resume/analyze')
          .set('Authorization', 'Bearer valid-token')
          .attach('resume', Buffer.from('%PDF-1.4 simulated pdf buffer'), 'resume.pdf');

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.source).toBe('ai');
        expect(res.body.data.resumeId).toBe('resume-new-1');
        expect(res.body.data.profile.name).toBe('Alex Smith');

        // Check that parsedProfile was saved with source
        expect(prisma.resume.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              parsedProfile: expect.stringContaining('"source":"ai"'),
            }),
          })
        );
      });

      it('returns source: "heuristic" in data when AI fails and falls back', async () => {
        delete process.env.GEMINI_API_KEY;

        (prisma.resume.create as any).mockImplementation(({ data }: any) => ({
          id: 'resume-fallback-1',
          userId: data.userId,
          fileName: data.fileName,
          createdAt: new Date('2026-03-01T12:00:00Z'),
          extractedText: data.extractedText,
          parsedProfile: data.parsedProfile,
        }));

        const res = await request(app)
          .post('/api/resume/analyze')
          .set('Authorization', 'Bearer valid-token')
          .attach('resume', Buffer.from('%PDF-1.4 simulated pdf buffer'), 'resume.pdf');

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.source).toBe('heuristic');
        expect(res.body.data.resumeId).toBe('resume-fallback-1');
      });
    });

    describe('GET /api/resume/latest', () => {
      it('returns source: "ai" when stored with source: "ai"', async () => {
        (prisma.resume.findFirst as any).mockResolvedValueOnce({
          id: 'resume-latest-1',
          userId: authUser.id,
          fileName: 'my-resume.pdf',
          createdAt: new Date('2026-03-01T10:00:00Z'),
          parsedProfile: JSON.stringify({
            name: 'Alex Smith',
            skills: ['React'],
            source: 'ai',
          }),
        });

        const res = await request(app)
          .get('/api/resume/latest')
          .set('Authorization', 'Bearer valid-token');

        expect(res.status).toBe(200);
        expect(res.body.data.source).toBe('ai');
        expect(res.body.data.profile.name).toBe('Alex Smith');
      });

      it('does not invent a source for legacy rows without source field', async () => {
        (prisma.resume.findFirst as any).mockResolvedValueOnce({
          id: 'resume-legacy-1',
          userId: authUser.id,
          fileName: 'legacy.pdf',
          createdAt: new Date('2026-01-01T10:00:00Z'),
          parsedProfile: JSON.stringify({
            name: 'Old Record',
            skills: ['Java'],
          }),
        });

        const res = await request(app)
          .get('/api/resume/latest')
          .set('Authorization', 'Bearer valid-token');

        expect(res.status).toBe(200);
        expect(res.body.data.source).toBeUndefined();
        expect(res.body.data.profile.name).toBe('Old Record');
      });
    });

    describe('GET /api/resume/:id', () => {
      it('returns source from stored parsedProfile', async () => {
        (prisma.resume.findFirst as any).mockResolvedValueOnce({
          id: 'resume-id-1',
          userId: authUser.id,
          fileName: 'cv.pdf',
          createdAt: new Date('2026-02-01T10:00:00Z'),
          parsedProfile: JSON.stringify({
            name: 'CV User',
            source: 'heuristic',
          }),
        });

        const res = await request(app)
          .get('/api/resume/resume-id-1')
          .set('Authorization', 'Bearer valid-token');

        expect(res.status).toBe(200);
        expect(res.body.data.source).toBe('heuristic');
      });
    });
  });
});
