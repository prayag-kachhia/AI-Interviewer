import type { Job, Prisma } from '../generated/prisma/client';
import prisma from '../utils/db';

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
      SET status = 'failed', "lastError" = 'Worker stopped responding', "lockedBy" = NULL,
          "lockedAt" = NULL, "updatedAt" = NOW()
      WHERE status = 'processing'
        AND "lockedAt" < NOW() - INTERVAL '5 minutes'
        AND attempts >= ${MAX_ATTEMPTS}`;

    const type = jobType ?? null;
    const rows = await tx.$queryRaw<Job[]>`
      SELECT * FROM jobs
      WHERE (${type}::text IS NULL OR type = ${type}::text)
        AND (status = 'pending'
             OR (status = 'processing' AND "lockedAt" < NOW() - INTERVAL '5 minutes'))
      ORDER BY "createdAt" ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED`;

    const job = rows[0];
    if (!job) {
      return null;
    }

    return tx.job.update({
      where: { id: job.id },
      data: {
        status: 'processing',
        lockedBy: workerId,
        lockedAt: new Date(),
        attempts: { increment: 1 },
      },
    });
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
 * One worker cycle: claim a job, run the handler, then mark the job completed,
 * or failed if the handler throws. Returns null when there was nothing to do.
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
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    await failJob(job.id, message);
    throw err;
  }

  return job;
}
