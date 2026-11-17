import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import app from '../server';
import prisma from '../db';
import { analyzeResumeWithAI } from '../services/gemini.service';
import { extractTextFromPdfBuffer } from '../services/pdf.service';
import { isResumeHeuristically, hasContactInfo, hasResumeSection } from '../services/heuristic.service';

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
  extractTextFromPdfBuffer: vi.fn().mockResolvedValue(
    'John Doe\njohn.doe@example.com\n+1 (555) 123-4567\nSkills:\nTypeScript, React, Node.js\nExperience:\nSoftware Engineer at Tech Corp'
  ),
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

describe('Resume Analysis, Fallback, and Non-Resume Validation (JR-11 / Issue #243)', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('Heuristic resume validation rules', () => {
    it('validates contact info detection for email and phone numbers', () => {
      expect(hasContactInfo('Contact: alice@example.com')).toBe(true);
      expect(hasContactInfo('Call +1 (555) 234-5678 for inquiries')).toBe(true);
      expect(hasContactInfo('Call 555-234-5678 for inquiries')).toBe(true);
      expect(hasContactInfo('No contact info provided')).toBe(false);
    });

    it('validates section header detection for Experience, Education, Skills, and Projects', () => {
      expect(hasResumeSection('Skills:\nJavaScript, TypeScript')).toBe(true);
      expect(hasResumeSection('Work Experience\nSoftware Engineer')).toBe(true);
      expect(hasResumeSection('Education:\nB.S. in Computer Science')).toBe(true);
      expect(hasResumeSection('Key Projects:\nAI Interviewer')).toBe(true);
      expect(hasResumeSection('Appetizers\nGarlic bread $5')).toBe(false);
      expect(hasResumeSection('Invoice #12345')).toBe(false);
    });

    it('returns true for a document with email and a resume section', () => {
      const validDoc = `Jane Smith\njane.smith@example.com\nSkills: React, Node.js`;
      expect(isResumeHeuristically(validDoc)).toBe(true);
    });

    it('returns true for a document with phone and a resume section', () => {
      const validDoc = `Jane Smith\n(555) 123-4567\nExperience\nSoftware Engineer at Tech Corp`;
      expect(isResumeHeuristically(validDoc)).toBe(true);
    });

    it('rejects documents with contact info but no resume section (e.g., restaurant menu or invoice)', () => {
      const menu = `Luigi's Italian Bistro\nCall 555-123-4567 for reservations\nAppetizers:\n- Bruschetta $8\nEntrees:\n- Pizza Margherita $14`;
      expect(isResumeHeuristically(menu)).toBe(false);

      const invoice = `INVOICE #9872\nBilling questions: billing@acme.com\nAmount Due: $250.00`;
      expect(isResumeHeuristically(invoice)).toBe(false);
    });

    it('rejects documents with resume sections but no contact info', () => {
      const anonymousDoc = `Skills:\nJavaScript, Python\nExperience:\nDeveloper at XYZ`;
      expect(isResumeHeuristically(anonymousDoc)).toBe(false);
    });

    it('rejects empty or whitespace-only documents', () => {
      expect(isResumeHeuristically('')).toBe(false);
      expect(isResumeHeuristically('   \n  \t  ')).toBe(false);
    });
  });

  describe('analyzeResumeWithAI service', () => {
    it('returns source: "ai" and looksLikeResume: true when Gemini succeeds with a resume', async () => {
      process.env.GEMINI_API_KEY = 'AIzaSyRealValidKey1234567890';

      const mockAiProfile = {
        looksLikeResume: true,
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
      expect(result.looksLikeResume).toBe(true);
      expect(result.profile.name).toBe('Jane Doe');
      expect(result.profile.skills).toEqual(['TypeScript', 'Node.js', 'React']);
      expect(result.profile.email).toBe('jane@example.com');
    });

    it('returns looksLikeResume: false when Gemini determines the document is not a resume', async () => {
      process.env.GEMINI_API_KEY = 'AIzaSyRealValidKey1234567890';

      const mockNonResume = {
        looksLikeResume: false,
        name: '',
        email: '',
        phone: '',
        summary: '',
        education: [],
        skills: [],
        projects: [],
        experience: [],
        certifications: [],
        achievements: [],
        languages: [],
      };

      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify(mockNonResume),
      });

      const result = await analyzeResumeWithAI('Restaurant Menu: Pizza $12, Salad $8');

      expect(result.source).toBe('ai');
      expect(result.looksLikeResume).toBe(false);
    });

    it('returns source: "heuristic" and looksLikeResume: true when GEMINI_API_KEY is missing and text is a resume', async () => {
      process.env.GEMINI_API_KEY = 'AIzaSy...'; // Placeholder key

      const result = await analyzeResumeWithAI('John Doe\njohn@example.com\nSkills: TypeScript, React');

      expect(result.source).toBe('heuristic');
      expect(result.looksLikeResume).toBe(true);
      expect(result.profile).toBeDefined();
      expect(mockGenerateContent).not.toHaveBeenCalled();
    });

    it('returns source: "heuristic" and looksLikeResume: false when GEMINI_API_KEY is missing and text is not a resume', async () => {
      process.env.GEMINI_API_KEY = 'AIzaSy...'; // Placeholder key

      const result = await analyzeResumeWithAI('Pizza Bistro\nMenu: Spaghetti $15, Soda $3');

      expect(result.source).toBe('heuristic');
      expect(result.looksLikeResume).toBe(false);
      expect(mockGenerateContent).not.toHaveBeenCalled();
    });

    it('returns source: "heuristic" when Gemini call throws an error', async () => {
      process.env.GEMINI_API_KEY = 'AIzaSyRealValidKey1234567890';
      mockGenerateContent.mockRejectedValueOnce(new Error('Quota exceeded or network timeout'));

      const result = await analyzeResumeWithAI('John Doe\njohn@example.com\nSkills: Python, Docker');

      expect(result.source).toBe('heuristic');
      expect(result.looksLikeResume).toBe(true);
      expect(result.profile).toBeDefined();
    });

    it('returns source: "heuristic" when Gemini output is not valid JSON', async () => {
      process.env.GEMINI_API_KEY = 'AIzaSyRealValidKey1234567890';
      mockGenerateContent.mockResolvedValueOnce({
        text: 'This is not valid JSON string',
      });

      const result = await analyzeResumeWithAI('John Doe\njohn@example.com\nSkills: Go, Kubernetes');

      expect(result.source).toBe('heuristic');
      expect(result.looksLikeResume).toBe(true);
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
          looksLikeResume: true,
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

      it('returns source: "heuristic" in data when AI fails and falls back with a valid resume', async () => {
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

      it('returns 400 and does not save resume when Gemini determines document is not a resume', async () => {
        process.env.GEMINI_API_KEY = 'AIzaSyRealValidKey1234567890';

        mockGenerateContent.mockResolvedValueOnce({
          text: JSON.stringify({
            looksLikeResume: false,
            name: '',
            skills: [],
          }),
        });

        const res = await request(app)
          .post('/api/resume/analyze')
          .set('Authorization', 'Bearer valid-token')
          .attach('resume', Buffer.from('%PDF-1.4 simulated pdf buffer'), 'menu.pdf');

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
        expect(res.body.message).toBe("This doesn't look like a resume. Please upload your CV as a PDF.");
        expect(prisma.resume.create).not.toHaveBeenCalled();
      });

      it('returns 400 and does not save resume when heuristic fallback determines document is not a resume', async () => {
        delete process.env.GEMINI_API_KEY;

        vi.mocked(extractTextFromPdfBuffer).mockResolvedValueOnce(
          "Luigi's Bistro Menu\nCall 555-123-4567\nPizza Margherita $12\nSpaghetti Bolognese $15"
        );

        const res = await request(app)
          .post('/api/resume/analyze')
          .set('Authorization', 'Bearer valid-token')
          .attach('resume', Buffer.from('%PDF-1.4 simulated pdf buffer'), 'menu.pdf');

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
        expect(res.body.message).toBe("This doesn't look like a resume. Please upload your CV as a PDF.");
        expect(prisma.resume.create).not.toHaveBeenCalled();
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
