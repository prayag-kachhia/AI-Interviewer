import 'dotenv/config';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DATABASE_URL)(
  'FR-28 — Account deletion cascade (PostgreSQL)',
  () => {
    let prisma: typeof import('../utils/db').default;
    const runId = randomUUID().slice(0, 8);

    let userId: string;
    const sessionIds: string[] = [];

    beforeAll(async () => {
      process.env.DATABASE_URL = TEST_DATABASE_URL!;

      prisma = (await import('../utils/db')).default;

      const user = await prisma.user.create({
        data: {
          name: 'Cascade Test',
          email: `cascade-${runId}@example.com`,
        },
      });

      userId = user.id;

      await prisma.resume.create({
        data: {
          userId,
          fileName: 'test-resume.pdf',
          extractedText: 'Test resume content',
          parsedProfile: '{}',
        },
      });

      for (let i = 1; i <= 2; i++) {
        const session = await prisma.session.create({
          data: {
            userId,
            role: 'software-engineer',
            status: 'ENDED',
            endedAt: new Date(),
          },
        });

        sessionIds.push(session.id);

        await prisma.turn.create({
          data: {
            sessionId: session.id,
            turnIndex: 1,
            speaker: 'CANDIDATE',
            text: `Test answer ${i}`,
            timestampSec: 1,
          },
        });

        await prisma.feedback.create({
          data: {
            sessionId: session.id,
            status: 'ready',
            summary: 'Test feedback',
          },
        });

        await prisma.job.create({
          data: {
            type: `test.fr28.${runId}.${i}`,
            sessionId: session.id,
          },
        });
      }
    });

    afterAll(async () => {
      if (prisma) {
        if (userId) {
          await prisma.user.deleteMany({
            where: { id: userId },
          });
        }

        await prisma.$disconnect();
      }
    });

    it('deletes the user and all related records through cascade', async () => {
      expect(sessionIds).toHaveLength(2);

      await prisma.user.delete({
        where: { id: userId },
      });

      expect(
        await prisma.user.findUnique({ where: { id: userId } })
      ).toBeNull();

      expect(
        await prisma.resume.count({ where: { userId } })
      ).toBe(0);

      expect(
        await prisma.session.count({ where: { userId } })
      ).toBe(0);

      expect(
        await prisma.turn.count({
          where: { sessionId: { in: sessionIds } },
        })
      ).toBe(0);

      expect(
        await prisma.feedback.count({
          where: { sessionId: { in: sessionIds } },
        })
      ).toBe(0);

      expect(
        await prisma.job.count({
          where: { sessionId: { in: sessionIds } },
        })
      ).toBe(0);
    });
  }
);
