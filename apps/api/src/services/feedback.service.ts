import type { Feedback, Job, Prisma } from '../generated/prisma/client';
import { Feedback as FeedbackContract, ROLES } from '@interview/contracts';
import prisma from '../utils/db';
import { evaluateTranscript, type EvaluatorOptions } from './evaluator.service';
import { getOwnedSession } from './session.service';

export type FeedbackStatus = 'pending' | 'ready' | 'failed';

export interface SaveFeedbackParams {
  sessionId: string;
  status: FeedbackStatus;
  summary?: string;
  scores?: Prisma.InputJsonArray;
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
 * write the feedback. If evaluation fails, the feedback is marked failed and
 * the error rethrown so the job is marked failed too. The transcript is only
 * read, never changed.
 */
export async function handleSessionEnded(job: Job, options: EvaluatorOptions = {}): Promise<void> {
  if (!job.sessionId) {
    throw new Error(`Job ${job.id} has no sessionId`);
  }
  const session = await prisma.session.findUniqueOrThrow({
    where: { id: job.sessionId },
    include: { turns: { orderBy: { turnIndex: 'asc' } } },
  });
  const roleLabel = ROLES.find((r) => r.id === session.role)?.label ?? session.role;

  try {
    const evaluation = await evaluateTranscript({ roleLabel, turns: session.turns }, options);
    await saveFeedback({
      sessionId: session.id,
      status: 'ready',
      summary: evaluation.summary,
      scores: evaluation.scores,
    });
  } catch (error) {
    await saveFeedback({ sessionId: session.id, status: 'failed' });
    throw error;
  }
}
