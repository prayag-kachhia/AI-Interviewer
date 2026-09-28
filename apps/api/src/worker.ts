import { processNextJob } from './services/job-queue.service';
import { handleSessionEnded } from './services/feedback.service';

const IDLE_POLL_MS = 1000;

/**
 * Claims and handles `session.ended` jobs until stopped. Several of these can
 * run at once (in the API process and in `bun run worker`); SKIP LOCKED makes
 * sure each job is handled by only one.
 */
export async function runWorker(workerId: string, signal?: AbortSignal): Promise<void> {
  console.log(`[${workerId}] waiting for session.ended jobs`);
  while (!signal?.aborted) {
    try {
      const job = await processNextJob(workerId, (j) => handleSessionEnded(j), 'session.ended');
      if (job) {
        console.log(`[${workerId}] feedback written for session ${job.sessionId}`);
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
