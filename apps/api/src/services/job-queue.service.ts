import type { Job, Prisma } from '../generated/prisma/client';
import prisma from '../db';
import { getVerifiedGitHubLoginForUser, GitHubRateLimitError } from './github.service';

// A job whose worker stopped responding is retried until it has been claimed
// this many times; after that it is marked failed so it can't loop forever.
export const MAX_ATTEMPTS = 3;

export const JOB_TYPES = {
  SESSION_ENDED: 'session.ended',
  INSIGHTS_REFRESH: 'insights.refresh',
  RETENTION_PURGE: 'retention.purge',
  GITHUB_ANALYZE: 'github.analyze',
} as const;

export type JobType = (typeof JOB_TYPES)[keyof typeof JOB_TYPES] | (string & {});

export interface EnqueueJobParams {
  type: JobType;
  sessionId?: string;
  payload?: Prisma.InputJsonObject;
  availableAt?: Date;
}

export async function enqueueJob(params: EnqueueJobParams): Promise<Job> {
  return prisma.job.create({
    data: {
      type: params.type,
      sessionId: params.sessionId ?? null,
      payload: params.payload ?? {},
      ...(params.availableAt ? { availableAt: params.availableAt } : {}),
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
    // Give up on jobs whose worker kept dying, and mark their feedback failed so
    // the candidate sees "Try again" instead of a result that stays pending forever.
    await tx.$executeRaw`
      WITH given_up AS (
        UPDATE jobs
        SET status = 'failed',
            "lastError" = 'Worker stopped responding',
            "lockedBy" = NULL,
            "lockedAt" = NULL,
            "updatedAt" = NOW()
        WHERE status = 'processing'
          AND "lockedAt" < NOW() - INTERVAL '5 minutes'
          AND attempts >= ${MAX_ATTEMPTS}
        RETURNING "sessionId", type
      )
      INSERT INTO feedback (id, "sessionId", status, error, "updatedAt")
      SELECT gen_random_uuid()::text, "sessionId", 'failed', 'Worker stopped responding', NOW()
      FROM given_up
      WHERE type = 'session.ended' AND "sessionId" IS NOT NULL
      ON CONFLICT ("sessionId") DO UPDATE
      SET status = 'failed', error = EXCLUDED.error, "updatedAt" = NOW()
      WHERE feedback.status <> 'ready'`;

    const type = jobType ?? null;

    const rows = await tx.$queryRaw<Job[]>`
      WITH next_job AS (
        SELECT id
        FROM jobs
        WHERE (${type}::text IS NULL OR type = ${type}::text)
          AND (
            (status = 'pending' AND "availableAt" <= NOW())
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
 * after its availableAt timestamp) can retry it. Does NOT increment attempts: attempts is
 * only incremented when claimed by claimNextJob.
 */
export async function requeueJob(jobId: string, error: string, availableAt?: Date): Promise<void> {
  await prisma.job.update({
    where: { id: jobId },
    data: {
      status: 'pending',
      lastError: error,
      ...(availableAt ? { availableAt } : {}),
      lockedBy: null,
      lockedAt: null,
    },
  });
}

/**
 * Identifies whether an error is a typed GitHubRateLimitError.
 */
export function isGitHubRateLimitError(err: unknown): err is GitHubRateLimitError {
  return (
    err instanceof GitHubRateLimitError ||
    (Boolean(err && typeof err === 'object') && (err as any).name === 'GitHubRateLimitError')
  );
}

/**
 * Calculates the next availableAt date for a rate-limited job.
 * If resetAt is provided, valid, and in the future, it is used.
 * Otherwise, falls back to bounded exponential backoff:
 * 30s * 2^(attempt - 1), capped at 5 minutes (300s).
 * - attempt 1: 30s
 * - attempt 2: 60s
 * - attempt 3: 120s
 * - ... capped at 300s
 */
export function calculateRateLimitRetryAt(
  resetAt: Date | undefined,
  attempts: number,
  now: Date = new Date()
): Date {
  const nowMs = now.getTime();
  if (resetAt instanceof Date && !isNaN(resetAt.getTime()) && resetAt.getTime() > nowMs) {
    return resetAt;
  }

  const attemptIndex = Math.max(0, attempts - 1);
  const backoffSec = Math.min(300, 30 * Math.pow(2, attemptIndex));
  return new Date(nowMs + backoffSec * 1000);
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
      if (isGitHubRateLimitError(err)) {
        const retryAt = calculateRateLimitRetryAt(err.resetAt, job.attempts);
        console.warn(
          `[${workerId}] GitHub rate limit for job ${job.id} (${job.type}). ` +
          `Attempt ${job.attempts}/${MAX_ATTEMPTS}. Scheduling retry at ${retryAt.toISOString()}: ${message}`
        );
        await requeueJob(job.id, message, retryAt);
        return null;
      }

      console.warn(
        `[${workerId}] transient error for job ${job.id} (${job.type}). ` +
        `Attempt ${job.attempts}/${MAX_ATTEMPTS}. Requeuing: ${message}`
      );
      await requeueJob(job.id, message);
      return null;
    }
    await failJob(job.id, message);
    throw err;
  }
}

/**
 * Ensures exactly one retention purge job is queued per UTC calendar day.
 * PostgreSQL advisory locking prevents duplicate jobs across multiple workers.
 */
export async function enqueueDailyRetentionPurge(now: Date = new Date()): Promise<void> {
  const scheduledDate = now.toISOString().slice(0, 10);

  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT 1::int AS locked
      FROM (
        SELECT pg_advisory_xact_lock(190, hashtext(${scheduledDate}))
      ) AS advisory_lock
    `;

    const existingJob = await tx.job.findFirst({
      where: {
        type: JOB_TYPES.RETENTION_PURGE,
        payload: {
          path: ['scheduledDate'],
          equals: scheduledDate,
        },
      },
      select: { id: true },
    });

    if (existingJob) {
      return;
    }

    await tx.job.create({
      data: {
        type: JOB_TYPES.RETENTION_PURGE,
        payload: { scheduledDate },
      },
    });
  });
}

/**
 * 24 hours in milliseconds for GitHub analysis daily refresh protection (FR-10, VM-12).
 */
export const DAILY_GITHUB_REFRESH_MS = 24 * 60 * 60 * 1000;

export function isEligibleForDailyGithubRefresh(
  fetchedAt?: Date | string | null,
  now: Date = new Date()
): boolean {
  if (!fetchedAt) return true;
  const fetchedTime = fetchedAt instanceof Date ? fetchedAt.getTime() : new Date(fetchedAt).getTime();
  if (isNaN(fetchedTime)) return true;
  return now.getTime() - fetchedTime >= DAILY_GITHUB_REFRESH_MS;
}

/**
 * Enqueues a `github.analyze` job with daily refresh protection and concurrency control.
 *
 * 1. Checks if the user already has a GithubProfile fetched < 24h ago; if so, skips.
 * 2. Checks if there is already a pending or processing `github.analyze` job for this user; if so, skips.
 * 3. Uses a PostgreSQL advisory lock on userId to prevent concurrent requests from bypassing the check.
 */
export async function maybeEnqueueGithubAnalysis(
  userId: string,
  login: string,
  now: Date = new Date()
): Promise<{ queued: boolean; reason?: string; job?: Job }> {
  if (!login || typeof login !== 'string' || login.trim().length === 0) {
    return { queued: false, reason: 'invalid_login' };
  }

  const cleanLogin = login.trim();
  const normalizedLogin = cleanLogin.toLowerCase();

  return prisma.$transaction(async (tx) => {
    // PostgreSQL advisory transaction lock on userId to serialize concurrent requests for the same user
    await tx.$queryRaw`
      SELECT 1::int AS locked
      FROM (
        SELECT pg_advisory_xact_lock(195, hashtext(${userId}))
      ) AS advisory_lock
    `;

    // 1. Check existing GithubProfile
    const profile = await tx.githubProfile.findUnique({
      where: { userId },
      select: { fetchedAt: true, login: true },
    });

    const isSameLogin = profile?.login ? profile.login.trim().toLowerCase() === normalizedLogin : false;
    if (isSameLogin && profile?.fetchedAt && !isEligibleForDailyGithubRefresh(profile.fetchedAt, now)) {
      return { queued: false, reason: 'recently_fetched' };
    }

    // 2. Prevent duplicate pending or processing jobs for the same user and same GitHub login
    let existingJob = await tx.job.findFirst({
      where: {
        type: JOB_TYPES.GITHUB_ANALYZE,
        status: { in: ['pending', 'processing'] },
        AND: [
          {
            payload: {
              path: ['userId'],
              equals: userId,
            },
          },
          {
            payload: {
              path: ['login'],
              equals: normalizedLogin,
            },
          },
        ],
      },
    });

    if (!existingJob) {
      // Backward compatibility: check if an active job already exists with legacy mixed-casing payload
      const candidateJobs = await (tx.job.findMany
        ? tx.job.findMany({
            where: {
              type: JOB_TYPES.GITHUB_ANALYZE,
              status: { in: ['pending', 'processing'] },
              AND: [
                {
                  payload: {
                    path: ['userId'],
                    equals: userId,
                  },
                },
              ],
            },
          })
        : tx.job
            .findFirst({
              where: {
                type: JOB_TYPES.GITHUB_ANALYZE,
                status: { in: ['pending', 'processing'] },
                AND: [
                  {
                    payload: {
                      path: ['userId'],
                      equals: userId,
                    },
                  },
                ],
              },
            })
            .then((j) => (j ? [j] : [])));

      existingJob =
        candidateJobs.find((j) => {
          const p = j.payload as { login?: string } | null;
          return (
            typeof p?.login === 'string' &&
            p.login.trim().toLowerCase() === normalizedLogin
          );
        }) ?? null;
    }

    if (existingJob) {
      return { queued: false, reason: 'already_queued', job: existingJob };
    }

    // 3. Enqueue the analysis job
    const job = await tx.job.create({
      data: {
        type: JOB_TYPES.GITHUB_ANALYZE,
        payload: { userId, login: normalizedLogin },
      },
    });

    return { queued: true, job };
  });
}

/**
 * Triggers GitHub analysis only if the user has a verified linked GitHub OAuth account.
 * Rejects unlinked accounts and respects daily refresh limits.
 */
export async function triggerGithubAnalysisIfLinked(
  userId: string,
  supabaseUserId?: string | null,
  now: Date = new Date()
): Promise<{ queued: boolean; reason?: string; job?: Job }> {
  let targetSupabaseId = supabaseUserId;
  if (!targetSupabaseId) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { supabaseUserId: true },
    });
    targetSupabaseId = user?.supabaseUserId ?? null;
  }

  if (!targetSupabaseId) {
    return { queued: false, reason: 'no_github_linked' };
  }

  const login = await getVerifiedGitHubLoginForUser(targetSupabaseId);
  if (!login) {
    return { queued: false, reason: 'no_github_linked' };
  }

  return maybeEnqueueGithubAnalysis(userId, login, now);
}
