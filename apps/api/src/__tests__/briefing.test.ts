import { describe, it, expect, vi, beforeEach } from 'vitest';
import prisma from '../utils/db';
import {
  buildBriefing,
  briefingFor,
  calculatePhaseTiming,
} from '../services/briefing.service';

vi.mock('../utils/db', () => ({
  default: {
    resume: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
  },
}));

describe('Briefing Service — buildBriefing (FR-13, FR-15, FR-17, DR-01)', () => {
  it('builds a briefing for a Software Engineer session with structure, timing, and persona', () => {
    const briefing = buildBriefing({ roleId: 'software-engineer' });

    expect(briefing).toContain('Software Engineer');
    expect(briefing).toContain('Senior Software Engineering Interviewer');
    // Structure requirements (DR-01)
    expect(briefing).toContain('1. Introduction');
    expect(briefing).toContain('2. Core Technical Questions');
    expect(briefing).toContain('3. Wrap-up & Closing');
    // Follow-up and single question constraints (FR-15)
    expect(briefing).toContain('ONE question at a time');
    expect(briefing).toContain('follow-up');
    // Time limit (FR-17)
    expect(briefing).toContain('15 minutes');
    // Voice guidelines
    expect(briefing).toContain('VOICE CONVERSATION GUIDELINES');
    expect(briefing).toContain('DO NOT use markdown');
  });

  it('builds role-specific briefings for Data Analyst and Backend Developer', () => {
    const dataAnalystBriefing = buildBriefing({ roleId: 'data-analyst' });
    expect(dataAnalystBriefing).toContain('Data Analyst');
    expect(dataAnalystBriefing).toContain('SQL');

    const backendBriefing = buildBriefing({ roleId: 'backend-developer' });
    expect(backendBriefing).toContain('Backend Developer');
    expect(backendBriefing).toContain('API design');
  });

  it('includes custom time limit in the briefing', () => {
    const briefing = buildBriefing({ roleId: 'software-engineer', timeLimitMin: 25 });
    expect(briefing).toContain('25 minutes');
  });

  it('includes candidate focus area when provided (FR-07)', () => {
    const briefing = buildBriefing({
      roleId: 'backend-developer',
      focus: 'Distributed Systems and Caching',
    });

    expect(briefing).toContain('PRIMARY FOCUS AREA:');
    expect(briefing).toContain('Distributed Systems and Caching');
  });

  it('incorporates resumeSummary and instructs the interviewer to reference it (FR-08)', () => {
    const resumeText = 'Built a real-time analytics engine in Go and Kafka handling 50k req/s.';
    const briefing = buildBriefing({
      roleId: 'software-engineer',
      resumeSummary: resumeText,
    });

    expect(briefing).toContain('CANDIDATE RESUME SUMMARY:');
    expect(briefing).toContain(resumeText);
    expect(briefing).toContain('explicitly refer to at least one specific project');
  });

  it('lists pastQuestions and forbids repeating them (FR-16)', () => {
    const pastQuestions = [
      'How do you design a URL shortener?',
      'Explain how indexing improves B-tree performance.',
    ];
    const briefing = buildBriefing({
      roleId: 'backend-developer',
      pastQuestions,
    });

    expect(briefing).toContain('PREVIOUSLY ASKED QUESTIONS (DO NOT REPEAT):');
    expect(briefing).toContain('- How do you design a URL shortener?');
    expect(briefing).toContain('- Explain how indexing improves B-tree performance.');
    expect(briefing).toContain('Never ask any of the questions listed above');
  });

  it('includes company and seniority level when provided (P-7)', () => {
    const briefing = buildBriefing({
      roleId: 'software-engineer',
      company: 'Google',
      level: 'senior',
    });

    expect(briefing).toContain('TARGET COMPANY / ORGANIZATION:');
    expect(briefing).toContain('Google');
    expect(briefing).toContain('TARGET SENIORITY LEVEL:');
    expect(briefing).toContain('senior');
  });
});

