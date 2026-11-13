import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../server';
import prisma from '../db';

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
    session: { findFirst: vi.fn(), findMany: vi.fn(), findUniqueOrThrow: vi.fn() },
    improvementPlan: { findUnique: vi.fn(), upsert: vi.fn() },
    $transaction: vi.fn(),
  },
}));

import * as supabase from '@supabase/supabase-js';
const { __getUserMock } = supabase as any;

const USER = {
  id: 'user-ved-1',
  supabaseUserId: 'supabase-user-ved-1',
  email: 'ved@example.com',
  name: 'Ved Patel',
};

const MOCK_PLAN = {
  id: 'plan-uuid-1',
  userId: USER.id,
  topics: [
    { topic: 'DBMS', score: 2, summary: 'Struggled with transaction isolation levels and ACID properties.' },
    { topic: 'OS', score: 3, summary: 'Basic understanding of processes and threads, but weak on paging.' },
    { topic: 'DSA', score: 4, summary: 'Solid grasp of tree traversals and algorithmic complexity.' },
  ],
  plan: [
    {
      id: 'plan-dbms',
      topic: 'DBMS',
      score: 2,
      summary: 'Struggled with transaction isolation levels and ACID properties.',
      action: 'Study ACID properties in DBMS',
      resourceId: 'dbms-acid-transactions',
      actions: [
        {
          id: 'act-1',
          action: 'Study GeeksforGeeks: ACID Properties in DBMS',
          resourceId: 'dbms-acid-transactions',
          completed: false,
        },
      ],
    },
    {
      id: 'plan-os',
      topic: 'OS',
      score: 3,
      summary: 'Basic understanding of processes and threads, but weak on paging.',
      action: 'Study Virtual Memory and Paging in OS',
      resourceId: 'os-memory-paging',
      actions: [
        {
          id: 'act-2',
          action: 'Study GeeksforGeeks: Virtual Memory & Paging',
          resourceId: 'os-memory-paging',
          completed: false,
        },
      ],
    },
  ],
  createdAt: new Date('2026-11-13T10:00:00.000Z'),
  updatedAt: new Date('2026-11-13T10:00:00.000Z'),
};

beforeEach(() => {
  vi.clearAllMocks();
  __getUserMock.mockResolvedValue({
    data: { user: { id: USER.supabaseUserId, email: USER.email } },
    error: null,
  });
  (prisma.user.findUnique as any).mockResolvedValue({ ...USER, passwordHash: 'hash' });
});

describe('V-5 · GET /api/insights (Improvement Guide endpoint)', () => {
  const getInsights = (token: string = 'Bearer valid-token') =>
    request(app).get('/api/insights').set('Authorization', token);

  it('rejects unauthenticated requests without a token with 401', async () => {
    const res = await request(app).get('/api/insights');
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('given authenticated candidate with an existing improvement plan, returns 200 and the plan', async () => {
    (prisma.improvementPlan.findUnique as any).mockResolvedValueOnce(MOCK_PLAN);

    const res = await getInsights();

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.userId).toBe(USER.id);
    expect(res.body.data.topics).toHaveLength(3);
    expect(res.body.data.plan).toHaveLength(2);
    expect(res.body.data.plan[0].actions[0]).toHaveProperty('resource');
    expect(res.body.data.plan[0].actions[0].resource.id).toBe('dbms-acid-transactions');
    expect(res.body.data.resources.length).toBeGreaterThan(0);
  });

  it('given candidate has no improvement plan yet, returns 404', async () => {
    (prisma.improvementPlan.findUnique as any).mockResolvedValueOnce(null);

    const res = await getInsights();

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe('Improvement plan not found');
  });

  it("given query for another user's plan via ?userId, returns 404 (FR-27)", async () => {
    const res = await request(app)
      .get('/api/insights?userId=other-user-999')
      .set('Authorization', 'Bearer valid-token');

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe('Improvement plan not found');
    expect(prisma.improvementPlan.findUnique).not.toHaveBeenCalled();
  });

  it("given candidate requests their own plan via /:userId, returns 200", async () => {
    (prisma.improvementPlan.findUnique as any).mockResolvedValueOnce(MOCK_PLAN);

    const res = await request(app)
      .get(`/api/insights/${USER.id}`)
      .set('Authorization', 'Bearer valid-token');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.userId).toBe(USER.id);
  });

  it("given candidate requests another candidate's plan via /:userId, returns 404 (FR-27)", async () => {
    const res = await request(app)
      .get('/api/insights/someone-else-id')
      .set('Authorization', 'Bearer valid-token');

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe('Improvement plan not found');
    expect(prisma.improvementPlan.findUnique).not.toHaveBeenCalled();
  });
});
