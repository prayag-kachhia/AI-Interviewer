import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../server';
import prisma from '../utils/db';
import { handleSessionEnded } from '../services/feedback.service';
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
    session: { findFirst: vi.fn(), findUniqueOrThrow: vi.fn() },
    turn: { update: vi.fn(), updateMany: vi.fn(), delete: vi.fn(), deleteMany: vi.fn() },
    feedback: { findUnique: vi.fn(), upsert: vi.fn() },
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
  { category: 'Communication', score: 4, comment: 'Clear.' },
  { category: 'Technical depth', score: 3, comment: 'Surface level.' },
  { category: 'Structure', score: 4, comment: 'Organised.' },
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
      { roleLabel: 'Backend Developer', turns: TURNS },
      {}
    );
    expect(prisma.feedback.upsert).toHaveBeenCalledWith({
      where: { sessionId: 'sess-1' },
      create: { sessionId: 'sess-1', status: 'ready', summary: 'Solid.', scores: SCORES },
      update: { status: 'ready', summary: 'Solid.', scores: SCORES },
    });
  });

  it('given the evaluator fails, then feedback is marked failed, the job fails, and the transcript is untouched (NFR-04)', async () => {
    (prisma.session.findUniqueOrThrow as any).mockResolvedValueOnce({ ...SESSION, turns: TURNS });
    vi.mocked(evaluateTranscript).mockRejectedValueOnce(new Error('Evaluation timed out after 12000 ms'));

    await expect(handleSessionEnded(JOB)).rejects.toThrow('timed out');

    expect(prisma.feedback.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: expect.objectContaining({ status: 'failed' }) })
    );
    expect(prisma.turn.update).not.toHaveBeenCalled();
    expect(prisma.turn.updateMany).not.toHaveBeenCalled();
    expect(prisma.turn.delete).not.toHaveBeenCalled();
    expect(prisma.turn.deleteMany).not.toHaveBeenCalled();
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

  it('given no token, then 401', async () => {
    const res = await request(app).get('/api/sessions/sess-1/feedback');
    expect(res.status).toBe(401);
  });
});
