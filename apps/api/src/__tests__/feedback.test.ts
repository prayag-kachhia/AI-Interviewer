import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../server';
import prisma from '../utils/db';
import { endSession, runFeedbackEvaluation } from '../services/session.service';
import { evaluateTranscript } from '../services/evaluator.service';

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
    session: { findFirst: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn() },
    turn: { create: vi.fn(), findMany: vi.fn(), count: vi.fn(), update: vi.fn(), updateMany: vi.fn(), delete: vi.fn(), deleteMany: vi.fn() },
    feedback: { findUnique: vi.fn(), upsert: vi.fn(), update: vi.fn() },
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
  status: 'LIVE',
  startedAt: new Date(Date.now() - 60_000),
  endedAt: null,
  createdAt: new Date(),
};
const TURNS = [
  { id: 't1', sessionId: 'sess-1', turnIndex: 1, speaker: 'AI' as const, text: 'Tell me about database indexing.', timestampSec: 1, createdAt: new Date() },
  { id: 't2', sessionId: 'sess-1', turnIndex: 2, speaker: 'CANDIDATE' as const, text: 'B-trees allow logarithmic search time and optimize range queries.', timestampSec: 10, createdAt: new Date() },
  { id: 't3', sessionId: 'sess-1', turnIndex: 3, speaker: 'AI' as const, text: 'What are the trade-offs of having too many indexes?', timestampSec: 25, createdAt: new Date() },
  { id: 't4', sessionId: 'sess-1', turnIndex: 4, speaker: 'CANDIDATE' as const, text: 'They add write overhead on INSERT/UPDATE/DELETE and consume disk space.', timestampSec: 40, createdAt: new Date() },
];
const SCORES = [
  { category: 'Communication', score: 5, comment: 'Clear and concise explanations.' },
  { category: 'Technical depth', score: 4, comment: 'Good understanding of B-trees and write amplification.' },
  { category: 'Structure', score: 4, comment: 'Structured answers addressing trade-offs directly.' },
];

beforeEach(() => {
  vi.clearAllMocks();
  __getUserMock.mockResolvedValue({ data: { user: { id: USER.supabaseUserId, email: USER.email } }, error: null });
  (prisma.user.findUnique as any).mockResolvedValue({ ...USER, passwordHash: 'x' });
});

