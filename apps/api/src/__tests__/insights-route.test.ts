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
    improvementPlan: { findUnique: vi.fn(), upsert: vi.fn(), update: vi.fn() },
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

describe('V-6 · PATCH /api/insights/progress (Track progress on the roadmap)', () => {
  const patchProgress = (body: any, token: string = 'Bearer valid-token') =>
    request(app).patch('/api/insights/progress').set('Authorization', token).send(body);

  it('rejects unauthenticated requests without a token with 401', async () => {
    const res = await request(app).patch('/api/insights/progress').send({ actionId: 'act-1', completed: true });
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it("returns 404 when attempting to update another candidate's progress via ?userId (FR-27)", async () => {
    const res = await request(app)
      .patch('/api/insights/progress?userId=another-user-999')
      .set('Authorization', 'Bearer valid-token')
      .send({ actionId: 'act-1', completed: true });

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe('Improvement plan not found');
    expect(prisma.improvementPlan.findUnique).not.toHaveBeenCalled();
  });

  it('returns 400 when request body lacks an action identifier', async () => {
    const res = await patchProgress({});

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('returns 404 when candidate has no improvement plan yet', async () => {
    (prisma.improvementPlan.findUnique as any).mockResolvedValueOnce(null);

    const res = await patchProgress({ actionId: 'act-1', completed: true });

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe('Improvement plan not found');
  });

  it('returns 404 when the action is not found in the plan', async () => {
    (prisma.improvementPlan.findUnique as any).mockResolvedValueOnce(MOCK_PLAN);

    const res = await patchProgress({ actionId: 'missing-action-id', completed: true });

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain('not found');
  });

  it('marks a roadmap action as completed (200) and returns the updated plan', async () => {
    (prisma.improvementPlan.findUnique as any).mockResolvedValueOnce(MOCK_PLAN);
    (prisma.improvementPlan.update as any).mockImplementationOnce(async ({ data }: any) => ({
      ...MOCK_PLAN,
      plan: data.plan,
    }));

    const res = await patchProgress({ actionId: 'act-1', completed: true });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.plan[0].actions[0].id).toBe('act-1');
    expect(res.body.data.plan[0].actions[0].completed).toBe(true);
    expect(prisma.improvementPlan.update).toHaveBeenCalledWith({
      where: { userId: USER.id },
      data: {
        plan: expect.any(Array),
      },
    });
  });

  it('defaults completed to true when omitted in the request', async () => {
    (prisma.improvementPlan.findUnique as any).mockResolvedValueOnce(MOCK_PLAN);
    (prisma.improvementPlan.update as any).mockImplementationOnce(async ({ data }: any) => ({
      ...MOCK_PLAN,
      plan: data.plan,
    }));

    const res = await patchProgress({ actionId: 'act-1' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.plan[0].actions[0].completed).toBe(true);
  });

  it('unmarks a roadmap action when completed is false', async () => {
    const completedPlan = {
      ...MOCK_PLAN,
      plan: [
        {
          ...MOCK_PLAN.plan[0],
          actions: [{ ...MOCK_PLAN.plan[0].actions[0], completed: true }],
        },
        MOCK_PLAN.plan[1],
      ],
    };
    (prisma.improvementPlan.findUnique as any).mockResolvedValueOnce(completedPlan);
    (prisma.improvementPlan.update as any).mockImplementationOnce(async ({ data }: any) => ({
      ...completedPlan,
      plan: data.plan,
    }));

    const res = await patchProgress({ actionId: 'act-1', completed: false });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.plan[0].actions[0].completed).toBe(false);
  });

  it('supports PATCH /api/insights/progress/:actionId with parameter in URL', async () => {
    (prisma.improvementPlan.findUnique as any).mockResolvedValueOnce(MOCK_PLAN);
    (prisma.improvementPlan.update as any).mockImplementationOnce(async ({ data }: any) => ({
      ...MOCK_PLAN,
      plan: data.plan,
    }));

    const res = await request(app)
      .patch('/api/insights/progress/act-1')
      .set('Authorization', 'Bearer valid-token')
      .send({ completed: true });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.plan[0].actions[0].completed).toBe(true);
  });
});
