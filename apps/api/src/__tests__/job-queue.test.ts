import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';

// Local test-only error class matching the shape expected by job-queue.service
// to avoid top-level import of github.service (which transitively imports db.ts
// and requires DATABASE_URL even when the suite is skipped).
class GitHubRateLimitError extends Error {
  public readonly status = 429;
  public readonly resetAt?: Date;

  constructor(message = 'GitHub API rate limit exceeded', resetAt?: Date) {
    super(message);
    this.name = 'GitHubRateLimitError';
    this.resetAt = resetAt;
  }
}

// FB2 needs a real Postgres to prove FOR UPDATE SKIP LOCKED. It runs only when
// TEST_DATABASE_URL points at a disposable database with the migrations
// applied — never the shared Supabase database. Without it, the suite is skipped.
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DATABASE_URL)('FB2 — jobs table and worker (needs TEST_DATABASE_URL)', () => {
  let prisma: typeof import('../db').default;
  let queue: typeof import('../services/job-queue.service');
  let feedback: typeof import('../services/feedback.service');
  const runId = randomUUID().slice(0, 8);
  let userId: string;
  let sessionId: string;
  const retentionDates: string[] = [];

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    prisma = (await import('../db')).default;
    queue = await import('../services/job-queue.service');
    feedback = await import('../services/feedback.service');

    const user = await prisma.user.create({
      data: { name: 'Queue Test', email: `queue-${runId}@example.com` },
    });
    userId = user.id;
    const session = await prisma.session.create({
      data: { userId, role: 'software-engineer', status: 'ENDED', endedAt: new Date() },
    });
    sessionId = session.id;
  });

  afterAll(async () => {
    await prisma.job.deleteMany({ where: { OR: [{ type: { startsWith: `test.${runId}` } }, { sessionId }] } });
    for (const scheduledDate of retentionDates) {
      await prisma.job.deleteMany({
        where: {
          type: queue.JOB_TYPES.RETENTION_PURGE,
          payload: {
            path: ['scheduledDate'],
            equals: scheduledDate,
          },
        },
      });
    }
    await prisma.feedback.deleteMany({ where: { sessionId } });
    await prisma.session.deleteMany({ where: { id: sessionId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it('given a pending job, the worker claims it with SELECT … FOR UPDATE SKIP LOCKED', async () => {
    const type = `test.${runId}.claim`;
    const job = await queue.enqueueJob({ type, sessionId });
    expect(job.status).toBe('pending');

    const claimed = await queue.claimNextJob('worker-a', type);
    expect(claimed?.id).toBe(job.id);
    expect(claimed?.status).toBe('processing');
    expect(claimed?.lockedBy).toBe('worker-a');
    expect(claimed?.attempts).toBe(1);

    await queue.completeJob(job.id);
    const done = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(done.status).toBe('completed');
    expect(done.lockedBy).toBeNull();
  });

  it('given two workers running, then no job is processed twice', async () => {
    const type = `test.${runId}.concurrent`;
    const ids = new Set<string>();
    for (let i = 0; i < 6; i++) ids.add((await queue.enqueueJob({ type, payload: { i } })).id);

    const seen: Record<string, string[]> = { A: [], B: [] };
    const run = async (name: 'A' | 'B') => {
      for (;;) {
        const job = await queue.claimNextJob(`worker-${name}`, type);
        if (!job) return;

        seen[name]!.push(job.id);

        await new Promise((r) => setTimeout(r, 20));

        await queue.completeJob(job.id);
      }
    };
    await Promise.all([run('A'), run('B')]);

    const all = [...seen.A!, ...seen.B!];
    expect(all).toHaveLength(ids.size);
    expect(new Set(all)).toEqual(ids);
  });

  it('given a job whose worker died, it is retried, then failed after MAX_ATTEMPTS', async () => {
    const type = `test.${runId}.stale`;
    const job = await queue.enqueueJob({ type });
    const staleSince = new Date(Date.now() - 10 * 60 * 1000);

    for (let attempt = 1; attempt <= queue.MAX_ATTEMPTS; attempt++) {
      const claimed = await queue.claimNextJob('worker-crashy', type);
      expect(claimed?.attempts).toBe(attempt);
      await prisma.job.update({ where: { id: job.id }, data: { lockedAt: staleSince } });
    }

    expect(await queue.claimNextJob('worker-next', type)).toBeNull();
    const final = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(final.status).toBe('failed');
  });

  it('given a feedback job whose worker kept dying, its feedback is marked failed', async () => {
    const job = await queue.enqueueJob({ type: 'session.ended', sessionId });
    await prisma.job.update({
      where: { id: job.id },
      data: { status: 'processing', attempts: queue.MAX_ATTEMPTS, lockedAt: new Date(Date.now() - 10 * 60 * 1000) },
    });

    await queue.claimNextJob('worker-next', `test.${runId}.nothing`);

    expect((await prisma.job.findUniqueOrThrow({ where: { id: job.id } })).status).toBe('failed');
    const feedback = await prisma.feedback.findUniqueOrThrow({ where: { sessionId } });
    expect(feedback.status).toBe('failed');
  });

  it('given a handler that throws a permanent error, the job is marked failed with the error', async () => {
    const type = `test.${runId}.throws-perm`;
    const job = await queue.enqueueJob({ type });
    await expect(
      queue.processNextJob('worker-a', async () => {
        throw new Error('GEMINI_API_KEY is not configured');
      }, type)
    ).rejects.toThrow('GEMINI_API_KEY is not configured');
    const row = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(row.status).toBe('failed');
    expect(row.lastError).toBe('GEMINI_API_KEY is not configured');
  });

  it('given a handler that throws a transient error on attempt < MAX_ATTEMPTS, the job is requeued as pending without throwing', async () => {
    const type = `test.${runId}.transient`;
    const job = await queue.enqueueJob({ type });
    const result = await queue.processNextJob(
      'worker-a',
      async () => {
        throw new Error('Evaluation timed out after 12000 ms');
      },
      type
    );
    expect(result).toBeNull();
    const row = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(row.status).toBe('pending');
    expect(row.lastError).toBe('Evaluation timed out after 12000 ms');
    expect(row.lockedBy).toBeNull();
    expect(row.attempts).toBe(1);
  });

  it('given a handler that fails transiently on attempt >= MAX_ATTEMPTS, the job is marked failed', async () => {
    const type = `test.${runId}.transient-max`;
    const job = await queue.enqueueJob({ type });
    // Simulate attempts already reaching MAX_ATTEMPTS - 1, so the next claim makes attempts = MAX_ATTEMPTS
    await prisma.job.update({ where: { id: job.id }, data: { attempts: queue.MAX_ATTEMPTS - 1 } });

    await expect(
      queue.processNextJob(
        'worker-a',
        async () => {
          throw new Error('429 Resource Exhausted');
        },
        type
      )
    ).rejects.toThrow('429 Resource Exhausted');

    const row = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(row.status).toBe('failed');
    expect(row.attempts).toBe(queue.MAX_ATTEMPTS);
    expect(row.lastError).toBe('429 Resource Exhausted');
  });

  it('given a GitHub rate-limit error with future resetAt, schedules job at resetAt, cannot be claimed early, and becomes claimable when availableAt is reached', async () => {
    const type = `test.${runId}.ratelimit.future`;
    const job = await queue.enqueueJob({ type });

    const futureResetAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes in future

    // 1. Process job, throwing rate limit with future resetAt
    const result = await queue.processNextJob(
      'worker-rl-1',
      async () => {
        throw new GitHubRateLimitError('GitHub API rate limit exceeded', futureResetAt);
      },
      type
    );
    expect(result).toBeNull();

    // Verify row in database: status is pending, availableAt is futureResetAt, attempts is 1
    const rowAfterRateLimit = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(rowAfterRateLimit.status).toBe('pending');
    expect(rowAfterRateLimit.lockedBy).toBeNull();
    expect(rowAfterRateLimit.lockedAt).toBeNull();
    expect(rowAfterRateLimit.attempts).toBe(1);
    expect(rowAfterRateLimit.availableAt.getTime()).toBe(futureResetAt.getTime());
    expect(rowAfterRateLimit.lastError).toContain('rate limit exceeded');

    // 2. A pending job with a future availableAt cannot be claimed early
    const earlyClaim = await queue.claimNextJob('worker-rl-early', type);
    expect(earlyClaim).toBeNull();

    // 5. Waiting for the scheduled retry does not increment attempts
    const rowWhileWaiting = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(rowWhileWaiting.attempts).toBe(1);

    // 3. The same job becomes claimable once availableAt is in the past
    const pastAvailableAt = new Date(Date.now() - 5000);
    await prisma.job.update({
      where: { id: job.id },
      data: { availableAt: pastAvailableAt },
    });

    // 6. When the job becomes eligible and is claimed, attempts increment exactly once (1 -> 2)
    const claimedAfterReset = await queue.claimNextJob('worker-rl-ready', type);
    expect(claimedAfterReset?.id).toBe(job.id);
    expect(claimedAfterReset?.status).toBe('processing');
    expect(claimedAfterReset?.attempts).toBe(2);
    expect(claimedAfterReset?.lockedBy).toBe('worker-rl-ready');

    await queue.completeJob(job.id);
  });

  it('given a rate-limit error with missing, invalid, or past resetAt, uses bounded exponential fallback', async () => {
    const type = `test.${runId}.ratelimit.fallback`;
    const job = await queue.enqueueJob({ type });

    const before = Date.now();
    // Attempt 1: throws rate limit without resetAt -> fallback should be ~30s
    await queue.processNextJob(
      'worker-fb-1',
      async () => {
        throw new GitHubRateLimitError('Rate limited without reset');
      },
      type
    );

    const rowAttempt1 = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(rowAttempt1.status).toBe('pending');
    expect(rowAttempt1.attempts).toBe(1);
    // 30s fallback: availableAt should be between now + 28s and now + 35s
    const diff1Sec = (rowAttempt1.availableAt.getTime() - before) / 1000;
    expect(diff1Sec).toBeGreaterThanOrEqual(28);
    expect(diff1Sec).toBeLessThanOrEqual(35);

    // Cannot be claimed early
    expect(await queue.claimNextJob('worker-fb-early', type)).toBeNull();

    // Fast-forward availableAt to past and test Attempt 2 (fallback 60s) with past resetAt
    await prisma.job.update({
      where: { id: job.id },
      data: { availableAt: new Date(Date.now() - 1000) },
    });

    const beforeAttempt2 = Date.now();
    await queue.processNextJob(
      'worker-fb-2',
      async () => {
        // past resetAt (should be ignored and fall back to exponential backoff)
        throw new GitHubRateLimitError('Past reset', new Date(Date.now() - 60000));
      },
      type
    );

    const rowAttempt2 = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(rowAttempt2.status).toBe('pending');
    expect(rowAttempt2.attempts).toBe(2);
    // 60s fallback: availableAt should be between now + 58s and now + 65s
    const diff2Sec = (rowAttempt2.availableAt.getTime() - beforeAttempt2) / 1000;
    expect(diff2Sec).toBeGreaterThanOrEqual(58);
    expect(diff2Sec).toBeLessThanOrEqual(65);

    await queue.completeJob(job.id);
  });

  it('given a rate-limit error when attempts reaches MAX_ATTEMPTS, fails immediately without requeueing', async () => {
    const type = `test.${runId}.ratelimit.max`;
    const job = await queue.enqueueJob({ type });
    // Set attempts to MAX_ATTEMPTS - 1 so the next claim makes it MAX_ATTEMPTS
    await prisma.job.update({ where: { id: job.id }, data: { attempts: queue.MAX_ATTEMPTS - 1 } });

    await expect(
      queue.processNextJob(
        'worker-max',
        async () => {
          throw new GitHubRateLimitError('Rate limited at max');
        },
        type
      )
    ).rejects.toThrow('Rate limited at max');

    const finalRow = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(finalRow.status).toBe('failed');
    expect(finalRow.attempts).toBe(queue.MAX_ATTEMPTS);
    expect(finalRow.lastError).toContain('Rate limited at max');
  });

  it('saving feedback twice for a session keeps one row', async () => {
    await feedback.saveFeedback({ sessionId, status: 'pending' });
    await feedback.saveFeedback({ sessionId, status: 'ready', summary: 'Clear answers.' });
    const rows = await prisma.feedback.findMany({ where: { sessionId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('ready');
  });

  it('queues exactly one retention purge job per UTC calendar day', async () => {
    const offsetDays = parseInt(runId, 16) % 36500;

    const firstDate = new Date(
      Date.UTC(2100, 0, 1) + offsetDays * 24 * 60 * 60 * 1000
    );

    const nextDate = new Date(firstDate.getTime() + 24 * 60 * 60 * 1000);

    const firstKey = firstDate.toISOString().slice(0, 10);
    const nextKey = nextDate.toISOString().slice(0, 10);

    retentionDates.push(firstKey, nextKey);

    await queue.enqueueDailyRetentionPurge(firstDate);
    await queue.enqueueDailyRetentionPurge(firstDate);
    await queue.enqueueDailyRetentionPurge(nextDate);

    const firstDayJobs = await prisma.job.count({
      where: {
        type: queue.JOB_TYPES.RETENTION_PURGE,
        payload: {
          path: ['scheduledDate'],
          equals: firstKey,
        },
      },
    });

    const nextDayJobs = await prisma.job.count({
      where: {
        type: queue.JOB_TYPES.RETENTION_PURGE,
        payload: {
          path: ['scheduledDate'],
          equals: nextKey,
        },
      },
    });

    expect(firstDayJobs).toBe(1);
    expect(nextDayJobs).toBe(1);
  });
});
