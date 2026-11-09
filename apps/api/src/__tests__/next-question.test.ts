import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../server';
import prisma from '../utils/db';
import {
  generateNextQuestion,
  buildNextQuestionPrompt,
  InterviewerTimeoutError,
} from '../services/interviewer.service';

vi.mock('@supabase/supabase-js', () => {
  const getUserMock = vi.fn();
  return {
    createClient: vi.fn(() => ({ auth: { getUser: getUserMock } })),
    __getUserMock: getUserMock,
  };
});

vi.mock('../utils/db', () => ({
  default: {
    user: { findUnique: vi.fn() },
    session: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    resume: { findUnique: vi.fn() },
    turn: { create: vi.fn(), findMany: vi.fn(), count: vi.fn() },
  },
}));

vi.mock('../services/interviewer.service', async (importOriginal: () => Promise<any>) => {
  const actual = await importOriginal();
  return {
    ...actual,
    generateNextQuestion: vi.fn(),
  };
});

import * as supabase from '@supabase/supabase-js';
const { __getUserMock } = supabase as any;

const AUTH_USER = {
  id: 'user-1',
  supabaseUserId: 'supabase-user-1',
  email: 'prakriti@example.com',
  name: 'Prakriti',
};

function authHeader() {
  return 'Bearer valid-supabase-token';
}

const OWN_LIVE_SESSION = {
  id: 'sess-123',
  userId: AUTH_USER.id,
  role: 'software-engineer',
  status: 'LIVE',
  startedAt: new Date(Date.now() - 10_000),
  endedAt: null,
  createdAt: new Date(Date.now() - 10_000),
  resumeId: null,
};

describe('POST /api/sessions/:id/next-question (server-side interviewer)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __getUserMock.mockResolvedValue({
      data: { user: { id: AUTH_USER.supabaseUserId, email: AUTH_USER.email } },
      error: null,
    });
    (prisma.user.findUnique as any).mockResolvedValue({
      id: AUTH_USER.id,
      supabaseUserId: AUTH_USER.supabaseUserId,
      name: AUTH_USER.name,
      email: AUTH_USER.email,
      passwordHash: 'x',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    (prisma.session.findFirst as any).mockResolvedValue(OWN_LIVE_SESSION);
    (prisma.turn.findMany as any).mockResolvedValue([]);
  });

  describe('buildNextQuestionPrompt', () => {
    it('formats initial prompt when no previous turns exist', () => {
      const prompt = buildNextQuestionPrompt('Role: Software Engineer', []);
      expect(prompt).toContain('Role: Software Engineer');
      expect(prompt).toContain('(No turns yet. This is the start of the interview.)');
      expect(prompt).toContain('ask your opening warm-up question');
    });

    it('formats prompt with previous conversation history', () => {
      const turns = [
        { speaker: 'AI' as const, text: 'Tell me about your experience with TypeScript.' },
        { speaker: 'CANDIDATE' as const, text: 'I have used TypeScript on several full-stack projects.' },
      ];
      const prompt = buildNextQuestionPrompt('Role: Software Engineer', turns);
      expect(prompt).toContain('Interviewer: Tell me about your experience with TypeScript.');
      expect(prompt).toContain('Candidate: I have used TypeScript on several full-stack projects.');
      expect(prompt).toContain('ask a relevant follow-up question');
    });
  });

  describe('Route: POST /api/sessions/:id/next-question', () => {
    it('returns 200 and the generated AI question turn for an active session', async () => {
      const mockTurn = {
        id: 'turn-1',
        sessionId: OWN_LIVE_SESSION.id,
        speaker: 'AI',
        text: 'Tell me about a challenging distributed systems problem you solved.',
        timestampSec: 10.5,
        turnIndex: 1,
        createdAt: new Date().toISOString(),
      };
      (generateNextQuestion as any).mockResolvedValue(mockTurn);

      const res = await request(app)
        .post(`/api/sessions/${OWN_LIVE_SESSION.id}/next-question`)
        .set('Authorization', authHeader());

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual(mockTurn);
      expect(generateNextQuestion).toHaveBeenCalledWith(OWN_LIVE_SESSION.id, AUTH_USER.id);
    });

    it('calling next-question twice in a session returns two different questions saved as AI turns', async () => {
      const turn1 = {
        id: 'turn-1',
        sessionId: OWN_LIVE_SESSION.id,
        speaker: 'AI',
        text: 'Question 1: Explain the difference between process and thread.',
        timestampSec: 2.0,
        turnIndex: 1,
        createdAt: new Date().toISOString(),
      };
      const turn2 = {
        id: 'turn-2',
        sessionId: OWN_LIVE_SESSION.id,
        speaker: 'AI',
        text: 'Question 2: How would you design a rate limiter?',
        timestampSec: 15.0,
        turnIndex: 2,
        createdAt: new Date().toISOString(),
      };

      (generateNextQuestion as any)
        .mockResolvedValueOnce(turn1)
        .mockResolvedValueOnce(turn2);

      const res1 = await request(app)
        .post(`/api/sessions/${OWN_LIVE_SESSION.id}/next-question`)
        .set('Authorization', authHeader());

      const res2 = await request(app)
        .post(`/api/sessions/${OWN_LIVE_SESSION.id}/next-question`)
        .set('Authorization', authHeader());

      expect(res1.status).toBe(200);
      expect(res1.body.data.text).toBe('Question 1: Explain the difference between process and thread.');
      expect(res1.body.data.turnIndex).toBe(1);

      expect(res2.status).toBe(200);
      expect(res2.body.data.text).toBe('Question 2: How would you design a rate limiter?');
      expect(res2.body.data.turnIndex).toBe(2);
      expect(res1.body.data.text).not.toBe(res2.body.data.text);
    });

    it('returns 404 when session belongs to another user (FR-27)', async () => {
      const { NotFoundError } = await import('../utils/resource');
      (generateNextQuestion as any).mockRejectedValue(new NotFoundError());

      const res = await request(app)
        .post('/api/sessions/other-session/next-question')
        .set('Authorization', authHeader());

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe('Resource not found');
    });

    it('returns 409 when the session is already ENDED', async () => {
      const { SessionEndedError } = await import('../services/session.service');
      (generateNextQuestion as any).mockRejectedValue(new SessionEndedError());

      const res = await request(app)
        .post(`/api/sessions/${OWN_LIVE_SESSION.id}/next-question`)
        .set('Authorization', authHeader());

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe('This session has already ended');
    });

    it('returns 401 when no Authorization header is provided', async () => {
      const res = await request(app).post(`/api/sessions/${OWN_LIVE_SESSION.id}/next-question`);
      expect(res.status).toBe(401);
    });

    it('returns 503 when the LLM times out', async () => {
      (generateNextQuestion as any).mockRejectedValue(new InterviewerTimeoutError());

      const res = await request(app)
        .post(`/api/sessions/${OWN_LIVE_SESSION.id}/next-question`)
        .set('Authorization', authHeader());

      expect(res.status).toBe(503);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('timed out');
    });
  });
});
