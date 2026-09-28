import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';

// FB2 needs a real Postgres to prove FOR UPDATE SKIP LOCKED. It runs only when
// TEST_DATABASE_URL points at a disposable database with the migrations
// applied — never the shared Supabase database. Without it, the suite is skipped.
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DATABASE_URL)('FB2 — jobs table and worker (needs TEST_DATABASE_URL)', () => {
  let prisma: typeof import('../utils/db').default;
  let queue: typeof import('../services/job-queue.service');
  let feedback: typeof import('../services/feedback.service');
  const runId = randomUUID().slice(0, 8);
  let userId: string;
  let sessionId: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    prisma = (await import('../utils/db')).default;
    queue = await import('../services/job-queue.service');
    feedback = await import('../services/feedback.service');

    const user = await prisma.user.create({
      data: { name: 'Queue Test', email: `queue-${runId}@example.com`, passwordHash: 'supabase-auth' },
    });
    userId = user.id;
    const session = await prisma.session.create({
      data: { userId, role: 'software-engineer', status: 'ENDED', endedAt: new Date() },
    });
    sessionId = session.id;
  });

  afterAll(async () => {
    await prisma.job.deleteMany({ where: { type: { startsWith: `test.${runId}` } } });
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

  it('given a handler that throws, the job is marked failed with the error', async () => {
    const type = `test.${runId}.throws`;
    const job = await queue.enqueueJob({ type });
    await expect(
      queue.processNextJob('worker-a', async () => {
        throw new Error('evaluator timed out');
      }, type)
    ).rejects.toThrow('evaluator timed out');
    const row = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(row.status).toBe('failed');
    expect(row.lastError).toBe('evaluator timed out');
  });

  it('saving feedback twice for a session keeps one row', async () => {
    await feedback.saveFeedback({ sessionId, status: 'pending' });
    await feedback.saveFeedback({ sessionId, status: 'ready', summary: 'Clear answers.' });
    const rows = await prisma.feedback.findMany({ where: { sessionId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('ready');
  });
});
