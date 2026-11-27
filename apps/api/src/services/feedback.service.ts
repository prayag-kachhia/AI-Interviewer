import type { Feedback, Job, Prisma } from '../generated/prisma/client';
import { Feedback as FeedbackContract } from '@interview/contracts';
import prisma from '../db';
import { AppError } from '../errors';
import {
  evaluateTranscript,
  type EvaluatorOptions,
  type EvaluationUsageMetadata,
} from './evaluator.service';
import { getOwnedSession } from './session.service';
import { isTransientError, MAX_ATTEMPTS, enqueueJob } from './job-queue.service';

export type FeedbackStatus = 'pending' | 'ready' | 'failed';

export class FeedbackRetryConflictError extends AppError {
  constructor(message: string = 'Only failed feedback evaluations can be retried') {
    super(409, message);
  }
}

export interface TokenUsage {
  promptTokens: number;
  outputTokens: number;
  totalTokens: number;
  candidatesTokens?: number;
  thoughtsTokens?: number;
}

export interface StoredFeedbackUsage {
  promptTokens: number;
  outputTokens: number;
  totalTokens: number;
  candidatesTokens?: number;
  thoughtsTokens?: number;
  evaluator?: TokenUsage;
  nextQuestion?: TokenUsage & { callCount: number };
}

export interface SaveFeedbackParams {
  sessionId: string;
  status: FeedbackStatus;
  summary?: string;
  scores?: Prisma.InputJsonValue;
  perAnswer?: Prisma.InputJsonValue;
  error?: string;
  usage?: Prisma.InputJsonValue;
}

/**
 * Merges next-question token counts into an existing usage JSON object.
 * Output tokens include both visible response tokens (candidates) and reasoning tokens (thoughts),
 * matching Google's Gemini output token billing without double-counting.
 */
export function mergeNextQuestionUsage(
  existingUsage: unknown,
  newTokens: EvaluationUsageMetadata
): StoredFeedbackUsage {
  const current = (typeof existingUsage === 'object' && existingUsage !== null
    ? existingUsage
    : {}) as StoredFeedbackUsage;

  const prevNQ = current.nextQuestion ?? {
    promptTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    callCount: 0,
  };

  const newPrompt = newTokens.promptTokenCount ?? 0;
  const newCandidates = newTokens.candidatesTokenCount ?? 0;
  const newThoughts = newTokens.thoughtsTokenCount ?? 0;
  const newOutput = newCandidates + newThoughts;

  const prevNQThoughts = prevNQ.thoughtsTokens ?? 0;
  const prevNQCandidates = prevNQ.candidatesTokens ?? (prevNQ.outputTokens - prevNQThoughts);

  const nqPrompt = prevNQ.promptTokens + newPrompt;
  const nqCandidates = prevNQCandidates + newCandidates;
  const nqThoughts = prevNQThoughts + newThoughts;
  const nqOutput = nqCandidates + nqThoughts;
  const nqTotal = nqPrompt + nqOutput;

  const hasNQThoughts = nqThoughts > 0 || prevNQ.thoughtsTokens !== undefined || newTokens.thoughtsTokenCount !== undefined;

  const nextQuestion: TokenUsage & { callCount: number } = {
    promptTokens: nqPrompt,
    outputTokens: nqOutput,
    totalTokens: nqTotal,
    callCount: prevNQ.callCount + 1,
    ...(hasNQThoughts ? { thoughtsTokens: nqThoughts, candidatesTokens: nqCandidates } : {}),
  };

  const evalUsage = current.evaluator;
  const totalPrompt = (evalUsage?.promptTokens ?? 0) + nqPrompt;
  const evalThoughts = evalUsage?.thoughtsTokens ?? 0;
  const evalCandidates = evalUsage?.candidatesTokens ?? (evalUsage ? evalUsage.outputTokens - evalThoughts : 0);
  const totalThoughts = evalThoughts + nqThoughts;
  const totalCandidates = evalCandidates + nqCandidates;
  const totalOutput = totalCandidates + totalThoughts;

  const hasTopThoughts = totalThoughts > 0 || current.thoughtsTokens !== undefined || hasNQThoughts;

  return {
    promptTokens: totalPrompt,
    outputTokens: totalOutput,
    totalTokens: totalPrompt + totalOutput,
    ...(hasTopThoughts ? { thoughtsTokens: totalThoughts, candidatesTokens: totalCandidates } : {}),
    ...(evalUsage ? { evaluator: evalUsage } : {}),
    nextQuestion,
  };
}

/**
 * Merges transcript evaluator token counts into an existing usage JSON object.
 * Output tokens include both visible evaluation text and model thinking tokens.
 */
export function mergeEvaluatorUsage(
  existingUsage: unknown,
  evaluatorTokens: EvaluationUsageMetadata
): StoredFeedbackUsage {
  const current = (typeof existingUsage === 'object' && existingUsage !== null
    ? existingUsage
    : {}) as StoredFeedbackUsage;

  const evalPrompt = evaluatorTokens.promptTokenCount ?? 0;
  const evalCandidates = evaluatorTokens.candidatesTokenCount ?? 0;
  const evalThoughts = evaluatorTokens.thoughtsTokenCount ?? 0;
  const evalOutput = evalCandidates + evalThoughts;
  const evalTotal = evalPrompt + evalOutput;

  const hasEvalThoughts = evalThoughts > 0 || evaluatorTokens.thoughtsTokenCount !== undefined;

  const evaluator: TokenUsage = {
    promptTokens: evalPrompt,
    outputTokens: evalOutput,
    totalTokens: evalTotal,
    ...(hasEvalThoughts ? { thoughtsTokens: evalThoughts, candidatesTokens: evalCandidates } : {}),
  };

  const nqUsage = current.nextQuestion;
  const totalPrompt = evalPrompt + (nqUsage?.promptTokens ?? 0);
  const nqThoughts = nqUsage?.thoughtsTokens ?? 0;
  const nqCandidates = nqUsage?.candidatesTokens ?? (nqUsage ? nqUsage.outputTokens - nqThoughts : 0);
  const totalThoughts = evalThoughts + nqThoughts;
  const totalCandidates = evalCandidates + nqCandidates;
  const totalOutput = totalCandidates + totalThoughts;

  const hasTopThoughts = totalThoughts > 0 || current.thoughtsTokens !== undefined || hasEvalThoughts;

  return {
    promptTokens: totalPrompt,
    outputTokens: totalOutput,
    totalTokens: totalPrompt + totalOutput,
    ...(hasTopThoughts ? { thoughtsTokens: totalThoughts, candidatesTokens: totalCandidates } : {}),
    evaluator,
    ...(nqUsage ? { nextQuestion: nqUsage } : {}),
  };
}

