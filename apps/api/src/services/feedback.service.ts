import type { Feedback, Prisma } from '@prisma/client';
import { Feedback as FeedbackContract } from '@interview/contracts';
import prisma from '../utils/db';
import { getOwnedSession } from './session.service';

export type FeedbackStatus = 'pending' | 'ready' | 'failed';

export interface SaveFeedbackParams {
  sessionId: string;
  status: FeedbackStatus;
  summary?: string;
  scores?: Prisma.InputJsonArray;
  error?: string;
}

/**
 * Creates or updates the one feedback row for a session (sessionId is unique),
 * so an evaluation result overwrites its earlier pending status.
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
 * The candidate's feedback for their own session. Another candidate's
 * session is a NotFoundError (404, FR-27). Until evaluation has written a row,
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
    error: row.error ?? undefined,
  });
}
