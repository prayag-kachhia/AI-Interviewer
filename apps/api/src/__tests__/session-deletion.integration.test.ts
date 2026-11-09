import 'dotenv/config';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { NotFoundError } from '../errors';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DATABASE_URL)(
  'FR-28 — Session deletion cascade and authorization (PostgreSQL)',
  () => {
    // Imported after DATABASE_URL points at the test database, like account-deletion.integration.test.ts.
    let prisma: typeof import('../db').default;
    let sessions: typeof import('../services/session.service');
    let feedback: typeof import('../services/feedback.service');
    const runId = randomUUID().slice(0, 8);

    let userAId: string;
    let userBId: string;
    let sessionA1Id: string;
    let sessionA2Id: string;
    let sessionB1Id: string;

    beforeAll(async () => {
      process.env.DATABASE_URL = TEST_DATABASE_URL!;
      prisma = (await import('../db')).default;
      sessions = await import('../services/session.service');
      feedback = await import('../services/feedback.service');

      // Create User A
      const userA = await prisma.user.create({
        data: {
          name: 'Candidate A',
          email: `user-a-${runId}@example.com`,
        },
      });
      userAId = userA.id;

      // Create User B
      const userB = await prisma.user.create({
        data: {
          name: 'Candidate B',
          email: `user-b-${runId}@example.com`,
        },
      });
      userBId = userB.id;

      // Helper to create session with turns, feedback, and jobs
      const createFullSession = async (userId: string, label: string) => {
        const session = await prisma.session.create({
          data: {
            userId,
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
            text: `Answer for ${label}`,
            timestampSec: 5,
          },
        });

        await prisma.feedback.create({
          data: {
            sessionId: session.id,
            status: 'ready',
            summary: `Feedback for ${label}`,
          },
        });

        await prisma.job.create({
          data: {
            type: `test.session.${runId}.${label}`,
            sessionId: session.id,
          },
        });

        return session.id;
      };

      sessionA1Id = await createFullSession(userAId, 'A1');
      sessionA2Id = await createFullSession(userAId, 'A2');
      sessionB1Id = await createFullSession(userBId, 'B1');
    });

    afterAll(async () => {
      if (prisma) {
        if (userAId) {
          await prisma.user.deleteMany({ where: { id: userAId } });
        }
        if (userBId) {
          await prisma.user.deleteMany({ where: { id: userBId } });
        }
        await prisma.$disconnect();
      }
    });

    it('TEST 1: Owner deletes own session — cascades turns, feedback, and jobs', async () => {
      // User A deletes session A1
      const deleted = await sessions.deleteSession(sessionA1Id, userAId);
      expect(deleted.id).toBe(sessionA1Id);

      // Session A1 is gone
      const sessionInDb = await prisma.session.findUnique({
        where: { id: sessionA1Id },
      });
      expect(sessionInDb).toBeNull();

      // Turns cascade-deleted
      const turnsCount = await prisma.turn.count({
        where: { sessionId: sessionA1Id },
      });
      expect(turnsCount).toBe(0);

      // Feedback cascade-deleted
      const feedbackCount = await prisma.feedback.count({
        where: { sessionId: sessionA1Id },
      });
      expect(feedbackCount).toBe(0);

      // Jobs cascade-deleted
      const jobsCount = await prisma.job.count({
        where: { sessionId: sessionA1Id },
      });
      expect(jobsCount).toBe(0);

      // Session A2 and User A remain unaffected
      const sessionA2 = await prisma.session.findUnique({
        where: { id: sessionA2Id },
      });
      expect(sessionA2).not.toBeNull();
      expect(await prisma.turn.count({ where: { sessionId: sessionA2Id } })).toBe(1);
      expect(await prisma.feedback.count({ where: { sessionId: sessionA2Id } })).toBe(1);
      expect(await prisma.user.findUnique({ where: { id: userAId } })).not.toBeNull();
    });

    it('TEST 2: Stranger attempts to delete another user session — rejects with 404 without modifying session', async () => {
      // User B attempts to delete User A's session A2
      await expect(sessions.deleteSession(sessionA2Id, userBId)).rejects.toThrow(NotFoundError);

      // Session A2 and its relations are untouched
      const sessionA2 = await prisma.session.findUnique({
        where: { id: sessionA2Id },
      });
      expect(sessionA2).not.toBeNull();
      expect(await prisma.turn.count({ where: { sessionId: sessionA2Id } })).toBe(1);
      expect(await prisma.feedback.count({ where: { sessionId: sessionA2Id } })).toBe(1);
    });

    it('TEST 3: Non-existent session deletion — rejects with 404', async () => {
      await expect(sessions.deleteSession('non-existent-session-id', userAId)).rejects.toThrow(NotFoundError);
    });

    it('TEST 4: Deleted session feedback retrieval — rejects with 404', async () => {
      await expect(feedback.getFeedbackForSession(sessionA1Id, userAId)).rejects.toThrow(NotFoundError);
    });
  }
);

