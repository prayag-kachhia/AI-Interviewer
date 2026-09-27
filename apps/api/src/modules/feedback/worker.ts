import type postgres from "postgres";
import type { Job, Feedback } from "./schema";

export interface EnqueueJobParams {
  type: string;
  sessionId?: string;
  payload?: Record<string, unknown>;
}

export interface SaveFeedbackParams {
  sessionId: string;
  userId?: string;
  status: "pending" | "ready" | "failed";
  summary?: string;
  scores?: Array<{
    category: string;
    score: number;
    comment: string;
  }>;
}

/**
 * Enqueue a new job into the jobs table with 'queued' status.
 */
export async function enqueueJob(
  sql: postgres.Sql,
  params: EnqueueJobParams
): Promise<Job> {
  const id = crypto.randomUUID();
  const [job] = await sql<Job[]>`
    INSERT INTO jobs (
      id,
      type,
      "sessionId",
      payload,
      status,
      attempts,
      "createdAt",
      "updatedAt"
    ) VALUES (
      ${id},
      ${params.type},
      ${params.sessionId ?? null},
      ${JSON.stringify(params.payload ?? {})},
      'queued',
      0,
      NOW(),
      NOW()
    )
    RETURNING *;
  `;

  if (!job) {
    throw new Error("Failed to enqueue job: no row returned");
  }

  return job;
}

/**
 * Claims the next available queued or pending job using SELECT ... FOR UPDATE SKIP LOCKED.
 * Optionally filters by job type (e.g., 'session.ended').
 * Also recovers stale jobs whose worker lock expired (> 5 minutes ago).
 * Guarantees that concurrent workers will never claim the same job.
 */
export async function claimNextJob(
  sql: postgres.Sql,
  workerId: string,
  jobType?: string
): Promise<Job | null> {
  return await sql.begin(async (tx) => {
    // 1. Atomically lock the next available job, skipping rows locked by other transactions
    const rows = jobType
      ? await tx<Job[]>`
          SELECT * FROM jobs
          WHERE type = ${jobType}
            AND (
              status IN ('queued', 'pending')
              OR (status = 'processing' AND "lockedAt" < NOW() - INTERVAL '5 minutes')
            )
          ORDER BY "createdAt" ASC
          LIMIT 1
          FOR UPDATE SKIP LOCKED;
        `
      : await tx<Job[]>`
          SELECT * FROM jobs
          WHERE (
            status IN ('queued', 'pending')
            OR (status = 'processing' AND "lockedAt" < NOW() - INTERVAL '5 minutes')
          )
          ORDER BY "createdAt" ASC
          LIMIT 1
          FOR UPDATE SKIP LOCKED;
        `;

    const job = rows[0];
    if (!job) {
      return null;
    }

    // 2. Mark claimed job as processing and assign worker
    const [claimed] = await tx<Job[]>`
      UPDATE jobs
      SET
        status = 'processing',
        "lockedBy" = ${workerId},
        "lockedAt" = NOW(),
        attempts = COALESCE(attempts, 0) + 1,
        "updatedAt" = NOW()
      WHERE id = ${job.id}
      RETURNING *;
    `;

    return claimed ?? null;
  });
}

/**
 * Marks a job as completed.
 */
export async function completeJob(
  sql: postgres.Sql,
  jobId: string
): Promise<void> {
  await sql`
    UPDATE jobs
    SET
      status = 'completed',
      "lockedBy" = NULL,
      "lockedAt" = NULL,
      "updatedAt" = NOW()
    WHERE id = ${jobId};
  `;
}

/**
 * Marks a job as failed with an error message.
 */
export async function failJob(
  sql: postgres.Sql,
  jobId: string,
  error: string
): Promise<void> {
  await sql`
    UPDATE jobs
    SET
      status = 'failed',
      "lastError" = ${error},
      "lockedBy" = NULL,
      "lockedAt" = NULL,
      "updatedAt" = NOW()
    WHERE id = ${jobId};
  `;
}

/**
 * Creates or updates a feedback record for a session.
 */
export async function saveFeedback(
  sql: postgres.Sql,
  params: SaveFeedbackParams
): Promise<Feedback> {
  const id = crypto.randomUUID();
  const [row] = await sql<Feedback[]>`
    INSERT INTO feedback (
      id,
      "sessionId",
      "userId",
      status,
      summary,
      scores,
      "createdAt",
      "updatedAt"
    ) VALUES (
      ${id},
      ${params.sessionId},
      ${params.userId ?? null},
      ${params.status},
      ${params.summary ?? null},
      ${JSON.stringify(params.scores ?? [])},
      NOW(),
      NOW()
    )
    RETURNING *;
  `;

  if (!row) {
    throw new Error("Failed to save feedback: no row returned");
  }

  return row;
}

/**
 * Executes a single job cycle: claims the next job, executes the handler,
 * and marks it completed (or failed if an exception is thrown).
 */
export async function processNextJob(
  sql: postgres.Sql,
  workerId: string,
  handler: (job: Job) => Promise<void>,
  jobType?: string
): Promise<Job | null> {
  const job = await claimNextJob(sql, workerId, jobType);
  if (!job) {
    return null;
  }

  try {
    await handler(job);
    await completeJob(sql, job.id);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    await failJob(sql, job.id, message);
    throw err;
  }

  return job;
}
