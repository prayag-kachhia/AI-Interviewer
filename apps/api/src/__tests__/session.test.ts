import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../server';
import prisma from '../db';
import { EARLY_END_THRESHOLD_MINUTES, computeOverallScore } from '../services/session.service';

vi.mock('@supabase/supabase-js', () => {
  const getUserMock = vi.fn();
  return {
    createClient: vi.fn(() => ({ auth: { getUser: getUserMock } })),
    __getUserMock: getUserMock,
  };
});

vi.mock('../db', () => ({
  default: {
    user: {
      findUnique: vi.fn(),
    },
    session: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    resume: {
      findFirst: vi.fn(),
    },
    turn: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
    },
    job: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  },
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
    (prisma.resume.findFirst as any).mockResolvedValue(null);
    (prisma.turn.findFirst as any).mockResolvedValue(null);
  });

  describe('POST /api/sessions & GET /api/sessions (LS2)', () => {
    // TEST 1: valid role creates session
    it('TEST 1: creates a session for a valid role (without resume)', async () => {
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
        data: { userId: AUTH_USER.id, role: 'software-engineer', resumeId: null },
      });
    });

    it('creates a session attaching the latest resumeId when user has a resume', async () => {
      (prisma.resume.findFirst as any).mockResolvedValueOnce({
        id: 'res-latest',
      });
      (prisma.session.create as any).mockResolvedValueOnce({
        id: 'sess-2',
        userId: AUTH_USER.id,
        role: 'software-engineer',
        resumeId: 'res-latest',
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
      expect(res.body.data.id).toBe('sess-2');
      expect(prisma.resume.findFirst).toHaveBeenCalledWith({
        where: { userId: AUTH_USER.id },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });
      expect(prisma.session.create).toHaveBeenCalledWith({
        data: { userId: AUTH_USER.id, role: 'software-engineer', resumeId: 'res-latest' },
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

    it('requires authentication for GET /api/sessions', async () => {
      const res = await request(app).get('/api/sessions');
      expect(res.status).toBe(401);
    });

    it('GET /api/sessions: returns only sessions belonging to the authenticated user sorted newest first with role, date, status, feedbackStatus, overallScore, and endedEarly', async () => {
      const now = Date.now();
      const mockSessions = [
        {
          id: 'sess-new',
          userId: AUTH_USER.id,
          role: 'backend-developer',
          status: 'ENDED',
          startedAt: new Date(now - 1000 * 60 * EARLY_END_THRESHOLD_MINUTES),
          endedAt: new Date(now - 1000 * 60 * (EARLY_END_THRESHOLD_MINUTES - 4)), // 4 mins (< EARLY_END_THRESHOLD_MINUTES -> endedEarly true)
          createdAt: new Date(now - 1000 * 60 * EARLY_END_THRESHOLD_MINUTES),
          feedback: {
            status: 'ready',
            scores: [
              { category: 'API Design & Architecture', score: 4 },
              { category: 'Database Modeling & Performance', score: 5 },
              { category: 'System Reliability & Scalability', score: 3 },
            ],
          },
        },
        {
          id: 'sess-old',
          userId: AUTH_USER.id,
          role: 'software-engineer',
          status: 'ENDED',
          startedAt: new Date(now - 1000 * 60 * (EARLY_END_THRESHOLD_MINUTES + 15)),
          endedAt: new Date(now - 1000 * 60 * 5), // (EARLY_END_THRESHOLD_MINUTES + 10) mins (>= EARLY_END_THRESHOLD_MINUTES -> endedEarly false)
          createdAt: new Date(now - 1000 * 60 * (EARLY_END_THRESHOLD_MINUTES + 15)),
          feedback: { status: 'failed', scores: null },
        },
        {
          id: 'sess-live',
          userId: AUTH_USER.id,
          role: 'data-analyst',
          status: 'LIVE',
          startedAt: new Date(now - 1000 * 60 * 2),
          endedAt: null,
          createdAt: new Date(now - 1000 * 60 * 2),
          feedback: null,
        },
      ];

      (prisma.session.findMany as any).mockResolvedValueOnce(mockSessions);

      const res = await request(app)
        .get('/api/sessions')
        .set('Authorization', authHeader());

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(3);
      expect(prisma.session.findMany).toHaveBeenCalledWith({
        where: { userId: AUTH_USER.id },
        orderBy: { createdAt: 'desc' },
        include: { feedback: { select: { status: true, scores: true } } },
      });

      const [newEndedSession, oldEndedSession, liveSession] = res.body.data;

      // Session 1: Ended, ready feedback with category scores -> overallScore = average (4 + 5 + 3) / 3 = 4
      expect(newEndedSession.id).toBe('sess-new');
      expect(newEndedSession.role).toBe('backend-developer');
      expect(newEndedSession.status).toBe('ENDED');
      expect(newEndedSession.startedAt).toBeDefined();
      expect(newEndedSession.createdAt).toBeDefined();
      expect(newEndedSession.feedbackStatus).toBe('ready');
      expect(newEndedSession.overallScore).toBe(4);
      expect(newEndedSession.endedEarly).toBe(true);

      // Session 2: Ended, failed feedback -> overallScore = null
      expect(oldEndedSession.id).toBe('sess-old');
      expect(oldEndedSession.role).toBe('software-engineer');
      expect(oldEndedSession.status).toBe('ENDED');
      expect(oldEndedSession.feedbackStatus).toBe('failed');
      expect(oldEndedSession.overallScore).toBeNull();
      expect(oldEndedSession.endedEarly).toBe(false);

      // Session 3: Live session -> endedEarly = false, feedbackStatus = null, overallScore = null
      expect(liveSession.id).toBe('sess-live');
      expect(liveSession.role).toBe('data-analyst');
      expect(liveSession.status).toBe('LIVE');
      expect(liveSession.feedbackStatus).toBeNull();
      expect(liveSession.overallScore).toBeNull();
      expect(liveSession.endedEarly).toBe(false);
    });

    it('GET /api/sessions: proves that another user\'s sessions never appear', async () => {
      // Simulate database with sessions belonging to both AUTH_USER and a different user
      const allDatabaseSessions = [
        {
          id: 'own-sess-1',
          userId: AUTH_USER.id,
          role: 'backend-developer',
          status: 'ENDED',
          startedAt: new Date(),
          endedAt: new Date(),
          createdAt: new Date(),
          feedback: { status: 'ready', scores: [{ category: 'API', score: 5 }] },
        },
        {
          id: 'foreign-sess-1',
          userId: 'attacker-or-other-user-id',
          role: 'software-engineer',
          status: 'ENDED',
          startedAt: new Date(),
          endedAt: new Date(),
          createdAt: new Date(),
          feedback: { status: 'ready', scores: [{ category: 'Algorithms', score: 1 }] },
        },
      ];

      (prisma.session.findMany as any).mockImplementationOnce(async ({ where }: any) => {
        return allDatabaseSessions.filter((s) => s.userId === where.userId);
      });

      const res = await request(app)
        .get('/api/sessions')
        .set('Authorization', authHeader());

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].id).toBe('own-sess-1');
      expect(res.body.data[0].userId).toBe(AUTH_USER.id);
      // Explicitly prove foreign session is absent
      expect(res.body.data.some((s: any) => s.id === 'foreign-sess-1')).toBe(false);
      expect(res.body.data.some((s: any) => s.userId !== AUTH_USER.id)).toBe(false);
      expect(prisma.session.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: AUTH_USER.id },
        })
      );
    });

    it('GET /api/sessions: correctly calculates endedEarly using the named constant threshold', async () => {
      const now = Date.now();
      const mockSessions = [
        // Just under threshold (14m 59s) -> endedEarly: true
        {
          id: 'sess-under',
          userId: AUTH_USER.id,
          role: 'software-engineer',
          status: 'ENDED',
          startedAt: new Date(now - 1000 * 60 * 20),
          endedAt: new Date(now - 1000 * 60 * 20 + (EARLY_END_THRESHOLD_MINUTES * 60_000 - 1000)),
          createdAt: new Date(now - 1000 * 60 * 20),
          feedback: null,
        },
        // Exactly threshold (15m 00s) -> endedEarly: false
        {
          id: 'sess-exact',
          userId: AUTH_USER.id,
          role: 'software-engineer',
          status: 'ENDED',
          startedAt: new Date(now - 1000 * 60 * 20),
          endedAt: new Date(now - 1000 * 60 * 20 + EARLY_END_THRESHOLD_MINUTES * 60_000),
          createdAt: new Date(now - 1000 * 60 * 20),
          feedback: null,
        },
        // Over threshold (15m 01s) -> endedEarly: false
        {
          id: 'sess-over',
          userId: AUTH_USER.id,
          role: 'software-engineer',
          status: 'ENDED',
          startedAt: new Date(now - 1000 * 60 * 20),
          endedAt: new Date(now - 1000 * 60 * 20 + (EARLY_END_THRESHOLD_MINUTES * 60_000 + 1000)),
          createdAt: new Date(now - 1000 * 60 * 20),
          feedback: null,
        },
      ];

      (prisma.session.findMany as any).mockResolvedValueOnce(mockSessions);

      const res = await request(app)
        .get('/api/sessions')
        .set('Authorization', authHeader());

      expect(res.status).toBe(200);
      const [under, exact, over] = res.body.data;
      expect(under.endedEarly).toBe(true);
      expect(exact.endedEarly).toBe(false);
      expect(over.endedEarly).toBe(false);
    });

    it('computeOverallScore: returns null for null, empty or non-array inputs', () => {
      expect(computeOverallScore(null)).toBeNull();
      expect(computeOverallScore(undefined)).toBeNull();
      expect(computeOverallScore([])).toBeNull();
      expect(computeOverallScore('invalid')).toBeNull();
      expect(computeOverallScore(123)).toBeNull();
    });

    it('computeOverallScore: computes rounded average for category scores', () => {
      const scores = [
        { category: 'A', score: 4 },
        { category: 'B', score: 3 },
        { category: 'C', score: 5 },
      ];
      expect(computeOverallScore(scores)).toBe(4);
    });

    it('computeOverallScore: rounds average to 1 decimal place when fractional', () => {
      const scores = [
        { category: 'A', score: 4 },
        { category: 'B', score: 3 },
      ];
      expect(computeOverallScore(scores)).toBe(3.5);

      const scores2 = [
        { category: 'A', score: 4 },
        { category: 'B', score: 4 },
        { category: 'C', score: 3 },
      ];
      expect(computeOverallScore(scores2)).toBe(3.7);
    });

    it('computeOverallScore: ignores Infinity, -Infinity, and NaN', () => {
      const allNonFinite = [
        { category: 'A', score: Infinity },
        { category: 'B', score: -Infinity },
        { category: 'C', score: NaN },
      ];
      expect(computeOverallScore(allNonFinite)).toBeNull();

      const mixedWithValid = [
        { category: 'A', score: 4 },
        { category: 'B', score: Infinity },
        { category: 'C', score: NaN },
        { category: 'D', score: 2 },
      ];
      expect(computeOverallScore(mixedWithValid)).toBe(3);
    });

    it('computeOverallScore: ignores scores below 1 and scores above 5', () => {
      const outOfRange = [
        { category: 'A', score: 0 },
        { category: 'B', score: -5 },
        { category: 'C', score: 6 },
        { category: 'D', score: 100 },
      ];
      expect(computeOverallScore(outOfRange)).toBeNull();

      const mixedWithValid = [
        { category: 'A', score: 0 },
        { category: 'B', score: 5 },
        { category: 'C', score: 6 },
        { category: 'D', score: 3 },
      ];
      expect(computeOverallScore(mixedWithValid)).toBe(4);
    });

    it('computeOverallScore: ignores malformed score objects and non-objects in the array', () => {
      const malformed = [
        {},
        { category: 'A' },
        { score: '5' },
        { score: null },
        { score: undefined },
        { score: [4] },
        { score: { value: 4 } },
        null,
        undefined,
        'malformed string',
        123,
      ];
      expect(computeOverallScore(malformed)).toBeNull();

      const mixedWithValid = [
        {},
        { category: 'A', score: 4 },
        null,
        'not an object',
        { score: '5' },
        { category: 'B', score: 2 },
      ];
      expect(computeOverallScore(mixedWithValid)).toBe(3);
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
        .send({ speaker: 'CANDIDATE', text: 'I am a third year ICT student.' });

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
        .send({ speaker: 'CANDIDATE', text: 'hi' });

      expect(res.status).toBe(404);
      expect(prisma.turn.create).not.toHaveBeenCalled();

      (prisma.session.findFirst as any).mockResolvedValueOnce(null);
      const getTurnsRes = await request(app)
        .get('/api/sessions/not-mine/turns')
        .set('Authorization', authHeader());
      expect(getTurnsRes.status).toBe(404);
    });

    // TEST 7: server assigns the timestamp
    it('TEST 7: server assigns the timestamp (stores server elapsed time even if client clock is 10 minutes ahead)', async () => {
      const thirtySecAgo = new Date(Date.now() - 30_000); // ~30s elapsed
      (prisma.session.findFirst as any).mockResolvedValueOnce({
        id: 'sess-1',
        userId: AUTH_USER.id,
        role: 'software-engineer',
        status: 'LIVE',
        startedAt: thirtySecAgo,
        endedAt: null,
      });
      (prisma.turn.count as any).mockResolvedValueOnce(0);
      (prisma.turn.create as any).mockImplementationOnce(async ({ data }: any) => ({
        id: 'turn-1',
        ...data,
        createdAt: new Date(),
      }));

      // Client clock is 10 minutes ahead and sends timestampSec = 600 or any value
      const res = await request(app)
        .post('/api/sessions/sess-1/turns')
        .set('Authorization', authHeader())
        .send({ speaker: 'CANDIDATE', text: 'My clock is 10 minutes ahead', timestampSec: 600 });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(prisma.turn.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            sessionId: 'sess-1',
            speaker: 'CANDIDATE',
            text: 'My clock is 10 minutes ahead',
            timestampSec: expect.any(Number),
          }),
        })
      );

      const createdTurnCall = (prisma.turn.create as any).mock.calls[0][0];
      // Stored timestamp must reflect server elapsed time (~30s), NOT the client's 600s
      expect(createdTurnCall.data.timestampSec).toBeGreaterThanOrEqual(29);
      expect(createdTurnCall.data.timestampSec).toBeLessThan(35);
      expect(res.body.data.timestampSec).toBeGreaterThanOrEqual(29);
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
        .send({ speaker: 'CANDIDATE', text: 'Too late' });

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
      (prisma.job.create as any).mockReturnValue('job-create-op');
      (prisma.$transaction as any).mockResolvedValueOnce([
        { id: 'sess-1', userId: AUTH_USER.id, role: 'software-engineer', status: 'ENDED', endedAt },
        { id: 'job-1', type: 'session.ended', sessionId: 'sess-1', status: 'pending' },
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

    // TEST 10: end session creates session.ended Job
    it('TEST 10: creates a session.ended job with pending status when ending a session', async () => {
      (prisma.session.findFirst as any).mockResolvedValueOnce({
        id: 'sess-1',
        userId: AUTH_USER.id,
        role: 'software-engineer',
        status: 'LIVE',
        startedAt: new Date(Date.now() - 60_000),
        endedAt: null,
      });
      (prisma.session.update as any).mockReturnValue('session-update-op');
      (prisma.job.create as any).mockReturnValue('job-create-op');
      (prisma.$transaction as any).mockResolvedValueOnce([
        { id: 'sess-1', status: 'ENDED', endedAt: new Date() },
        { id: 'job-1', type: 'session.ended', sessionId: 'sess-1', status: 'pending' },
      ]);

      await request(app)
        .post('/api/sessions/sess-1/end')
        .set('Authorization', authHeader());

      expect(prisma.job.create).toHaveBeenCalledWith({
        data: {
          type: 'session.ended',
          sessionId: 'sess-1',
          status: 'pending',
        },
      });
    });

    // TEST 11: Session update + Job insertion are atomic
    it('TEST 11: executes Session update and Job insertion atomically in one $transaction and rolls back on failure', async () => {
      (prisma.session.findFirst as any).mockResolvedValueOnce({
        id: 'sess-1',
        userId: AUTH_USER.id,
        role: 'software-engineer',
        status: 'LIVE',
        startedAt: new Date(Date.now() - 60_000),
        endedAt: null,
      });
      (prisma.session.update as any).mockReturnValue('session-update-promise');
      (prisma.job.create as any).mockReturnValue('job-create-promise');
      (prisma.$transaction as any).mockRejectedValueOnce(new Error('DB transaction aborted'));

      const res = await request(app)
        .post('/api/sessions/sess-1/end')
        .set('Authorization', authHeader());

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.$transaction).toHaveBeenCalledWith([
        'session-update-promise',
        'job-create-promise',
      ]);
      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
    });

    // TEST 12: duplicate/end request does not create inconsistent state
    it('TEST 12: handles duplicate end-session requests idempotently without creating duplicate jobs', async () => {
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
      expect(prisma.job.create).not.toHaveBeenCalled();
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

  describe('DELETE /api/sessions/:id (FR-28)', () => {
    // TEST 1: Owner deletes own session
    it('TEST 1: owner deletes own session successfully', async () => {
      (prisma.session.findFirst as any).mockResolvedValueOnce({
        id: 'sess-1',
        userId: AUTH_USER.id,
        role: 'software-engineer',
        status: 'ENDED',
        startedAt: new Date(Date.now() - 60_000),
        endedAt: new Date(),
      });
      (prisma.session.delete as any).mockResolvedValueOnce({
        id: 'sess-1',
        userId: AUTH_USER.id,
      });

      const res = await request(app)
        .delete('/api/sessions/sess-1')
        .set('Authorization', authHeader());

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toContain('deleted');
      expect(prisma.session.findFirst).toHaveBeenCalledWith({
        where: { id: 'sess-1', userId: AUTH_USER.id },
      });
      expect(prisma.session.delete).toHaveBeenCalledWith({
        where: { id: 'sess-1' },
      });
    });

    // TEST 2: Stranger attempts to delete another user's session
    it('TEST 2: returns 404 when another user attempts to delete a session', async () => {
      (prisma.session.findFirst as any).mockResolvedValueOnce(null);

      const res = await request(app)
        .delete('/api/sessions/sess-stranger')
        .set('Authorization', authHeader());

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe('Resource not found');
      expect(prisma.session.delete).not.toHaveBeenCalled();
    });

    // TEST 3: Non-existent session
    it('TEST 3: returns 404 when deleting a non-existent session', async () => {
      (prisma.session.findFirst as any).mockResolvedValueOnce(null);

      const res = await request(app)
        .delete('/api/sessions/sess-nonexistent')
        .set('Authorization', authHeader());

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(prisma.session.delete).not.toHaveBeenCalled();
    });

    // Unauthorized request
    it('rejects unauthenticated DELETE requests with HTTP 401', async () => {
      const res = await request(app).delete('/api/sessions/sess-1');

      expect(res.status).toBe(401);
      expect(prisma.session.delete).not.toHaveBeenCalled();
    });
  });

  describe('PATCH /api/sessions/:id/keep (VM-7)', () => {
    it('updates keep status for the authenticated session owner', async () => {
      (prisma.session.findFirst as any).mockResolvedValueOnce({
        id: 'sess-1',
        userId: AUTH_USER.id,
      });

      (prisma.session.update as any).mockResolvedValueOnce({
        id: 'sess-1',
        userId: AUTH_USER.id,
        keep: true,
      });

      const res = await request(app)
        .patch('/api/sessions/sess-1/keep')
        .set('Authorization', authHeader())
        .send({ keep: true });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.keep).toBe(true);
      expect(prisma.session.update).toHaveBeenCalledWith({
        where: { id: 'sess-1' },
        data: { keep: true },
      });
    });

    it('returns 400 when keep is not a boolean', async () => {
      const res = await request(app)
        .patch('/api/sessions/sess-1/keep')
        .set('Authorization', authHeader())
        .send({ keep: 'true' });

      expect(res.status).toBe(400);
      expect(prisma.session.update).not.toHaveBeenCalled();
    });

    it('returns 404 when another user attempts to update keep status', async () => {
      (prisma.session.findFirst as any).mockResolvedValueOnce(null);

      const res = await request(app)
        .patch('/api/sessions/sess-1/keep')
        .set('Authorization', authHeader())
        .send({ keep: true });

      expect(res.status).toBe(404);
      expect(prisma.session.update).not.toHaveBeenCalled();
    });

    it('requires authentication', async () => {
      const res = await request(app)
        .patch('/api/sessions/sess-1/keep')
        .send({ keep: true });

      expect(res.status).toBe(401);
      expect(prisma.session.update).not.toHaveBeenCalled();
    });
  });
});
