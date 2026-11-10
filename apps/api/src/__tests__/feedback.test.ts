import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../server';
import prisma from '../db';
import { handleSessionEnded } from '../services/feedback.service';
import { evaluateTranscript } from '../services/evaluator.service';
import { isTransientError, processNextJob } from '../services/job-queue.service';

vi.mock('@supabase/supabase-js', () => {
  const getUserMock = vi.fn();
  return {
    createClient: vi.fn(() => ({ auth: { getUser: getUserMock } })),
    __getUserMock: getUserMock,
  };
});

vi.mock('../db', () => ({
  default: {
    user: { findUnique: vi.fn() },
    session: { findFirst: vi.fn(), findUniqueOrThrow: vi.fn() },
    turn: { update: vi.fn(), updateMany: vi.fn(), delete: vi.fn(), deleteMany: vi.fn() },
    feedback: { findUnique: vi.fn(), upsert: vi.fn(), updateMany: vi.fn() },
    job: { create: vi.fn(), update: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock('../services/evaluator.service', () => ({ evaluateTranscript: vi.fn() }));

import * as supabase from '@supabase/supabase-js';
const { __getUserMock } = supabase as any;

const USER = { id: 'user-1', supabaseUserId: 'supabase-user-1', email: 'shaurya@example.com', name: 'Shaurya' };
const SESSION = {
  id: 'sess-1',
  userId: USER.id,
  role: 'backend-developer',
  status: 'ENDED',
  startedAt: new Date(),
  endedAt: new Date(),
  createdAt: new Date(),
};
const TURNS = [
  { id: 't1', sessionId: 'sess-1', turnIndex: 1, speaker: 'AI', text: 'Tell me about an API.', timestampSec: 1, createdAt: new Date() },
  { id: 't2', sessionId: 'sess-1', turnIndex: 2, speaker: 'CANDIDATE', text: 'I built one.', timestampSec: 5, createdAt: new Date() },
];
const JOB = {
  id: 'job-1', type: 'session.ended', sessionId: 'sess-1', payload: {}, status: 'processing',
  attempts: 1, lockedBy: 'w', lockedAt: new Date(), lastError: null, createdAt: new Date(), updatedAt: new Date(),
};
const SCORES = [
  {
    category: 'Communication',
    score: 4,
    comment: 'Clear.',
    strengths: ['Concise and clear explanations.'],
    improvements: ['Could elaborate on architecture choices.'],
    quote: 'I built one.',
  },
  {
    category: 'Technical depth',
    score: 3,
    comment: 'Surface level.',
    strengths: ['Basic knowledge demonstrated.'],
    improvements: ['Include specific technical trade-offs.'],
    quote: 'I built one.',
  },
  {
    category: 'Structure',
    score: 4,
    comment: 'Organised.',
    strengths: ['Well-structured approach.'],
    improvements: ['Could structure with STAR.'],
    quote: 'I built one.',
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  __getUserMock.mockResolvedValue({ data: { user: { id: USER.supabaseUserId, email: USER.email } }, error: null });
  (prisma.user.findUnique as any).mockResolvedValue({ ...USER, passwordHash: 'x' });
});

describe('FB3 — session.ended job handler', () => {
  it('given a session.ended job, then the evaluator writes ready feedback for that session', async () => {
    (prisma.session.findUniqueOrThrow as any).mockResolvedValueOnce({ ...SESSION, turns: TURNS });
    vi.mocked(evaluateTranscript).mockResolvedValueOnce({ summary: 'Solid.', scores: SCORES });

    await handleSessionEnded(JOB);

    expect(evaluateTranscript).toHaveBeenCalledWith(
      { roleId: 'backend-developer', turns: TURNS },
      {}
    );
    expect(prisma.feedback.upsert).toHaveBeenCalledWith({
      where: { sessionId: 'sess-1' },
      create: { sessionId: 'sess-1', status: 'ready', summary: 'Solid.', scores: SCORES, error: null },
      update: { status: 'ready', summary: 'Solid.', scores: SCORES, error: null },
    });
  });

  it('given a permanent evaluator failure, feedback is marked failed immediately and error rethrown (NFR-04)', async () => {
    (prisma.session.findUniqueOrThrow as any).mockResolvedValueOnce({ ...SESSION, turns: TURNS });
    vi.mocked(evaluateTranscript).mockRejectedValueOnce(new Error('GEMINI_API_KEY is not configured'));

    await expect(handleSessionEnded(JOB)).rejects.toThrow('GEMINI_API_KEY is not configured');

    expect(prisma.feedback.upsert).toHaveBeenCalledWith({
      where: { sessionId: 'sess-1' },
      create: {
        sessionId: 'sess-1',
        status: 'failed',
        summary: null,
        scores: [],
        error: 'GEMINI_API_KEY is not configured',
      },
      update: {
        status: 'failed',
        summary: null,
        scores: [],
        error: 'GEMINI_API_KEY is not configured',
      },
    });
    expect(prisma.turn.update).not.toHaveBeenCalled();
    expect(prisma.turn.updateMany).not.toHaveBeenCalled();
    expect(prisma.turn.delete).not.toHaveBeenCalled();
    expect(prisma.turn.deleteMany).not.toHaveBeenCalled();
  });

  it('given a transient error on attempt < MAX_ATTEMPTS, feedback is NOT marked failed so it remains pending for retry', async () => {
    (prisma.session.findUniqueOrThrow as any).mockResolvedValueOnce({ ...SESSION, turns: TURNS });
    vi.mocked(evaluateTranscript).mockRejectedValueOnce(new Error('Evaluation timed out after 12000 ms'));

    await expect(handleSessionEnded(JOB)).rejects.toThrow('timed out');

    // Feedback should NOT be marked failed on transient retry
    expect(prisma.feedback.upsert).not.toHaveBeenCalled();
  });

  it('given a transient error on attempt >= MAX_ATTEMPTS, feedback is marked failed on the final attempt', async () => {
    const finalJob = { ...JOB, attempts: 3 };
    (prisma.session.findUniqueOrThrow as any).mockResolvedValueOnce({ ...SESSION, turns: TURNS });
    vi.mocked(evaluateTranscript).mockRejectedValueOnce(new Error('Evaluation timed out after 12000 ms'));

    await expect(handleSessionEnded(finalJob)).rejects.toThrow('timed out');

    expect(prisma.feedback.upsert).toHaveBeenCalledWith({
      where: { sessionId: 'sess-1' },
      create: {
        sessionId: 'sess-1',
        status: 'failed',
        summary: null,
        scores: [],
        error: 'Evaluation timed out after 12000 ms',
      },
      update: {
        status: 'failed',
        summary: null,
        scores: [],
        error: 'Evaluation timed out after 12000 ms',
      },
    });
  });

  it('given a retried job that previously failed transiently, subsequent success writes ready feedback', async () => {
    const retriedJob = { ...JOB, attempts: 2 };
    (prisma.session.findUniqueOrThrow as any).mockResolvedValueOnce({ ...SESSION, turns: TURNS });
    vi.mocked(evaluateTranscript).mockResolvedValueOnce({ summary: 'Solid.', scores: SCORES });

    await handleSessionEnded(retriedJob);

    expect(prisma.feedback.upsert).toHaveBeenCalledWith({
      where: { sessionId: 'sess-1' },
      create: { sessionId: 'sess-1', status: 'ready', summary: 'Solid.', scores: SCORES, error: null },
      update: { status: 'ready', summary: 'Solid.', scores: SCORES, error: null },
    });
  });
});

describe('isTransientError classification (Issue #162)', () => {
  it('identifies HTTP 429 as transient', () => {
    expect(isTransientError({ status: 429, message: 'Too Many Requests' })).toBe(true);
    expect(isTransientError({ statusCode: 429 })).toBe(true);
    expect(isTransientError(new Error('429 Resource Exhausted'))).toBe(true);
  });

  it('identifies HTTP 5xx (500–599) as transient, but not arbitrary codes > 599', () => {
    expect(isTransientError({ status: 500 })).toBe(true);
    expect(isTransientError({ status: 501 })).toBe(true);
    expect(isTransientError({ status: 502 })).toBe(true);
    expect(isTransientError({ status: 503 })).toBe(true);
    expect(isTransientError({ status: 504 })).toBe(true);
    expect(isTransientError({ status: 599 })).toBe(true);
    expect(isTransientError({ status: 600 })).toBe(false);
    expect(isTransientError({ status: 999 })).toBe(false);
    expect(isTransientError(new Error('501 Not Implemented'))).toBe(true);
    expect(isTransientError(new Error('503 Service Unavailable'))).toBe(true);
    expect(isTransientError(new Error('504 Gateway Timeout'))).toBe(true);
    expect(isTransientError(new Error('599 Network Connect Timeout'))).toBe(true);
    expect(isTransientError(new Error('600 Unknown Error'))).toBe(false);
    expect(isTransientError(new Error('999 Custom Error'))).toBe(false);
    expect(isTransientError(new Error('Service is UNAVAILABLE'))).toBe(true);
  });

  it('identifies timeout and abort errors as transient', () => {
    expect(isTransientError(new Error('Evaluation timed out after 12000 ms'))).toBe(true);
    expect(isTransientError(new Error('The operation was aborted'))).toBe(true);
    expect(isTransientError(new Error('API request timeout'))).toBe(true);
  });

  it('identifies permanent client and auth errors as NOT transient', () => {
    expect(isTransientError({ status: 400 })).toBe(false);
    expect(isTransientError({ status: 401 })).toBe(false);
    expect(isTransientError({ status: 402, message: 'Your prepayment credits are depleted' })).toBe(false);
    expect(isTransientError({ status: 403 })).toBe(false);
    expect(isTransientError({ status: 404 })).toBe(false);
    expect(isTransientError({ status: 422 })).toBe(false);
    expect(isTransientError(new Error('GEMINI_API_KEY is not configured'))).toBe(false);
    expect(isTransientError(new Error('The transcript has no candidate answers to evaluate'))).toBe(false);
    expect(isTransientError(new Error('The evaluator did not return valid JSON'))).toBe(false);
  });
});

describe('processNextJob unit tests with mocked Prisma (Issue #162)', () => {
  it('requeues job to pending and returns null when handler throws transient error and attempts < MAX_ATTEMPTS', async () => {
    (prisma.$transaction as any).mockImplementationOnce(async (callback: any) => {
      return callback({
        $executeRaw: vi.fn(),
        $queryRaw: vi.fn().mockResolvedValueOnce([{ ...JOB, attempts: 1 }]),
      });
    });
    (prisma.job.update as any).mockResolvedValueOnce({ ...JOB, status: 'pending' });

    const result = await processNextJob('worker-test', async () => {
      throw new Error('Evaluation timed out after 12000 ms');
    });

    expect(result).toBeNull();
    expect(prisma.job.update).toHaveBeenCalledWith({
      where: { id: JOB.id },
      data: {
        status: 'pending',
        lastError: 'Evaluation timed out after 12000 ms',
        lockedBy: null,
        lockedAt: null,
      },
    });
  });

  it('marks job failed and rethrows when handler throws permanent error on attempt 1', async () => {
    (prisma.$transaction as any).mockImplementationOnce(async (callback: any) => {
      return callback({
        $executeRaw: vi.fn(),
        $queryRaw: vi.fn().mockResolvedValueOnce([{ ...JOB, attempts: 1 }]),
      });
    });
    (prisma.job.update as any).mockResolvedValueOnce({ ...JOB, status: 'failed' });

    await expect(
      processNextJob('worker-test', async () => {
        throw new Error('GEMINI_API_KEY is not configured');
      })
    ).rejects.toThrow('GEMINI_API_KEY is not configured');

    expect(prisma.job.update).toHaveBeenCalledWith({
      where: { id: JOB.id },
      data: {
        status: 'failed',
        lastError: 'GEMINI_API_KEY is not configured',
        lockedBy: null,
        lockedAt: null,
      },
    });
  });

  it('marks job failed and rethrows on transient error when attempts >= MAX_ATTEMPTS', async () => {
    (prisma.$transaction as any).mockImplementationOnce(async (callback: any) => {
      return callback({
        $executeRaw: vi.fn(),
        $queryRaw: vi.fn().mockResolvedValueOnce([{ ...JOB, attempts: 3 }]),
      });
    });
    (prisma.job.update as any).mockResolvedValueOnce({ ...JOB, status: 'failed' });

    await expect(
      processNextJob('worker-test', async () => {
        throw new Error('Evaluation timed out after 12000 ms');
      })
    ).rejects.toThrow('Evaluation timed out after 12000 ms');

    expect(prisma.job.update).toHaveBeenCalledWith({
      where: { id: JOB.id },
      data: {
        status: 'failed',
        lastError: 'Evaluation timed out after 12000 ms',
        lockedBy: null,
        lockedAt: null,
      },
    });
  });
});

describe('FB3 — GET /api/sessions/:id/feedback', () => {
  const get = (id: string) =>
    request(app).get(`/api/sessions/${id}/feedback`).set('Authorization', 'Bearer valid-supabase-token');

  it("given the candidate's own session and no feedback yet, then it is pending", async () => {
    (prisma.session.findFirst as any).mockResolvedValueOnce(SESSION);
    (prisma.feedback.findUnique as any).mockResolvedValueOnce(null);

    const res = await get('sess-1');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ sessionId: 'sess-1', status: 'pending' });
  });

  it('given feedback has been written, then it is returned', async () => {
    (prisma.session.findFirst as any).mockResolvedValueOnce(SESSION);
    (prisma.feedback.findUnique as any).mockResolvedValueOnce({
      id: 'f1', sessionId: 'sess-1', status: 'ready', summary: 'Solid.', scores: SCORES,
      createdAt: new Date(), updatedAt: new Date(),
    });

    const res = await get('sess-1');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ sessionId: 'sess-1', status: 'ready', summary: 'Solid.', scores: SCORES });
  });

  it("given another candidate's session, then 404 (FR-27)", async () => {
    (prisma.session.findFirst as any).mockResolvedValueOnce(null);

    const res = await get('someone-elses');

    expect(res.status).toBe(404);
    expect(prisma.feedback.findUnique).not.toHaveBeenCalled();
  });

  // Test 4: Deleted session feedback
  it('TEST 4: given a deleted session, then retrieving feedback returns 404', async () => {
    // Once session is deleted, getOwnedSession returns null/NotFoundError
    (prisma.session.findFirst as any).mockResolvedValueOnce(null);

    const res = await get('deleted-sess-1');

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe('Resource not found');
    expect(prisma.feedback.findUnique).not.toHaveBeenCalled();
  });

  it('given no token, then 401', async () => {
    const res = await request(app).get('/api/sessions/sess-1/feedback');
    expect(res.status).toBe(401);
  });
});

describe('Retry Feedback Evaluation (Issue #92)', () => {
  const retry = (id: string, token: string = 'Bearer valid-supabase-token') =>
    request(app).post(`/api/sessions/${id}/feedback/retry`).set('Authorization', token);

  it('TEST 1: owner can retry failed feedback, changing status to pending and enqueueing a session.ended job in one transaction', async () => {
    (prisma.session.findFirst as any).mockResolvedValueOnce({ ...SESSION, status: 'ENDED' });

    (prisma.$transaction as any).mockImplementationOnce(async (callback: any) => {
      const tx = {
        feedback: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        job: {
          create: vi.fn().mockResolvedValue({ id: 'job-retry-1', type: 'session.ended', sessionId: 'sess-1', status: 'pending' }),
        },
      };
      return callback(tx);
    });

    const res = await retry('sess-1');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ sessionId: 'sess-1', status: 'pending' });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it("TEST 2: another user's session cannot be retried, returning 404 (FR-27) without creating a job", async () => {
    (prisma.session.findFirst as any).mockResolvedValueOnce(null);

    const res = await retry('someone-elses');

    expect(res.status).toBe(404);
    expect(res.body.message).toBe('Resource not found');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('TEST 3: cannot retry ready feedback, returning 409 Conflict without creating a job', async () => {
    (prisma.session.findFirst as any).mockResolvedValueOnce({ ...SESSION, status: 'ENDED' });

    (prisma.$transaction as any).mockImplementationOnce(async (callback: any) => {
      const tx = {
        feedback: {
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        },
        job: {
          create: vi.fn(),
        },
      };
      return callback(tx);
    });

    const res = await retry('sess-1');

    expect(res.status).toBe(409);
    expect(res.body.message).toBe('Only failed feedback evaluations can be retried');
  });

  it('TEST 4: cannot retry pending feedback, returning 409 Conflict without creating duplicate jobs', async () => {
    (prisma.session.findFirst as any).mockResolvedValueOnce({ ...SESSION, status: 'ENDED' });

    (prisma.$transaction as any).mockImplementationOnce(async (callback: any) => {
      const tx = {
        feedback: {
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        },
        job: {
          create: vi.fn(),
        },
      };
      return callback(tx);
    });

    const res = await retry('sess-1');

    expect(res.status).toBe(409);
    expect(res.body.message).toBe('Only failed feedback evaluations can be retried');
  });

  it('TEST 5: concurrent retry requests: atomic updateMany allows exactly one retry to succeed while other receives 409', async () => {
    (prisma.session.findFirst as any).mockResolvedValue({ ...SESSION, status: 'ENDED' });

    let callCount = 0;
    (prisma.$transaction as any).mockImplementation(async (callback: any) => {
      callCount++;
      const count = callCount === 1 ? 1 : 0;
      const tx = {
        feedback: {
          updateMany: vi.fn().mockResolvedValue({ count }),
        },
        job: {
          create: vi.fn().mockResolvedValue({ id: 'job-1', type: 'session.ended', sessionId: 'sess-1', status: 'pending' }),
        },
      };
      return callback(tx);
    });

    const [res1, res2] = await Promise.all([retry('sess-1'), retry('sess-1')]);

    const statuses = [res1.status, res2.status].sort();
    expect(statuses).toEqual([200, 409]);
  });

  it('TEST 6: interview transcript remains unchanged: turns and candidate answers are read-only (NFR-04)', async () => {
    const originalTurns = structuredClone(TURNS);

    (prisma.session.findFirst as any).mockResolvedValueOnce({ ...SESSION, status: 'ENDED' });

    (prisma.$transaction as any).mockImplementationOnce(async (callback: any) => {
      const tx = {
        feedback: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        job: {
          create: vi.fn().mockResolvedValue({ id: 'job-retry-1', type: 'session.ended', sessionId: 'sess-1', status: 'pending' }),
        },
      };
      return callback(tx);
    });

    const res = await retry('sess-1');
    expect(res.status).toBe(200);

    expect(TURNS).toEqual(originalTurns);
    expect(prisma.turn.update).not.toHaveBeenCalled();
    expect(prisma.turn.updateMany).not.toHaveBeenCalled();
    expect(prisma.turn.delete).not.toHaveBeenCalled();
    expect(prisma.turn.deleteMany).not.toHaveBeenCalled();
  });
});
