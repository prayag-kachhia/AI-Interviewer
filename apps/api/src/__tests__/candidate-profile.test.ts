import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CandidateProfile } from '@interview/contracts';
import { analyzeResumeWithAI } from '../services/gemini.service';
import { extractResumeHeuristically } from '../services/heuristic.service';

const mockGenerateContent = vi.fn();

vi.mock('@google/genai', () => {
  return {
    GoogleGenAI: class {
      models = {
        generateContent: (...args: unknown[]) => mockGenerateContent(...args),
      };
    },
  };
});

describe('CandidateProfile Contract & Resume Validation (Issue #103 / RJ-2)', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('CandidateProfile Zod Schema', () => {
    it('validates and preserves a complete candidate profile', () => {
      const fullProfile = {
        name: 'Jane Doe',
        email: 'jane@example.com',
        phone: '+1 555-123-4567',
        summary: 'Experienced full-stack software engineer.',
        education: ['B.S. in Computer Science, Tech University (2020)'],
        skills: ['TypeScript', 'React', 'Node.js', 'PostgreSQL'],
        projects: ['AI Interviewer: Full stack practice platform'],
        experience: ['Software Engineer at TechCorp (2020 - Present)'],
        certifications: ['AWS Certified Solutions Architect'],
        achievements: ['Won Hackathon 2022'],
        languages: ['English', 'Spanish'],
      };

      const parsed = CandidateProfile.parse(fullProfile);
      expect(parsed).toEqual(fullProfile);
    });

    it('supplies defaults for omitted fields in partial profiles', () => {
      const partial = {
        name: 'Jane Doe',
        skills: ['TypeScript', 'React'],
      };

      const parsed = CandidateProfile.parse(partial);
      expect(parsed.name).toBe('Jane Doe');
      expect(parsed.skills).toEqual(['TypeScript', 'React']);
      expect(parsed.email).toBe('');
      expect(parsed.phone).toBe('');
      expect(parsed.summary).toBe('');
      expect(parsed.education).toEqual([]);
      expect(parsed.projects).toEqual([]);
      expect(parsed.experience).toEqual([]);
      expect(parsed.certifications).toEqual([]);
      expect(parsed.achievements).toEqual([]);
      expect(parsed.languages).toEqual([]);
    });

    it('normalizes null or undefined values to empty string or empty array', () => {
      const withNulls = {
        name: 'Jane Doe',
        email: null,
        phone: null,
        summary: undefined,
        education: null,
        skills: ['Python'],
        projects: null,
        experience: undefined,
        certifications: null,
        achievements: null,
        languages: null,
      };

      const parsed = CandidateProfile.parse(withNulls);
      expect(parsed.name).toBe('Jane Doe');
      expect(parsed.email).toBe('');
      expect(parsed.phone).toBe('');
      expect(parsed.summary).toBe('');
      expect(parsed.education).toEqual([]);
      expect(parsed.skills).toEqual(['Python']);
      expect(parsed.projects).toEqual([]);
      expect(parsed.experience).toEqual([]);
      expect(parsed.certifications).toEqual([]);
      expect(parsed.achievements).toEqual([]);
      expect(parsed.languages).toEqual([]);
    });

    it('rejects invalid types such as non-string elements in arrays', () => {
      const invalid = {
        name: 'Jane Doe',
        skills: [123, 456],
      };

      const result = CandidateProfile.safeParse(invalid);
      expect(result.success).toBe(false);
    });
  });

  describe('analyzeResumeWithAI (gemini.service.ts)', () => {
    it('validates Gemini output with CandidateProfile and returns parsed data', async () => {
      process.env.GEMINI_API_KEY = 'real-valid-api-key-1234567890';
      const geminiResponse = {
        name: 'Alice Developer',
        email: 'alice@example.com',
        phone: '123-456-7890',
        summary: 'Backend Engineer',
        education: ['B.E. Computer Engineering'],
        skills: ['Go', 'Kubernetes', 'Docker'],
        projects: ['Cloud Gateway'],
        experience: ['Backend Dev at Acme'],
        certifications: [],
        achievements: [],
        languages: ['English'],
      };

      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify(geminiResponse),
      });

      const result = await analyzeResumeWithAI('Alice Developer resume text with Go and Kubernetes');

      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
      expect(result.source).toBe('ai');
      expect(result.profile).toEqual(geminiResponse);
    });

    it('handles Gemini output with missing or null fields by defaulting via schema', async () => {
      process.env.GEMINI_API_KEY = 'real-valid-api-key-1234567890';
      const geminiResponseWithNulls = {
        name: 'Alice Developer',
        email: null,
        phone: null,
        summary: 'Backend Engineer',
        skills: ['Go', 'Docker'],
      };

      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify(geminiResponseWithNulls),
      });

      const { profile, source } = await analyzeResumeWithAI('Alice Developer resume text');

      expect(source).toBe('ai');
      expect(profile.name).toBe('Alice Developer');
      expect(profile.email).toBe('');
      expect(profile.phone).toBe('');
      expect(profile.skills).toEqual(['Go', 'Docker']);
      expect(profile.education).toEqual([]);
      expect(profile.projects).toEqual([]);
    });

    it('falls back to heuristic extraction when Gemini response is malformed JSON', async () => {
      process.env.GEMINI_API_KEY = 'real-valid-api-key-1234567890';
      mockGenerateContent.mockResolvedValueOnce({
        text: 'This is not valid JSON at all',
      });

      const resumeText = 'Jane Smith\njane.smith@example.com\nSkills: React, Node.js';
      const { profile, source } = await analyzeResumeWithAI(resumeText);

      expect(source).toBe('heuristic');
      expect(profile.email).toBe('jane.smith@example.com');
      expect(profile.skills).toContain('React');
    });

    it('falls back to heuristic extraction when Gemini returns schema-invalid types', async () => {
      process.env.GEMINI_API_KEY = 'real-valid-api-key-1234567890';
      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify({ name: 99999, skills: 'not-an-array' }),
      });

      const resumeText = 'Jane Smith\njane.smith@example.com\nSkills: React, Node.js';
      const { profile, source } = await analyzeResumeWithAI(resumeText);

      expect(source).toBe('heuristic');
      expect(profile.email).toBe('jane.smith@example.com');
      expect(profile.skills).toContain('React');
    });

    it('uses heuristic extraction directly when API key is missing or placeholder', async () => {
      delete process.env.GEMINI_API_KEY;

      const resumeText = 'Jane Smith\njane.smith@example.com\nSkills: TypeScript';
      const { profile, source } = await analyzeResumeWithAI(resumeText);

      expect(mockGenerateContent).not.toHaveBeenCalled();
      expect(source).toBe('heuristic');
      expect(profile).toEqual(extractResumeHeuristically(resumeText));
    });
  });
});
