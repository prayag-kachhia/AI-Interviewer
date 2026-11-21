import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../server';
import prisma from '../db';

vi.mock('@supabase/supabase-js', () => {
  const getUserMock = vi.fn();

  return {
    createClient: vi.fn(() => ({
      auth: {
        getUser: getUserMock,
      },
    })),
    __getUserMock: getUserMock,
  };
});

vi.mock('../db', () => ({
  default: {
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

import * as supabase from '@supabase/supabase-js';

const { __getUserMock } = supabase as any;

describe('GET /api/me/export', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects requests without authentication', async () => {
    const response = await request(app).get('/api/me/export');

    expect(response.status).toBe(401);
  });

  it('exports only the authenticated user data as a JSON attachment', async () => {
    const userA = {
      id: 'local-user-a',
      supabaseUserId: 'supabase-user-a',
      email: 'user-a@example.com',
      name: 'User A',
    };

    const userAExport = {
      id: 'local-user-a',
      name: 'User A',
      email: 'user-a@example.com',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-02T00:00:00.000Z'),
      improvementPlan: {
        topics: ['Communication'],
        plan: ['Practice regularly'],
      },
      resumes: [
        {
          id: 'resume-a',
          fileName: 'user-a-resume.pdf',
          parsedProfile: '{"name":"User A"}',
        },
      ],
      sessions: [
        {
          id: 'session-a',
          turns: [
            {
              id: 'turn-a',
              turnIndex: 1,
              speaker: 'CANDIDATE',
              text: 'User A answer',
            },
          ],
          feedback: {
            summary: 'User A feedback',
          },
        },
      ],
      resumeMatches: [
        {
          id: 'match-a',
          resumeId: 'resume-a',
          jobDescription: 'Frontend Engineer',
          score: 85,
          source: 'keywords',
          result: { categories: [] },
          createdAt: new Date('2026-01-03T00:00:00.000Z'),
        },
      ],
    };

    __getUserMock.mockResolvedValueOnce({
      data: {
        user: {
          id: 'supabase-user-a',
          email: 'user-a@example.com',
        },
      },
      error: null,
    });

    (prisma.user.findUnique as any)
      .mockResolvedValueOnce(userA)
      .mockResolvedValueOnce(userAExport);

    const response = await request(app)
      .get('/api/me/export')
      .set('Authorization', 'Bearer valid-token');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('application/json');
    expect(response.headers['content-disposition']).toContain(
      'attachment; filename="my-data-export.json"'
    );

    expect(response.body.profile.email).toBe('user-a@example.com');
    expect(response.body.resumes[0].id).toBe('resume-a');
    expect(response.body.improvementPlan.topics).toContain('Communication');
    expect(response.body.sessions[0].turns[0].text).toBe('User A answer');
    expect(response.body.sessions[0].feedback.summary).toBe('User A feedback');
    expect(response.body.resumeMatches[0].id).toBe('match-a');
    expect(response.body.resumeMatches[0].score).toBe(85);

    expect(prisma.user.findUnique).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: { id: 'local-user-a' },
      })
    );

    const exportedJson = JSON.stringify(response.body);

    expect(exportedJson).not.toContain('user-b@example.com');
    expect(exportedJson).not.toContain('local-user-b');
    expect(exportedJson).not.toContain('User B');
  });
});
