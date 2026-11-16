import 'dotenv/config';

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'crypto';

const { getUserMock } = vi.hoisted(() => ({
  getUserMock: vi.fn(),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    auth: {
      getUser: getUserMock,
    },
  })),
}));

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DATABASE_URL)(
  'GET /api/me/export - PostgreSQL data isolation',
  () => {
    let prisma: typeof import('../db').default;
    let app: typeof import('../server').default;

    const runId = randomUUID().slice(0, 8);
    const userIds: string[] = [];

    let userA: { id: string; name: string; email: string };
    let userB: { id: string; name: string; email: string };

    beforeAll(async () => {
      process.env.DATABASE_URL = TEST_DATABASE_URL!;

      prisma = (await import('../db')).default;
      app = (await import('../server')).default;

      userA = await prisma.user.create({
        data: {
          supabaseUserId: `export-a-${runId}`,
          name: 'Export User A',
          email: `export-a-${runId}@example.com`,
        },
      });
      userIds.push(userA.id);

      userB = await prisma.user.create({
        data: {
          supabaseUserId: `export-b-${runId}`,
          name: 'Export User B',
          email: `export-b-${runId}@example.com`,
        },
      });
      userIds.push(userB.id);

      for (const [user, suffix] of [
        [userA, 'a'],
        [userB, 'b'],
      ] as const) {
        const resume = await prisma.resume.create({
          data: {
            userId: user.id,
            fileName: `resume-${suffix}.pdf`,
            extractedText: `Private resume ${suffix}`,
            parsedProfile: JSON.stringify({ name: user.name }),
          },
        });

        const session = await prisma.session.create({
          data: {
            userId: user.id,
            resumeId: resume.id,
            role: 'software-engineer',
            status: 'ENDED',
            endedAt: new Date(),
          },
        });

        await prisma.turn.create({
          data: {
            sessionId: session.id,
            turnIndex: 1,
            speaker: 'CANDIDATE',
            text: `Private answer ${suffix}`,
            timestampSec: 1,
          },
        });

        await prisma.feedback.create({
          data: {
            sessionId: session.id,
            status: 'ready',
            summary: `Private feedback ${suffix}`,
          },
        });

        await prisma.improvementPlan.create({
          data: {
            userId: user.id,
            topics: [`Topic ${suffix}`],
            plan: [`Plan ${suffix}`],
          },
        });
      }
    }, 15000);

    afterAll(async () => {
      if (prisma) {
        if (userIds.length > 0) {
          await prisma.user.deleteMany({
            where: { id: { in: userIds } },
          });
        }

        await prisma.$disconnect();
      }
    }, 15000);

    it('exports only the authenticated user data', async () => {
      getUserMock.mockResolvedValueOnce({
        data: {
          user: {
            id: `export-a-${runId}`,
            email: userA.email,
          },
        },
        error: null,
      });

      const response = await request(app)
        .get('/api/me/export')
        .set('Authorization', 'Bearer integration-test-token');

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toContain('application/json');
      expect(response.headers['content-disposition']).toContain(
        'attachment; filename="my-data-export.json"'
      );

      expect(response.body.profile.email).toBe(userA.email);
      expect(response.body.resumes).toHaveLength(1);
      expect(response.body.resumes[0].extractedText).toBe('Private resume a');

      expect(response.body.sessions).toHaveLength(1);
      expect(response.body.sessions[0].turns[0].text).toBe('Private answer a');
      expect(response.body.sessions[0].feedback.summary).toBe(
        'Private feedback a'
      );

      expect(response.body.improvementPlan.topics).toContain('Topic a');

      const exportedJson = JSON.stringify(response.body);

      expect(exportedJson).not.toContain(userB.email);
      expect(exportedJson).not.toContain('Export User B');
      expect(exportedJson).not.toContain('Private resume b');
      expect(exportedJson).not.toContain('Private answer b');
      expect(exportedJson).not.toContain('Private feedback b');
      expect(exportedJson).not.toContain('Topic b');
    });
  }
);
