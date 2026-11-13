
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DATABASE_URL)(
  'VM-6 — retention purge (needs TEST_DATABASE_URL)',
  () => {
    let prisma: typeof import('../db').default;
    let purgeExpiredSessions: typeof import('../services/retention.service').purgeExpiredSessions;

    const runId = randomUUID().slice(0, 8);
    let userId: string;
    let oldSessionId: string;
    let recentSessionId: string;
    let keptSessionId: string;
    let purgeNow: Date;

    beforeAll(async () => {
      process.env.DATABASE_URL = TEST_DATABASE_URL;

      prisma = (await import('../db')).default;
      ({ purgeExpiredSessions } = await import('../services/retention.service'));

      const user = await prisma.user.create({
        data: {
          name: 'Retention Test',
          email: `retention-${runId}@example.com`,
        },
      });

      userId = user.id;

      purgeNow = new Date();
      const oldDate = new Date(purgeNow.getTime() - 31 * 24 * 60 * 60 * 1000);
      const recentDate = new Date(purgeNow.getTime() - 10 * 24 * 60 * 60 * 1000);

      const oldSession = await prisma.session.create({
        data: {
          userId,
          role: 'software-engineer',
          status: 'ENDED',
          endedAt: oldDate,
          turns: {
            create: {
              turnIndex: 1,
              speaker: 'CANDIDATE',
              text: 'Old interview',
              timestampSec: 10,
            },
          },
          feedback: {
            create: { status: 'ready' },
          },
          jobs: {
            create: { type: 'session.ended' },
          },
        },
      });

      oldSessionId = oldSession.id;

      const recentSession = await prisma.session.create({
        data: {
          userId,
          role: 'software-engineer',
          status: 'ENDED',
          endedAt: recentDate,
        },
      });

      recentSessionId = recentSession.id;

      const keptSession = await prisma.session.create({
        data: {
            userId,
            role: 'software-engineer',
            status: 'ENDED',
            endedAt: oldDate,
            keep: true,
        },
      });

      keptSessionId = keptSession.id;
    });

    afterAll(async () => {
      await prisma.user.deleteMany({ where: { id: userId } });
      await prisma.$disconnect();
    });

    it('deletes expired unkept sessions and preserves recent and kept sessions', async () => {
      const result = await purgeExpiredSessions(purgeNow);

      expect(result.count).toBe(1);

      expect(
        await prisma.session.findUnique({ where: { id: oldSessionId } })
      ).toBeNull();

      expect(
        await prisma.session.findUnique({ where: { id: recentSessionId } })
      ).not.toBeNull();

      expect(
        await prisma.session.findUnique({ where: { id: keptSessionId } })
      ).not.toBeNull();

      expect(await prisma.turn.count({ where: { sessionId: oldSessionId } })).toBe(0);
      expect(await prisma.feedback.count({ where: { sessionId: oldSessionId } })).toBe(0);
      expect(await prisma.job.count({ where: { sessionId: oldSessionId } })).toBe(0);
    });
  }
);
