import type { Job, Prisma } from '../generated/prisma/client';
import prisma from '../db';

// A job whose worker stopped responding is retried until it has been claimed
// this many times; after that it is marked failed so it can't loop forever.
export const MAX_ATTEMPTS = 3;

export interface EnqueueJobParams {
  type: string;
  sessionId?: string;
  payload?: Prisma.InputJsonObject;
}

export async function enqueueJob(params: EnqueueJobParams): Promise<Job> {
  return prisma.job.create({
    data: {
      type: params.type,
      sessionId: params.sessionId ?? null,
      payload: params.payload ?? {},
    },
  });
}

/**
 * Claims the oldest pending job (optionally of one type) with
 * SELECT ... FOR UPDATE SKIP LOCKED, so two workers never get the same row.
 * Jobs left 'processing' by a crashed worker for over 5 minutes are claimed
 * again, up to MAX_ATTEMPTS; past that they are marked failed.
 */

export async function claimNextJob(workerId: string, jobType?: string): Promise<Job | null> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      UPDATE jobs
      SET status = 'failed',
          "lastError" = 'Worker stopped responding',
          "lockedBy" = NULL,
          "lockedAt" = NULL,
          "updatedAt" = NOW()
      WHERE status = 'processing'
        AND "lockedAt" < NOW() - INTERVAL '5 minutes'
        AND attempts >= ${MAX_ATTEMPTS}`;

    const type = jobType ?? null;

    const rows = await tx.$queryRaw<Job[]>`
      WITH next_job AS (
        SELECT id
        FROM jobs
        WHERE (${type}::text IS NULL OR type = ${type}::text)
          AND (
            status = 'pending'
            OR (
              status = 'processing'
              AND "lockedAt" < NOW() - INTERVAL '5 minutes'
            )
          )
        ORDER BY "createdAt" ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      UPDATE jobs AS j
      SET status = 'processing',
          "lockedBy" = ${workerId},
          "lockedAt" = NOW(),
          attempts = j.attempts + 1,
          "updatedAt" = NOW()
      FROM next_job
      WHERE j.id = next_job.id
      RETURNING j.*;
    `;

    return rows[0] ?? null;
  });
}

export async function completeJob(jobId: string): Promise<void> {
  await prisma.job.update({
    where: { id: jobId },
    data: { status: 'completed', lockedBy: null, lockedAt: null },
  });
}

export async function failJob(jobId: string, error: string): Promise<void> {
  await prisma.job.update({
    where: { id: jobId },
    data: { status: 'failed', lastError: error, lockedBy: null, lockedAt: null },
  });
}

/**
 * Resets a job back to 'pending' with its error so another worker (or this one
 * after an idle backoff) can retry it. Does NOT increment attempts: attempts is
 * only incremented when claimed by claimNextJob.
 */
export async function requeueJob(jobId: string, error: string): Promise<void> {
  await prisma.job.update({
    where: { id: jobId },
    data: { status: 'pending', lastError: error, lockedBy: null, lockedAt: null },
  });
}

/**
 * Identifies transient Gemini/network errors that should be retried:
 * - HTTP 429 (Rate Limit / RESOURCE_EXHAUSTED)
 * - HTTP 5xx (500–599: Server error / UNAVAILABLE / DEADLINE_EXCEEDED)
 * - Timeouts (client-side timeout, abort signal, gateway timeout)
 *
 * Permanent errors (400, 401, 402, 403, 404, bad JSON, missing API key, codes >= 600, etc.)
 * return false so they fail immediately.
 */
export function isTransientError(err: unknown): boolean {
  const status = (err as any)?.status ?? (err as any)?.statusCode;
  if (typeof status === 'number') {
    return status === 429 || (status >= 500 && status <= 599);
  }
  const msg = err instanceof Error ? err.message : String(err);
  if (/\b(429|5\d{2})\b/.test(msg)) {
    return true;
  }
  const lower = msg.toLowerCase();
  return (
    lower.includes('timed out') ||
    lower.includes('timeout') ||
    lower.includes('aborted') ||
    lower.includes('econnreset') ||
    lower.includes('econnrefused') ||
    lower.includes('resource_exhausted') ||
    lower.includes('unavailable') ||
    lower.includes('deadline_exceeded')
  );
}

/**
 * One worker cycle: claim a job, run the handler, then mark the job completed.
 * On transient errors with attempts < MAX_ATTEMPTS, the job is requeued as
 * pending with lastError and returns null. On permanent errors or when attempts
 * reach MAX_ATTEMPTS, the job is marked failed and the error rethrown.
 * Returns null when there was nothing to do.
 */
export async function processNextJob(
  workerId: string,
  handler: (job: Job) => Promise<void>,
  jobType?: string
): Promise<Job | null> {
  const job = await claimNextJob(workerId, jobType);
  if (!job) {
    return null;
  }

  try {
    await handler(job);
    await completeJob(job.id);
    return job;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (isTransientError(err) && job.attempts < MAX_ATTEMPTS) {
      await requeueJob(job.id, message);
      return null;
    }
    await failJob(job.id, message);
    throw err;
  }
}
