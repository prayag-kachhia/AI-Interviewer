import { describe, it, expect, vi, beforeEach } from 'vitest';
import prisma from '../db';
import {
  generateNextQuestion,
  InterviewerTimeoutError,
} from '../services/interviewer.service';
import { SessionEndedError } from '../services/session.service';
import { NotFoundError } from '../errors';

vi.mock('../db', () => ({
  default: {
    session: { findFirst: vi.fn(), findMany: vi.fn() },
    resume: { findUnique: vi.fn() },
    turn: { create: vi.fn(), findMany: vi.fn(), count: vi.fn() },
  },
}));

const USER_ID = 'user-1';
const LIVE_SESSION = {
  id: 'sess-abc',
  userId: USER_ID,
  role: 'software-engineer',
  status: 'LIVE',
  startedAt: new Date(Date.now() - 5000),
  endedAt: null,
  createdAt: new Date(Date.now() - 5000),
  resumeId: 'resume-1',
};

describe('interviewer.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.session.findFirst as any).mockResolvedValue(LIVE_SESSION);
    (prisma.session.findMany as any).mockResolvedValue([]);
    (prisma.turn.findMany as any).mockResolvedValue([]);
    (prisma.turn.count as any).mockResolvedValue(0);
    (prisma.resume.findUnique as any).mockResolvedValue({
      id: 'resume-1',
      parsedProfile: JSON.stringify({
        name: 'Candidate',
        skills: ['React', 'TypeScript', 'Node.js'],
        projects: [],
        experience: ['Frontend Developer at Tech Corp'],
        education: [],
      }),
    });
    (prisma.turn.create as any).mockImplementation(({ data }: any) =>
      Promise.resolve({
        id: 'turn-new',
        ...data,
        createdAt: new Date().toISOString(),
      })
    );
  });

  it('generates a question using injected generator, cleans prefixes/quotes, and saves it as AI turn', async () => {
    let capturedPrompt = '';
    const mockGenerate = vi.fn().mockImplementation((prompt: string) => {
      capturedPrompt = prompt;
      return Promise.resolve('Interviewer: "Can you explain how React handles reconcilation under the hood?"');
    });

    const result = await generateNextQuestion(LIVE_SESSION.id, USER_ID, {
      generate: mockGenerate,
    });

    expect(mockGenerate).toHaveBeenCalledTimes(1);
    expect(capturedPrompt).toContain('ROLE & PERSONA:');
    expect(capturedPrompt).toContain('Software Engineer');
    expect(capturedPrompt).toContain('Tech Corp'); // from resume
    expect(result.speaker).toBe('AI');
    expect(result.text).toBe('Can you explain how React handles reconcilation under the hood?');
    expect(result.turnIndex).toBe(1);
  });

  it('throws NotFoundError if session is not owned by user', async () => {
    (prisma.session.findFirst as any).mockResolvedValue(null);

    await expect(
      generateNextQuestion('other-session', USER_ID, { generate: vi.fn() })
    ).rejects.toThrow(NotFoundError);
  });

  it('throws SessionEndedError if session is not LIVE', async () => {
    (prisma.session.findFirst as any).mockResolvedValue({
      ...LIVE_SESSION,
      status: 'ENDED',
      endedAt: new Date(),
    });

    await expect(
      generateNextQuestion(LIVE_SESSION.id, USER_ID, { generate: vi.fn() })
    ).rejects.toThrow(SessionEndedError);
  });

  it('throws an error if generated question text is empty or whitespace', async () => {
    const mockGenerate = vi.fn().mockResolvedValue('   ');

    await expect(
      generateNextQuestion(LIVE_SESSION.id, USER_ID, { generate: mockGenerate })
    ).rejects.toThrow('Generated question was empty');
  });

  it('handles LLM timeout properly', async () => {
    const mockGenerate = vi.fn().mockRejectedValue(new InterviewerTimeoutError());

    await expect(
      generateNextQuestion(LIVE_SESSION.id, USER_ID, { generate: mockGenerate })
    ).rejects.toThrow(InterviewerTimeoutError);
  });
});
