import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../server';
import prisma from '../utils/db';
import { DeterministicQuestionProvider } from '../services/question.service';

vi.mock('@supabase/supabase-js', () => {
  const getUserMock = vi.fn();
  return {
    createClient: vi.fn(() => ({ auth: { getUser: getUserMock } })),
    __getUserMock: getUserMock,
  };
});

vi.mock('../utils/db', () => ({
  default: {
    user: {
      findUnique: vi.fn(),
    },
    session: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
    },
    turn: {
      create: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
    feedback: {
      upsert: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock('../services/evaluator.service', () => ({
  evaluateTranscript: vi.fn().mockResolvedValue({ summary: 'Good', scores: [] }),
}));

import * as supabase from '@supabase/supabase-js';
const { __getUserMock } = supabase as any;

const AUTH_USER = {
  id: 'user-1',
  supabaseUserId: 'supabase-user-1',
  email: 'kishan@example.com',
  name: 'Kishan',
};

function authHeader() {
  return 'Bearer valid-supabase-token';
}

describe('Live Session — LS2 (create session) & LS4 (turns, end session)', () => {
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
  });

  describe('POST /api/sessions & GET /api/sessions (LS2)', () => {
    // TEST 1: valid role creates session
    it('TEST 1: creates a session for a valid role', async () => {
      (prisma.session.create as any).mockResolvedValueOnce({
        id: 'sess-1',
        userId: AUTH_USER.id,
        role: 'software-engineer',
        status: 'LIVE',
        startedAt: new Date(),
        endedAt: null,
        createdAt: new Date(),
      });

      const res = await request(app)
        .post('/api/sessions')
        .set('Authorization', authHeader())
        .send({ roleId: 'software-engineer' });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe('sess-1');
      expect(res.body.data.role).toBe('software-engineer');
      expect(res.body.data.status).toBe('LIVE');
      expect(prisma.session.create).toHaveBeenCalledWith({
        data: { userId: AUTH_USER.id, role: 'software-engineer' },
      });
    });

    // TEST 2: unknown role returns 400
    it('TEST 2: rejects an unknown role id with HTTP 400', async () => {
      const res = await request(app)
        .post('/api/sessions')
        .set('Authorization', authHeader())
        .send({ roleId: 'role-that-does-not-exist' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    // TEST 3: invalid role does not create Session
    it('TEST 3: does not call Session.create when roleId is invalid or missing', async () => {
      const resUnknown = await request(app)
        .post('/api/sessions')
        .set('Authorization', authHeader())
        .send({ roleId: 'astronaut' });

      const resEmpty = await request(app)
        .post('/api/sessions')
        .set('Authorization', authHeader())
        .send({ roleId: '' });

      expect(resUnknown.status).toBe(400);
      expect(resEmpty.status).toBe(400);
      expect(prisma.session.create).not.toHaveBeenCalled();
    });

    // TEST 4: authenticated user can create/access own session (and cannot access another user's session)
    it('TEST 4: authenticated user can access their own session and turns, while another user gets 404', async () => {
      const startedAt = new Date(Date.now() - 15_000);
      (prisma.session.findFirst as any)
        .mockResolvedValueOnce({
          id: 'sess-1',
          userId: AUTH_USER.id,
          role: 'software-engineer',
          status: 'LIVE',
          startedAt,
          endedAt: null,
        })
        .mockResolvedValueOnce({
          id: 'sess-1',
          userId: AUTH_USER.id,
          role: 'software-engineer',
          status: 'LIVE',
          startedAt,
          endedAt: null,
        });
      (prisma.turn.findMany as any).mockResolvedValueOnce([
        {
          id: 'turn-1',
          sessionId: 'sess-1',
          speaker: 'AI',
          text: 'Tell me about yourself.',
          timestampSec: 0.5,
          turnIndex: 1,
          createdAt: new Date(),
        },
      ]);

      const ownRes = await request(app)
        .get('/api/sessions/sess-1')
        .set('Authorization', authHeader());

      expect(ownRes.status).toBe(200);
      expect(ownRes.body.data.id).toBe('sess-1');
      expect(ownRes.body.data.turns).toHaveLength(1);
      expect(prisma.session.findFirst).toHaveBeenCalledWith({
        where: { id: 'sess-1', userId: AUTH_USER.id },
      });

      // Another user's session returns 404
      (prisma.session.findFirst as any).mockResolvedValueOnce(null);
      const otherRes = await request(app)
        .get('/api/sessions/other-user-session')
        .set('Authorization', authHeader());
      expect(otherRes.status).toBe(404);
    });

    it('requires authentication for POST /api/sessions', async () => {
      const res = await request(app).post('/api/sessions').send({ roleId: 'software-engineer' });
      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/sessions/:id/turns & GET /api/sessions/:id/turns (LS4)', () => {
    // TEST 5: turn can be stored for own live session
    it('TEST 5: stores a turn for the authenticated user\'s own live session', async () => {
      const startedAt = new Date(Date.now() - 30_000); // session live for ~30s
      (prisma.session.findFirst as any).mockResolvedValueOnce({
        id: 'sess-1',
        userId: AUTH_USER.id,
        role: 'software-engineer',
        status: 'LIVE',
        startedAt,
        endedAt: null,
      });
      (prisma.turn.count as any).mockResolvedValueOnce(0);
      (prisma.turn.create as any).mockResolvedValueOnce({
        id: 'turn-1',
        sessionId: 'sess-1',
        speaker: 'CANDIDATE',
        text: 'I am a third year ICT student.',
        timestampSec: 20,
        turnIndex: 1,
        createdAt: new Date(),
      });

      const res = await request(app)
        .post('/api/sessions/sess-1/turns')
        .set('Authorization', authHeader())
        .send({ speaker: 'CANDIDATE', text: 'I am a third year ICT student.', timestampSec: 20 });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.turnIndex).toBe(1);
      expect(res.body.data.speaker).toBe('CANDIDATE');
    });

    // TEST 6: turn from another user's session is rejected
    it('TEST 6: rejects posting or listing turns for another user\'s session with 404', async () => {
      (prisma.session.findFirst as any).mockResolvedValueOnce(null);

      const res = await request(app)
        .post('/api/sessions/not-mine/turns')
        .set('Authorization', authHeader())
        .send({ speaker: 'CANDIDATE', text: 'hi', timestampSec: 1 });

      expect(res.status).toBe(404);
      expect(prisma.turn.create).not.toHaveBeenCalled();

      (prisma.session.findFirst as any).mockResolvedValueOnce(null);
      const getTurnsRes = await request(app)
        .get('/api/sessions/not-mine/turns')
        .set('Authorization', authHeader());
      expect(getTurnsRes.status).toBe(404);
    });

    // TEST 7: future timestamp is rejected
    it('TEST 7: rejects a turn whose timestampSec is greater than the session elapsed time', async () => {
      const startedAt = new Date(Date.now() - 30_000); // ~30s elapsed
      (prisma.session.findFirst as any).mockResolvedValueOnce({
        id: 'sess-1',
        userId: AUTH_USER.id,
        role: 'software-engineer',
        status: 'LIVE',
        startedAt,
        endedAt: null,
      });

      const res = await request(app)
        .post('/api/sessions/sess-1/turns')
        .set('Authorization', authHeader())
        .send({ speaker: 'CANDIDATE', text: 'From the future', timestampSec: 45 });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(prisma.turn.create).not.toHaveBeenCalled();
    });

    // TEST 8: turn after session ended is rejected
    it('TEST 8: rejects a turn submitted after the session has ended with 409', async () => {
      (prisma.session.findFirst as any).mockResolvedValueOnce({
        id: 'sess-1',
        userId: AUTH_USER.id,
        role: 'software-engineer',
        status: 'ENDED',
        startedAt: new Date(Date.now() - 60_000),
        endedAt: new Date(Date.now() - 5_000),
      });

      const res = await request(app)
        .post('/api/sessions/sess-1/turns')
        .set('Authorization', authHeader())
        .send({ speaker: 'CANDIDATE', text: 'Too late', timestampSec: 10 });

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(prisma.turn.create).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/sessions/:id/end (LS4)', () => {
    // TEST 9: end session changes status to ENDED
    it('TEST 9: changes session status to ENDED and sets endedAt', async () => {
      const endedAt = new Date();
      (prisma.session.findFirst as any).mockResolvedValueOnce({
        id: 'sess-1',
        userId: AUTH_USER.id,
        role: 'software-engineer',
        status: 'LIVE',
        startedAt: new Date(Date.now() - 60_000),
        endedAt: null,
      });
      (prisma.session.update as any).mockReturnValue('session-update-op');
      (prisma.feedback.upsert as any).mockReturnValue('feedback-upsert-op');
      (prisma.session.findUniqueOrThrow as any).mockResolvedValueOnce({
        id: 'sess-1',
        userId: AUTH_USER.id,
        role: 'software-engineer',
        status: 'ENDED',
        turns: [],
      });
      (prisma.$transaction as any).mockResolvedValueOnce([
        { id: 'sess-1', userId: AUTH_USER.id, role: 'software-engineer', status: 'ENDED', endedAt },
        { id: 'fb-1', sessionId: 'sess-1', status: 'pending' },
      ]);

      const res = await request(app)
        .post('/api/sessions/sess-1/end')
        .set('Authorization', authHeader());

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('ENDED');
      expect(res.body.data.endedAt).toBeDefined();
      expect(prisma.session.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'sess-1' },
          data: expect.objectContaining({ status: 'ENDED', endedAt: expect.any(Date) }),
        })
      );
    });

    // TEST 10: end session creates pending feedback
    it('TEST 10: creates/upserts a feedback record with pending status when ending a session', async () => {
      (prisma.session.findFirst as any).mockResolvedValueOnce({
        id: 'sess-1',
        userId: AUTH_USER.id,
        role: 'software-engineer',
        status: 'LIVE',
        startedAt: new Date(Date.now() - 60_000),
        endedAt: null,
      });
      (prisma.session.findUniqueOrThrow as any).mockResolvedValueOnce({
        id: 'sess-1',
        userId: AUTH_USER.id,
        role: 'software-engineer',
        status: 'ENDED',
        turns: [],
      });
      (prisma.session.update as any).mockReturnValue('session-update-op');
      (prisma.feedback.upsert as any).mockReturnValue('feedback-upsert-op');
      (prisma.$transaction as any).mockResolvedValueOnce([
        { id: 'sess-1', status: 'ENDED', endedAt: new Date(), role: 'software-engineer' },
        { id: 'fb-1', sessionId: 'sess-1', status: 'pending' },
      ]);

      await request(app)
        .post('/api/sessions/sess-1/end')
        .set('Authorization', authHeader());

      expect(prisma.feedback.upsert).toHaveBeenCalledWith({
        where: { sessionId: 'sess-1' },
        create: {
          sessionId: 'sess-1',
          status: 'pending',
        },
        update: {
          status: 'pending',
        },
      });
    });

    // TEST 11: Session update + Feedback upsert are atomic
    it('TEST 11: executes Session update and Feedback upsert atomically in one $transaction and rolls back on failure', async () => {
      (prisma.session.findFirst as any).mockResolvedValueOnce({
        id: 'sess-1',
        userId: AUTH_USER.id,
        role: 'software-engineer',
        status: 'LIVE',
        startedAt: new Date(Date.now() - 60_000),
        endedAt: null,
      });
      (prisma.session.update as any).mockReturnValue('session-update-promise');
      (prisma.feedback.upsert as any).mockReturnValue('feedback-upsert-promise');
      (prisma.$transaction as any).mockRejectedValueOnce(new Error('DB transaction aborted'));

      const res = await request(app)
        .post('/api/sessions/sess-1/end')
        .set('Authorization', authHeader());

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.$transaction).toHaveBeenCalledWith([
        'session-update-promise',
        'feedback-upsert-promise',
      ]);
      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
    });

    // TEST 12: duplicate/end request does not create inconsistent state
    it('TEST 12: handles duplicate end-session requests idempotently without creating duplicate feedback', async () => {
      const endedAt = new Date(Date.now() - 10_000);
      (prisma.session.findFirst as any).mockResolvedValueOnce({
        id: 'sess-1',
        userId: AUTH_USER.id,
        role: 'software-engineer',
        status: 'ENDED',
        startedAt: new Date(Date.now() - 60_000),
        endedAt,
      });

      const res = await request(app)
        .post('/api/sessions/sess-1/end')
        .set('Authorization', authHeader());

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('ENDED');
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.feedback.upsert).not.toHaveBeenCalled();
    });

    it('returns 404 when ending another user\'s session', async () => {
      (prisma.session.findFirst as any).mockResolvedValueOnce(null);

      const res = await request(app)
        .post('/api/sessions/not-mine/end')
        .set('Authorization', authHeader());

      expect(res.status).toBe(404);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('DeterministicQuestionProvider (LS4 local question stub)', () => {
    it('returns role-specific initial question, references preceding candidate answer, and never repeats questions', () => {
      const provider = new DeterministicQuestionProvider();
      const q1 = provider.getInitialQuestion('software-engineer');
      expect(q1).toContain('software engineering');

      const transcript: { speaker: 'AI' | 'CANDIDATE'; text: string }[] = [
        { speaker: 'AI', text: q1 },
        { speaker: 'CANDIDATE', text: 'I am a third year ICT student building full-stack web apps.' },
      ];

      const q2 = provider.getNextQuestion('software-engineer', transcript);
      expect(q2).toBeTruthy();
      expect(q2).not.toBe(q1);
      // Follow-up references the candidate's preceding answer
      expect(q2!.toLowerCase()).toContain('third year ict student');

      // Ensure no duplicate questions across the entire interview script
      const seen = new Set<string>([q1]);
      let current = q2;
      while (current) {
        expect(seen.has(current)).toBe(false);
        seen.add(current);
        transcript.push({ speaker: 'AI', text: current });
        transcript.push({ speaker: 'CANDIDATE', text: 'I worked closely with my team to deliver the solution.' });
        current = provider.getNextQuestion('software-engineer', transcript);
      }
      expect(seen.size).toBeGreaterThanOrEqual(4);
    });
  });
});
