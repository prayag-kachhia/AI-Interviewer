import { describe, it, expect, vi, beforeEach } from 'vitest';
import prisma from '../db';
import { recentQuestions } from '../services/session.service';

vi.mock('../db', () => ({
  default: {
    session: {
      findMany: vi.fn(),
    },
    turn: {
      findMany: vi.fn(),
    },
  },
}));

describe('PK-7 — recentQuestions(userId, roleId, 3) (FR-16)', () => {
  const USER_ID = 'candidate-101';
  const ROLE_ID = 'software-engineer';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns an empty array when the candidate has no past ended sessions for the role', async () => {
    (prisma.session.findMany as any).mockResolvedValue([]);

    const questions = await recentQuestions(USER_ID, ROLE_ID, 3);

    expect(questions).toEqual([]);
    expect(prisma.session.findMany).toHaveBeenCalledWith({
      where: {
        userId: USER_ID,
        role: ROLE_ID,
        status: 'ENDED',
      },
      orderBy: { endedAt: 'desc' },
      take: 3,
      select: { id: true },
    });
    expect(prisma.turn.findMany).not.toHaveBeenCalled();
  });

  it('queries the last 3 ended sessions and returns only AI questions', async () => {
    const mockSessions = [
      { id: 'sess-1' },
      { id: 'sess-2' },
      { id: 'sess-3' },
    ];
    (prisma.session.findMany as any).mockResolvedValue(mockSessions);

    const mockAiTurns = [
      { text: 'Explain how you design a cache invalidation strategy.' },
      { text: 'What is the difference between TCP and UDP in web transport?' },
      { text: 'How do you optimize React re-renders?' },
    ];
    (prisma.turn.findMany as any).mockResolvedValue(mockAiTurns);

    const questions = await recentQuestions(USER_ID, ROLE_ID, 3);

    expect(prisma.session.findMany).toHaveBeenCalledWith({
      where: {
        userId: USER_ID,
        role: ROLE_ID,
        status: 'ENDED',
      },
      orderBy: { endedAt: 'desc' },
      take: 3,
      select: { id: true },
    });

    expect(prisma.turn.findMany).toHaveBeenCalledWith({
      where: {
        sessionId: { in: ['sess-1', 'sess-2', 'sess-3'] },
        speaker: 'AI',
      },
      orderBy: { turnIndex: 'asc' },
      take: 30,
      select: { text: true },
    });

    expect(questions).toEqual([
      'Explain how you design a cache invalidation strategy.',
      'What is the difference between TCP and UDP in web transport?',
      'How do you optimize React re-renders?',
    ]);
  });

  it('caps at 30 questions and trims whitespace', async () => {
    (prisma.session.findMany as any).mockResolvedValue([{ id: 'sess-1' }]);
    (prisma.turn.findMany as any).mockResolvedValue([
      { text: '  Question with whitespace  ' },
      { text: '' },
    ]);

    const questions = await recentQuestions(USER_ID, ROLE_ID, 3);

    expect(questions).toEqual(['Question with whitespace']);
  });
});