/**
 * Records token usage from an individual next-question generation call.
 * Coordinates with endSession inside an atomic transaction:
 * - Discards write if session is no longer LIVE (ended or deleted).
 * - Discards write if feedback is already marked ready (prevents overwriting final evaluation).
 * - If feedback row exists, updates only where status is pending.
 */
export async function recordNextQuestionUsage(
  sessionId: string,
  usageMetadata: EvaluationUsageMetadata
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    // 1. Synchronize using an exclusive row-level lock on the session row (FOR UPDATE).
    // This serializes concurrent question updates and synchronizes with endSession.
    let sessionStatus: string | undefined;
    if (typeof tx.$queryRaw === 'function') {
      const lockedSessions = await tx.$queryRaw<Array<{ id: string; status: string }>>`
        SELECT id, status FROM sessions WHERE id = ${sessionId} FOR UPDATE
      `;
      sessionStatus = lockedSessions[0]?.status;
    } else {
      const session = await tx.session.findUnique({
        where: { id: sessionId },
        select: { status: true },
      });
      sessionStatus = session?.status;
    }

    if (!sessionStatus || sessionStatus !== 'LIVE') {
      return;
    }

    // 2. Check existing feedback status (safely serialized under session row lock)
    const existing = await tx.feedback.findUnique({
      where: { sessionId },
      select: { status: true, usage: true },
    });
    if (existing && existing.status === 'ready') {
      return;
    }

    const updatedUsage = mergeNextQuestionUsage(existing?.usage, usageMetadata);

    if (existing) {
      // Atomic guard: only update if feedback status is still pending
      await tx.feedback.updateMany({
        where: {
          sessionId,
          status: 'pending',
        },
        data: {
          usage: updatedUsage as unknown as Prisma.InputJsonValue,
        },
      });
    } else {
      await tx.feedback.create({
        data: {
          sessionId,
          status: 'pending',
          usage: updatedUsage as unknown as Prisma.InputJsonValue,
        },
      });
    }
  });
}

/**
 * Creates or updates the one feedback row for a session (sessionId is unique),
 * so a retried job overwrites its earlier result instead of adding a second one.
 */
export async function saveFeedback(params: SaveFeedbackParams): Promise<Feedback> {
  let storedScores: Prisma.InputJsonValue;
  if (params.perAnswer !== undefined) {
    storedScores = {
      scores: params.scores ?? [],
      perAnswer: params.perAnswer,
    };
  } else {
    storedScores = params.scores ?? [];
  }

  const data: Prisma.FeedbackUncheckedCreateInput = {
    sessionId: params.sessionId,
    status: params.status,
    summary: params.summary ?? null,
    scores: storedScores,
    error: params.error ?? null,
    ...(params.usage !== undefined ? { usage: params.usage } : {}),
  };
  const updateData: Prisma.FeedbackUncheckedUpdateInput = {
    status: params.status,
    summary: params.summary ?? null,
    scores: storedScores,
    error: params.error ?? null,
    ...(params.usage !== undefined ? { usage: params.usage } : {}),
  };

  return prisma.feedback.upsert({
    where: { sessionId: params.sessionId },
    create: data,
    update: updateData,
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

  let scoresData: unknown = undefined;
  let perAnswerData: unknown = undefined;
  if (row.status === 'ready' && row.scores) {
    if (Array.isArray(row.scores)) {
      scoresData = row.scores;
    } else if (typeof row.scores === 'object' && row.scores !== null) {
      const parsed = row.scores as { scores?: unknown; perAnswer?: unknown };
      scoresData = parsed.scores;
      perAnswerData = parsed.perAnswer;
    }
  }

  return FeedbackContract.parse({
    sessionId,
    status: row.status,
    summary: row.summary ?? undefined,
    scores: scoresData,
    perAnswer: perAnswerData,
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
    const evaluation = await evaluateTranscript(
      {
        roleId: session.role,
        turns: session.turns,
        jobContext: session.jobContext ?? undefined,
      },
      options
    );

    const existingFeedback = await prisma.feedback.findUnique({
      where: { sessionId: session.id },
      select: { usage: true },
    });

    const combinedUsage = evaluation.usageMetadata
      ? mergeEvaluatorUsage(existingFeedback?.usage, evaluation.usageMetadata)
      : (existingFeedback?.usage as StoredFeedbackUsage | undefined);

    await saveFeedback({
      sessionId: session.id,
      status: 'ready',
      summary: evaluation.summary,
      scores: evaluation.scores,
      perAnswer: evaluation.perAnswer,
      ...(combinedUsage !== undefined ? { usage: combinedUsage as unknown as Prisma.InputJsonValue } : {}),
    });
    await enqueueJob({
      type: 'insights.refresh',
      sessionId: session.id,
      payload: { userId: session.userId },
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
