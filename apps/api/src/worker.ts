import type { Job } from './generated/prisma/client';
import {
  processNextJob,
  enqueueDailyRetentionPurge,
} from './services/job-queue.service';
import { handleSessionEnded } from './services/feedback.service';
import { handleInsightsRefresh } from './services/insights.service';
import { purgeExpiredSessions } from './services/retention.service';

const IDLE_POLL_MS = 1000;

export async function handleJob(job: Job): Promise<void> {
  switch (job.type) {
    case 'session.ended':
      await handleSessionEnded(job);
      break;
    case 'insights.refresh':
      await handleInsightsRefresh(job);
      break;
    case 'retention.purge': {
      const result = await purgeExpiredSessions();
      console.log(`[retention] purged ${result.count} expired sessions`);
      break;
    }
    default:
      throw new Error(`Unknown job type: ${job.type}`);
  }
}

/**
 * Claims and handles jobs until stopped. Several of these can
 * run at once (in the API process and in `bun run worker`); SKIP LOCKED makes
 * sure each job is handled by only one.
 */
export async function runWorker(
  workerId: string,
  signal?: AbortSignal,
  jobType?: string
): Promise<void> {
  console.log(`[${workerId}] waiting for jobs${jobType ? ` of type ${jobType}` : ''}`);
  let lastScheduledDate: string | undefined;
  while (!signal?.aborted) {
    const now = new Date();
    const scheduledDate = now.toISOString().slice(0, 10);

    if (scheduledDate !== lastScheduledDate) {
      try {
        await enqueueDailyRetentionPurge(now);
        lastScheduledDate = scheduledDate;
      } catch (error) {
        console.error(`[${workerId}] failed to enqueue daily retention purge:`, error);
      }
    }
    try {
      const job = await processNextJob(
        workerId,
        async (j) => {
          await handleJob(j);
          if (j.type === 'session.ended') {
            console.log(`[${workerId}] feedback written for session ${j.sessionId}`);
          } else if (j.type === 'insights.refresh') {
            console.log(`[${workerId}] insights refreshed for session ${j.sessionId ?? j.id}`);
          }
        },
        jobType
      );
      if (job) {
        continue;
      }
    } catch (error) {
      console.error(`[${workerId}] job failed:`, error);
    }
    await new Promise((resolve) => setTimeout(resolve, IDLE_POLL_MS));
  }
}

if (import.meta.main) {
  runWorker(`worker-${process.pid}`);
}