describe('Direct Feedback Evaluation on Session End (Issue #79)', () => {
  // Test 1 — Successful evaluation
  it('Test 1 — Successful evaluation: ends session, sets pending, triggers direct evaluation, and persists ready feedback with scores', async () => {
    (prisma.session.findFirst as any).mockResolvedValueOnce(SESSION);
    (prisma.session.update as any).mockReturnValue('session-update-op');
    (prisma.feedback.upsert as any).mockReturnValue('feedback-upsert-pending-op');
    (prisma.$transaction as any).mockResolvedValueOnce([
      { ...SESSION, status: 'ENDED', endedAt: new Date() },
      { id: 'fb-1', sessionId: 'sess-1', status: 'pending' },
    ]);

    (prisma.session.findUniqueOrThrow as any).mockResolvedValueOnce({
      ...SESSION,
      status: 'ENDED',
      turns: TURNS,
    });
    vi.mocked(evaluateTranscript).mockResolvedValueOnce({ summary: 'Strong performance on backend concepts.', scores: SCORES });

    // End session
    const endedSession = await endSession('sess-1', USER.id);

    // Verify session became ENDED
    expect(endedSession.status).toBe('ENDED');

    // Verify atomic transaction marked session ENDED and upserted pending Feedback
    expect(prisma.$transaction).toHaveBeenCalledWith([
      'session-update-op',
      'feedback-upsert-pending-op',
    ]);
    expect(prisma.feedback.upsert).toHaveBeenCalledWith({
      where: { sessionId: 'sess-1' },
      create: { sessionId: 'sess-1', status: 'pending' },
      update: { status: 'pending' },
    });

    // Allow the un-awaited evaluation promise to resolve
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Verify evaluation was invoked with correct role label and turns
    expect(evaluateTranscript).toHaveBeenCalledWith(
      { roleLabel: 'Backend Developer', turns: TURNS },
      undefined
    );

    // Verify feedback was updated to ready with summary and scores
    expect(prisma.feedback.upsert).toHaveBeenCalledWith({
      where: { sessionId: 'sess-1' },
      create: {
        sessionId: 'sess-1',
        status: 'ready',
        summary: 'Strong performance on backend concepts.',
        scores: SCORES,
        error: null,
      },
      update: {
        status: 'ready',
        summary: 'Strong performance on backend concepts.',
        scores: SCORES,
        error: null,
      },
    });
  });

  // Test 2 — Failed evaluation
  it('Test 2 — Failed evaluation: records failed status and stores error in Feedback.error, returning failed state to endpoint', async () => {
    (prisma.session.findUniqueOrThrow as any).mockResolvedValueOnce({
      ...SESSION,
      status: 'ENDED',
      turns: TURNS,
    });
    vi.mocked(evaluateTranscript).mockRejectedValueOnce(new Error('Evaluation timed out after 12000 ms'));

    await runFeedbackEvaluation('sess-1', 'backend-developer');

    // Verify feedback row was updated with status 'failed' and error message stored
    expect(prisma.feedback.upsert).toHaveBeenCalledWith({
      where: { sessionId: 'sess-1' },
      create: {
        sessionId: 'sess-1',
        status: 'failed',
        error: 'Evaluation timed out after 12000 ms',
      },
      update: {
        status: 'failed',
        error: 'Evaluation timed out after 12000 ms',
      },
    });

    // Verify frontend-facing GET endpoint returns the failed state with error message
    (prisma.session.findFirst as any).mockResolvedValueOnce({ ...SESSION, status: 'ENDED' });
    (prisma.feedback.findUnique as any).mockResolvedValueOnce({
      id: 'fb-1',
      sessionId: 'sess-1',
      status: 'failed',
      summary: null,
      scores: null,
      error: 'Evaluation timed out after 12000 ms',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await request(app)
      .get('/api/sessions/sess-1/feedback')
      .set('Authorization', 'Bearer valid-supabase-token');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual({
      sessionId: 'sess-1',
      status: 'failed',
      error: 'Evaluation timed out after 12000 ms',
    });
  });

  // Test 3 — Interview answers must never be modified
  it('Test 3 — Interview answers must never be modified: evaluation only modifies Feedback and never modifies turns (NFR-04)', async () => {
    const originalTurns = structuredClone(TURNS);

    (prisma.session.findUniqueOrThrow as any).mockResolvedValueOnce({
      ...SESSION,
      status: 'ENDED',
      turns: TURNS,
    });
    vi.mocked(evaluateTranscript).mockResolvedValueOnce({ summary: 'Good job.', scores: SCORES });

    await runFeedbackEvaluation('sess-1', 'backend-developer');

    // Verify turns data in memory was not mutated
    expect(TURNS).toEqual(originalTurns);

    // Verify no turn mutation database queries were executed
    expect(prisma.turn.update).not.toHaveBeenCalled();
    expect(prisma.turn.updateMany).not.toHaveBeenCalled();
    expect(prisma.turn.delete).not.toHaveBeenCalled();
    expect(prisma.turn.deleteMany).not.toHaveBeenCalled();
    expect(prisma.turn.create).not.toHaveBeenCalled();

    // Only feedback row was modified
    expect(prisma.feedback.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.feedback.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { sessionId: 'sess-1' },
        create: expect.objectContaining({ status: 'ready' }),
      })
    );
  });

  it('does not start evaluation if the database transaction fails', async () => {
    (prisma.session.findFirst as any).mockResolvedValueOnce(SESSION);
    (prisma.session.update as any).mockReturnValue('session-update-op');
    (prisma.feedback.upsert as any).mockReturnValue('feedback-upsert-op');
    (prisma.$transaction as any).mockRejectedValueOnce(new Error('Transaction deadlock'));

    await expect(endSession('sess-1', USER.id)).rejects.toThrow('Transaction deadlock');

    expect(evaluateTranscript).not.toHaveBeenCalled();
  });

  it('handles duplicate endSession calls idempotently without starting evaluation again', async () => {
    (prisma.session.findFirst as any).mockResolvedValueOnce({
      ...SESSION,
      status: 'ENDED',
      endedAt: new Date(),
    });

    const result = await endSession('sess-1', USER.id);

    expect(result.status).toBe('ENDED');
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(evaluateTranscript).not.toHaveBeenCalled();
  });
});

describe('FB3 — GET /api/sessions/:id/feedback', () => {
  const get = (id: string) =>
    request(app).get(`/api/sessions/${id}/feedback`).set('Authorization', 'Bearer valid-supabase-token');

  it("given the candidate's own session and no feedback yet, then it is pending", async () => {
    (prisma.session.findFirst as any).mockResolvedValueOnce({ ...SESSION, status: 'ENDED' });
    (prisma.feedback.findUnique as any).mockResolvedValueOnce(null);

    const res = await get('sess-1');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ sessionId: 'sess-1', status: 'pending' });
  });

  it('given feedback has been written, then ready state with summary and scores is returned', async () => {
    (prisma.session.findFirst as any).mockResolvedValueOnce({ ...SESSION, status: 'ENDED' });
    (prisma.feedback.findUnique as any).mockResolvedValueOnce({
      id: 'f1',
      sessionId: 'sess-1',
      status: 'ready',
      summary: 'Solid.',
      scores: SCORES,
      error: null,
      createdAt: new Date(),
      updatedAt: new Date(),
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

  it('given no token, then 401', async () => {
    const res = await request(app).get('/api/sessions/sess-1/feedback');
    expect(res.status).toBe(401);
  });
});