describe('Briefing Service — briefingFor(session) (K-1, FR-17, DR-01)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('builds a briefing for a session without a resume', async () => {
    (prisma.resume.findFirst as any).mockResolvedValueOnce(null);

    const session = {
      id: 'sess-no-resume',
      role: 'software-engineer',
      userId: 'user-1',
      resumeId: null,
    };

    const briefing = await briefingFor(session);

    expect(briefing).toContain('Software Engineer');
    expect(briefing).toContain('1. Introduction');
    expect(briefing).toContain('15 minutes');
    expect(briefing).not.toContain('CANDIDATE RESUME SUMMARY:');
  });

  it('builds a briefing for a session with an attached resumeId (VM-1, FR-08)', async () => {
    (prisma.resume.findUnique as any).mockResolvedValueOnce({
      parsedProfile: JSON.stringify({
        name: 'Jane Doe',
        skills: ['TypeScript', 'Bun', 'PostgreSQL'],
        projects: [{ title: 'Chat Engine', description: 'Real-time WebSocket server' }],
      }),
    });

    const session = {
      id: 'sess-with-resume',
      role: 'backend-developer',
      userId: 'user-2',
      resumeId: 'resume-456',
    };

    const briefing = await briefingFor(session);

    expect(prisma.resume.findUnique).toHaveBeenCalledWith({
      where: { id: 'resume-456' },
      select: { parsedProfile: true },
    });
    expect(briefing).toContain('Backend Developer');
    expect(briefing).toContain('CANDIDATE RESUME SUMMARY:');
    expect(briefing).toContain('Strongest skills: TypeScript, Bun, PostgreSQL');
    expect(briefing).toContain('Project 1: Chat Engine: Real-time WebSocket server');
  });

  it('falls back to latest user resume when session has no direct resumeId', async () => {
    (prisma.resume.findFirst as any).mockResolvedValueOnce({
      parsedProfile: 'Experienced Systems Programmer in Rust and Go.',
    });

    const session = {
      id: 'sess-fallback',
      role: 'software-engineer',
      userId: 'user-fallback',
      resumeId: null,
    };

    const briefing = await briefingFor(session);

    expect(prisma.resume.findFirst).toHaveBeenCalledWith({
      where: { userId: 'user-fallback' },
      orderBy: { createdAt: 'desc' },
      select: { parsedProfile: true },
    });
    expect(briefing).toContain('CANDIDATE RESUME SUMMARY:');
    expect(briefing).toContain('Experienced Systems Programmer in Rust and Go.');
  });

  it('passes focus, company, level, and custom time limit to briefing', async () => {
    (prisma.resume.findFirst as any).mockResolvedValueOnce(null);

    const session = {
      id: 'sess-full-setup',
      role: 'software-engineer',
      userId: 'user-3',
      resumeId: null,
      focus: 'Distributed Systems',
      company: 'Stripe',
      level: 'staff',
      timeLimitMin: 30,
    };

    const briefing = await briefingFor(session);

    expect(briefing).toContain('Distributed Systems');
    expect(briefing).toContain('Stripe');
    expect(briefing).toContain('staff');
    expect(briefing).toContain('30 minutes');
  });
});

