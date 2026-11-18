import 'dotenv/config';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DATABASE_URL)(
  'FR-28 / NFR-11 — Complete Account Deletion Integration (PostgreSQL)',
  () => {
    let prisma: typeof import('../db').default;
    const runId = randomUUID().slice(0, 8);

    let userId: string;
    let otherUserId: string;
    const sessionIds: string[] = [];

    beforeAll(async () => {
      process.env.DATABASE_URL = TEST_DATABASE_URL!;

      prisma = (await import('../db')).default;

      // Create primary test user
      const user = await prisma.user.create({
        data: {
          name: 'Account Deletion Test User',
          email: `account-delete-${runId}@example.com`,
          supabaseUserId: `supabase-del-${runId}`,
        },
      });
      userId = user.id;

      // Create an independent second user to verify records remain untouched
      const otherUser = await prisma.user.create({
        data: {
          name: 'Other Independent User',
          email: `other-user-${runId}@example.com`,
          supabaseUserId: `supabase-other-${runId}`,
        },
      });
      otherUserId = otherUser.id;

      // Attach resume to second user
      await prisma.resume.create({
        data: {
          userId: otherUserId,
          fileName: 'other-user-resume.pdf',
          extractedText: 'Other user confidential information',
          parsedProfile: '{"name":"Other Independent User"}',
        },
      });

      // Attach resume to primary test user
      await prisma.resume.create({
        data: {
          userId,
          fileName: 'user-resume.pdf',
          extractedText: 'Primary test user resume content',
          parsedProfile: '{"name":"Account Deletion Test User"}',
        },
      });

      // Attach improvement plan to primary test user
      await prisma.improvementPlan.create({
        data: {
          userId,
          topics: ['System Design', 'React'],
          plan: [{ week: 1, action: 'Review Distributed Systems' }],
        },
      });

      // Attach 2 interview sessions with turns, feedback, and jobs
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
            text: `Answer for session ${i}`,
            timestampSec: 15,
          },
        });

        await prisma.feedback.create({
          data: {
            sessionId: session.id,
            status: 'ready',
            summary: `Feedback summary ${i}`,
            scores: { overall: 85 },
          },
        });

        await prisma.job.create({
          data: {
            type: `test.account-deletion.${runId}.${i}`,
            sessionId: session.id,
          },
        });
      }
    });

    afterAll(async () => {
      if (prisma) {
        if (userId || otherUserId) {
          await prisma.user.deleteMany({
            where: {
              id: {
                in: [userId, otherUserId].filter(Boolean),
              },
            },
          });
        }

        await prisma.$disconnect();
      }
    });

    it('rolls back the transaction and leaves all application records intact when Supabase deletion fails', async () => {
      let failureOccurred = false;

      try {
        await prisma.$transaction(async (tx) => {
          await tx.user.deleteMany({
            where: { id: userId },
          });

          // Simulate Supabase service-role deletion returning an error or throwing
          throw new Error('Simulated Supabase Auth service failure');
        });
      } catch (err: any) {
        failureOccurred = true;
        expect(err.message).toBe('Simulated Supabase Auth service failure');
      }

      expect(failureOccurred).toBe(true);

      // Verify that the rollback preserved the primary user and all child rows
      const preservedUser = await prisma.user.findUnique({ where: { id: userId } });
      expect(preservedUser).not.toBeNull();
      expect(preservedUser?.email).toBe(`account-delete-${runId}@example.com`);

      expect(await prisma.resume.count({ where: { userId } })).toBe(1);
      expect(await prisma.improvementPlan.count({ where: { userId } })).toBe(1);
      expect(await prisma.session.count({ where: { userId } })).toBe(2);
      expect(
        await prisma.turn.count({ where: { sessionId: { in: sessionIds } } })
      ).toBe(2);
      expect(
        await prisma.feedback.count({ where: { sessionId: { in: sessionIds } } })
      ).toBe(2);
      expect(
        await prisma.job.count({ where: { sessionId: { in: sessionIds } } })
      ).toBe(2);

      // Verify second user remains completely untouched
      expect(await prisma.user.findUnique({ where: { id: otherUserId } })).not.toBeNull();
      expect(await prisma.resume.count({ where: { userId: otherUserId } })).toBe(1);
    });

    it('successfully deletes user and cascades through all related records on retry while preserving other users', async () => {
      // Execute the transaction without failure (simulating successful retry)
      await prisma.$transaction(async (tx) => {
        await tx.user.deleteMany({
          where: { id: userId },
        });
        // Supabase deletion succeeds here
      });

      // Verify primary user row is gone
      expect(await prisma.user.findUnique({ where: { id: userId } })).toBeNull();

      // Verify all child records were deleted through cascade
      expect(await prisma.resume.count({ where: { userId } })).toBe(0);
      expect(await prisma.improvementPlan.count({ where: { userId } })).toBe(0);
      expect(await prisma.session.count({ where: { userId } })).toBe(0);
      expect(
        await prisma.turn.count({ where: { sessionId: { in: sessionIds } } })
      ).toBe(0);
      expect(
        await prisma.feedback.count({ where: { sessionId: { in: sessionIds } } })
      ).toBe(0);
      expect(
        await prisma.job.count({ where: { sessionId: { in: sessionIds } } })
      ).toBe(0);

      // Verify second independent user and their records remain completely untouched
      const remainingOtherUser = await prisma.user.findUnique({ where: { id: otherUserId } });
      expect(remainingOtherUser).not.toBeNull();
      expect(remainingOtherUser?.email).toBe(`other-user-${runId}@example.com`);
      expect(await prisma.resume.count({ where: { userId: otherUserId } })).toBe(1);
    });

    it('repeated deletion does not produce record-not-found errors (idempotent cleanup)', async () => {
      // Repeating deleteMany on an already-deleted user must resolve cleanly
      await expect(
        prisma.$transaction(async (tx) => {
          await tx.user.deleteMany({
            where: { id: userId },
          });
        })
      ).resolves.not.toThrow();
    });
  }
);
