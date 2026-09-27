import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { sql, closeDb } from "../../db";
import {
  enqueueJob,
  claimNextJob,
  completeJob,
  failJob,
  saveFeedback,
  type Job,
} from "./index";

describe("FB2: Feedback Jobs and Worker", () => {
  const testRunId = crypto.randomUUID().slice(0, 8);
  const createdJobIds: string[] = [];
  const createdFeedbackIds: string[] = [];
  let testSessionId: string;

  beforeAll(async () => {
    // Find or create a session to satisfy foreign key constraint on jobs.sessionId
    const existing = await sql<{ id: string }[]>`
      SELECT id FROM sessions LIMIT 1;
    `;
    if (existing[0]) {
      testSessionId = existing[0].id;
    } else {
      const [user] = await sql<{ id: string }[]>`
        SELECT id FROM users LIMIT 1;
      `;
      const userId = user?.id ?? crypto.randomUUID();
      if (!user) {
        await sql`
          INSERT INTO users (id, name, email, "passwordHash", "createdAt", "updatedAt")
          VALUES (${userId}, 'Test User', ${`test-${testRunId}@example.com`}, 'hash', NOW(), NOW());
        `;
      }
      testSessionId = crypto.randomUUID();
      await sql`
        INSERT INTO sessions (id, "userId", role, status, "startedAt", "createdAt")
        VALUES (${testSessionId}, ${userId}, 'software-engineer', 'ENDED', NOW(), NOW());
      `;
    }
  });

  afterAll(async () => {
    // Clean up test jobs and test feedback records
    try {
      if (createdJobIds.length > 0) {
        await sql`
          DELETE FROM jobs
          WHERE id IN ${sql(createdJobIds)};
        `;
      }
      if (createdFeedbackIds.length > 0) {
        await sql`
          DELETE FROM feedback
          WHERE id IN ${sql(createdFeedbackIds)};
        `;
      }
    } finally {
      await closeDb();
    }
  });

  test(
    "Given a queued job, then the worker claims it with SELECT ... FOR UPDATE SKIP LOCKED",
    async () => {
      const jobType = `test.claim.${testRunId}`;
      const enqueued = await enqueueJob(sql, {
        type: jobType,
        sessionId: testSessionId,
        payload: { roleId: "backend-engineer", testRunId },
      });
      createdJobIds.push(enqueued.id);

      expect(enqueued.id).toBeDefined();
      expect(enqueued.status).toBe("queued");

      const workerId = `worker-test-${testRunId}`;
      // Claims specifically this job type using SELECT ... FOR UPDATE SKIP LOCKED
      const claimed = await claimNextJob(sql, workerId, jobType);

      expect(claimed).not.toBeNull();
      if (claimed) {
        expect(claimed.id).toBe(enqueued.id);
        expect(claimed.status).toBe("processing");
        expect(claimed.lockedBy).toBe(workerId);
        expect(claimed.lockedAt).not.toBeNull();
        expect(claimed.attempts).toBeGreaterThanOrEqual(1);

        // Mark completed and verify
        await completeJob(sql, claimed.id);
        const [finalRow] = await sql<Job[]>`SELECT * FROM jobs WHERE id = ${claimed.id}`;
        expect(finalRow).toBeDefined();
        if (finalRow) {
          expect(finalRow.status).toBe("completed");
          expect(finalRow.lockedBy).toBeNull();
        }
      }
    },
    { timeout: 30000 }
  );

  test(
    "Given two workers running, then no job is processed twice",
    async () => {
      const jobCount = 4;
      const testBatchId = `batch-${testRunId}`;
      const batchJobType = `test.concurrent.${testBatchId}`;
      const batchJobIds: string[] = [];

      // Enqueue 4 distinct jobs for the concurrent claiming test
      for (let i = 0; i < jobCount; i++) {
        const job = await enqueueJob(sql, {
          type: batchJobType,
          sessionId: testSessionId,
          payload: { batchIndex: i, testBatchId },
        });
        batchJobIds.push(job.id);
        createdJobIds.push(job.id);
      }

      const workerA = `worker-A-${testRunId}`;
      const workerB = `worker-B-${testRunId}`;

      const processedByA: string[] = [];
      const processedByB: string[] = [];

      // Simulate Worker A and Worker B concurrently polling and processing jobs
      async function runWorker(
        workerId: string,
        targetStore: string[]
      ): Promise<void> {
        while (true) {
          // Safe claim specifically for this batch using SELECT ... FOR UPDATE SKIP LOCKED
          const claimed = await claimNextJob(sql, workerId, batchJobType);
          if (!claimed) {
            break;
          }

          targetStore.push(claimed.id);
          // Simulate work
          await new Promise((resolve) => setTimeout(resolve, 20));
          await completeJob(sql, claimed.id);
        }
      }

      // Run both workers simultaneously
      await Promise.all([
        runWorker(workerA, processedByA),
        runWorker(workerB, processedByB),
      ]);

      // 1. Verify that both workers together claimed all batch jobs
      const totalProcessed = processedByA.length + processedByB.length;
      expect(totalProcessed).toBe(jobCount);

      // 2. CRITICAL ACCEPTANCE CRITERIA: Verify no job was processed twice (disjoint sets)
      const setA = new Set(processedByA);
      const setB = new Set(processedByB);

      for (const id of setA) {
        expect(setB.has(id)).toBe(false);
      }
      for (const id of setB) {
        expect(setA.has(id)).toBe(false);
      }

      // 3. Verify all batch jobs are in 'completed' state in database
      const finalRows = await sql<Job[]>`
        SELECT status, "lockedBy" FROM jobs WHERE id IN ${sql(batchJobIds)}
      `;
      expect(finalRows.length).toBe(jobCount);
      for (const row of finalRows) {
        expect(row.status).toBe("completed");
        expect(row.lockedBy).toBeNull();
      }
    },
    { timeout: 30000 }
  );

  test(
    "Given a failing job, then failJob records the error and clears lock",
    async () => {
      const jobType = `test.fail.${testRunId}`;
      const job = await enqueueJob(sql, {
        type: jobType,
        sessionId: testSessionId,
        payload: { shouldFail: true },
      });
      createdJobIds.push(job.id);

      const workerId = `worker-failing-${testRunId}`;
      const claimed = await claimNextJob(sql, workerId, jobType);
      expect(claimed).not.toBeNull();

      if (claimed) {
        await failJob(sql, claimed.id, "LLM evaluation timeout");

        const [failedRow] = await sql<Job[]>`SELECT * FROM jobs WHERE id = ${claimed.id}`;
        expect(failedRow).toBeDefined();
        if (failedRow) {
          expect(failedRow.status).toBe("failed");
          expect(failedRow.lastError).toBe("LLM evaluation timeout");
          expect(failedRow.lockedBy).toBeNull();
        }
      }
    },
    { timeout: 30000 }
  );

  test(
    "Given an evaluation result, feedback can be stored in the feedback table",
    async () => {
      const saved = await saveFeedback(sql, {
        sessionId: testSessionId,
        userId: `user-${testRunId}`,
        status: "ready",
        summary: "Strong candidate with solid understanding of distributed systems.",
        scores: [
          { category: "technical_depth", score: 4, comment: "Good explanation of ACID." },
          { category: "communication", score: 5, comment: "Clear and concise answers." },
        ],
      });
      createdFeedbackIds.push(saved.id);

      expect(saved.id).toBeDefined();
      expect(saved.sessionId).toBe(testSessionId);
      expect(saved.status).toBe("ready");
      expect(saved.summary).toContain("Strong candidate");
      expect(saved.scores?.length).toBe(2);
    },
    { timeout: 30000 }
  );
});
