import type { Feedback, Prisma } from '@prisma/client';
import prisma from '../utils/db';

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