describe('Briefing Service — 3-Phase Question Progression (K-4, DR-01, FR-17)', () => {
  describe('calculatePhaseTiming()', () => {
    it('calculates the timing split for a standard 15-minute interview', () => {
      const timing = calculatePhaseTiming(15);
      expect(timing.warmUpMin).toBe(3);
      expect(timing.deepDiveMin).toBe(8);
      expect(timing.pressureTestMin).toBe(4);
      expect(timing.warmUpMin + timing.deepDiveMin + timing.pressureTestMin).toBe(15);
    });

    it('calculates the timing split for a 10-minute short interview', () => {
      const timing = calculatePhaseTiming(10);
      expect(timing.warmUpMin).toBe(2);
      expect(timing.deepDiveMin).toBe(6);
      expect(timing.pressureTestMin).toBe(2);
      expect(timing.warmUpMin + timing.deepDiveMin + timing.pressureTestMin).toBe(10);
    });

    it('calculates the timing split for an extended 30-minute interview', () => {
      const timing = calculatePhaseTiming(30);
      expect(timing.warmUpMin).toBe(6);
      expect(timing.deepDiveMin).toBe(17);
      expect(timing.pressureTestMin).toBe(7);
      expect(timing.warmUpMin + timing.deepDiveMin + timing.pressureTestMin).toBe(30);
    });

    it('calculates the timing split for an extended 45-minute interview', () => {
      const timing = calculatePhaseTiming(45);
      expect(timing.warmUpMin).toBe(9);
      expect(timing.deepDiveMin).toBe(25);
      expect(timing.pressureTestMin).toBe(11);
      expect(timing.warmUpMin + timing.deepDiveMin + timing.pressureTestMin).toBe(45);
    });
  });

  describe('3-Phase structure and content in buildBriefing()', () => {
    it('contains all 3 phases clearly labeled in sequence', () => {
      const briefing = buildBriefing({ roleId: 'software-engineer', timeLimitMin: 15 });

      expect(briefing).toContain('Phase 1: Warm-up & Architecture Overview');
      expect(briefing).toContain('Phase 2: Technical Deep-Dive into Trade-offs');
      expect(briefing).toContain('Phase 3: Pressure-Testing & Edge-Case Failure Scenarios');
    });

    it('includes explicit minute split allocated to each phase in the prompt text', () => {
      const briefing = buildBriefing({ roleId: 'software-engineer', timeLimitMin: 15 });

      expect(briefing).toContain('~3 minutes');
      expect(briefing).toContain('~8 minutes');
      expect(briefing).toContain('~4 minutes');
    });

    it('dynamically recalculates phase minutes when a different time limit is set', () => {
      const briefing30 = buildBriefing({ roleId: 'software-engineer', timeLimitMin: 30 });

      expect(briefing30).toContain('~6 minutes');
      expect(briefing30).toContain('~17 minutes');
      expect(briefing30).toContain('~7 minutes');
    });

    it('includes role-specific deep-dive trade-offs and pressure-test failure scenarios for Backend Developer', () => {
      const briefing = buildBriefing({ roleId: 'backend-developer' });

      // Phase 2 deep-dive trade-offs
      expect(briefing).toContain('database indexing (B-Tree vs Hash)');
      expect(briefing).toContain('connection pooling');
      expect(briefing).toContain('distributed caching');
      expect(briefing).toContain('REST vs gRPC');

      // Phase 3 pressure-testing scenarios
      expect(briefing).toContain('network partitions');
      expect(briefing).toContain('split-brain scenarios');
      expect(briefing).toContain('cascading microservice timeouts');
    });

    it('includes role-specific deep-dive trade-offs and pressure-test failure scenarios for Data Analyst', () => {
      const briefing = buildBriefing({ roleId: 'data-analyst' });

      // Phase 2 deep-dive trade-offs
      expect(briefing).toContain('SQL query optimization');
      expect(briefing).toContain('indexing strategies');
      expect(briefing).toContain('handling skewed data distributions');

      // Phase 3 pressure-testing scenarios
      expect(briefing).toContain('missing or corrupt data at scale');
      expect(briefing).toContain('conflicting metrics from upstream pipelines');
    });

    it('includes role-specific deep-dive trade-offs and pressure-test failure scenarios for Software Engineer', () => {
      const briefing = buildBriefing({ roleId: 'software-engineer' });

      // Phase 2 deep-dive trade-offs
      expect(briefing).toContain('data structures');
      expect(briefing).toContain('memory management vs CPU efficiency');
      expect(briefing).toContain('async I/O');

      // Phase 3 pressure-testing scenarios
      expect(briefing).toContain('sudden 10x traffic spikes');
      expect(briefing).toContain('race conditions in multi-threaded workflows');
    });

    it('instructs interviewer to ground Phase 1 in candidate resume projects and architecture', () => {
      const briefing = buildBriefing({
        roleId: 'software-engineer',
        resumeSummary: 'Built an e-commerce platform using Next.js, Redis, and PostgreSQL.',
      });

      expect(briefing).toContain('Phase 1: Warm-up & Architecture Overview');
      expect(briefing).toContain('resume projects, technologies, and system architecture');
      expect(briefing).toContain('Built an e-commerce platform using Next.js, Redis, and PostgreSQL.');
    });

    it('ensures session briefing generated via briefingFor() integrates the 3-phase progression', async () => {
      (prisma.resume.findFirst as any).mockResolvedValueOnce(null);

      const session = {
        id: 'sess-progression',
        role: 'backend-developer',
        userId: 'user-prog',
        resumeId: null,
        focus: 'High Throughput Message Queues',
        timeLimitMin: 20,
      };

      const briefing = await briefingFor(session);

      expect(briefing).toContain('INTERVIEW STRUCTURE & 3-PHASE QUESTION PROGRESSION');
      expect(briefing).toContain('Phase 1: Warm-up & Architecture Overview');
      expect(briefing).toContain('Phase 2: Technical Deep-Dive into Trade-offs');
      expect(briefing).toContain('Phase 3: Pressure-Testing & Edge-Case Failure Scenarios');
      expect(briefing).toContain('High Throughput Message Queues');
    });
  });
});
