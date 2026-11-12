import type { Feedback, Job, Prisma } from '../generated/prisma/client';
import { Feedback as FeedbackContract } from '@interview/contracts';
import prisma from '../db';
import { AppError } from '../errors';
import { evaluateTranscript, type EvaluatorOptions } from './evaluator.service';
import { getOwnedSession } from './session.service';
import { isTransientError, MAX_ATTEMPTS } from './job-queue.service';

export type FeedbackStatus = 'pending' | 'ready' | 'failed';

export class FeedbackRetryConflictError extends AppError {
  constructor(message: string = 'Only failed feedback evaluations can be retried') {
    super(409, message);
  }
}

export interface SaveFeedbackParams {
  sessionId: string;
  status: FeedbackStatus;
  summary?: string;
  scores?: Prisma.InputJsonArray;
  error?: string;
}

/**
 * Creates or updates the one feedback row for a session (sessionId is unique),
 * so a retried job overwrites its earlier result instead of adding a second one.
 */
export async function saveFeedback(params: SaveFeedbackParams): Promise<Feedback> {
  const data = {
    status: params.status,
    summary: params.summary ?? null,
    scores: params.scores ?? [],
    error: params.error ?? null,
  };
  return prisma.feedback.upsert({
    where: { sessionId: params.sessionId },
    create: { sessionId: params.sessionId, ...data },
    update: data,
  });
}

/**
 * the candidate's feedback for their own session. Another candidate's
 * session is a NotFoundError (404). Until the worker has written a row,
 * the feedback is pending.
 */
export async function getFeedbackForSession(sessionId: string, userId: string): Promise<FeedbackContract> {
  await getOwnedSession(sessionId, userId);
  const row = await prisma.feedback.findUnique({ where: { sessionId } });
  if (!row) {
    return { sessionId, status: 'pending' };
  }
  return FeedbackContract.parse({
    sessionId,
    status: row.status,
    summary: row.summary ?? undefined,
    scores: row.status === 'ready' ? row.scores : undefined,
  });
}

/**
 * handler for a `session.ended` job: evaluate the stored transcript and
 * write the feedback. If evaluation fails due to a permanent error or because
 * the job has reached MAX_ATTEMPTS, feedback is marked failed. On transient
 * errors with attempts < MAX_ATTEMPTS, feedback remains pending so the worker
 * can retry it. The error is always rethrown so processNextJob can requeue or fail the job.
 * The transcript is only read, never changed.
 */
export async function handleSessionEnded(job: Job, options: EvaluatorOptions = {}): Promise<void> {
  if (!job.sessionId) {
    throw new Error(`Job ${job.id} has no sessionId`);
  }
  const session = await prisma.session.findUniqueOrThrow({
    where: { id: job.sessionId },
    include: { turns: { orderBy: { turnIndex: 'asc' } } },
  });
  try {
    const evaluation = await evaluateTranscript({ roleId: session.role, turns: session.turns }, options);
    await saveFeedback({
      sessionId: session.id,
      status: 'ready',
      summary: evaluation.summary,
      scores: evaluation.scores,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const shouldFailFeedback = !isTransientError(error) || job.attempts >= MAX_ATTEMPTS;
    if (shouldFailFeedback) {
      await saveFeedback({
        sessionId: session.id,
        status: 'failed',
        error: message,
      });
    }
    throw error;
  }
}

/**
 * Retries feedback evaluation for a session whose previous evaluation failed.
 * Enforces ownership (404 if not owned), status precondition (409 if not failed),
 * and creates a session.ended job in the queue atomically.
 */
export async function retryFeedbackEvaluation(
  sessionId: string,
  userId: string
): Promise<FeedbackContract> {
  const session = await getOwnedSession(sessionId, userId);

  await prisma.$transaction(async (tx) => {
    const updateResult = await tx.feedback.updateMany({
      where: {
        sessionId,
        status: 'failed',
      },
      data: {
        status: 'pending',
        summary: null,
        scores: [],
        error: null,
      },
    });

    if (updateResult.count === 0) {
      throw new FeedbackRetryConflictError('Only failed feedback evaluations can be retried');
    }

    await tx.job.create({
      data: {
        type: 'session.ended',
        sessionId,
        status: 'pending',
      },
    });
  });

  return FeedbackContract.parse({
    sessionId,
    status: 'pending',
  });
}
