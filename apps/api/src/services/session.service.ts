import prisma from '../utils/db';
import { NotFoundError } from '../utils/resource';
import { isValidRoleId } from '../constants/roles';
import { ROLES } from '@interview/contracts';
import { evaluateTranscript, type EvaluatorOptions } from './evaluator.service';

export class InvalidRoleError extends Error {
  constructor(message: string = 'Invalid role') {
    super(message);
    this.name = 'InvalidRoleError';
  }
}

export class InvalidTimestampError extends Error {
  constructor(message: string = 'Turn timestamp is ahead of the session\'s elapsed time') {
    super(message);
    this.name = 'InvalidTimestampError';
  }
}

export class SessionEndedError extends Error {
  constructor(message: string = 'This session has already ended') {
    super(message);
    this.name = 'SessionEndedError';
  }
}

/**
 * LS2 — Create a session for a signed-in candidate + a validated role.
 */
export async function createSession(userId: string, roleId: string) {
  if (!isValidRoleId(roleId)) {
    throw new InvalidRoleError(`Unknown role id: ${roleId}`);
  }

  return prisma.session.create({
    data: { userId, role: roleId },
  });
}

/**
 * Ownership-scoped lookup. Always query by (id AND userId) together so a
 * session belonging to another user resolves to "not found" (404), never a
 * 403 — this avoids revealing whether the id exists at all (FR-27).
 */
export async function getOwnedSession(sessionId: string, userId: string) {
  const session = await prisma.session.findFirst({
    where: { id: sessionId, userId },
  });

  if (!session) {
    throw new NotFoundError();
  }

  return session;
}

export async function listTurns(sessionId: string, userId: string) {
  await getOwnedSession(sessionId, userId);
  return prisma.turn.findMany({
    where: { sessionId },
    orderBy: { turnIndex: 'asc' },
  });
}

/**
 * LS4 — Store one transcript turn, after ownership + timestamp validation.
 */
export async function addTurn(
  sessionId: string,
  userId: string,
  speaker: 'AI' | 'CANDIDATE',
  text: string,
  timestampSec: number
) {
  const session = await getOwnedSession(sessionId, userId);

  if (session.status !== 'LIVE') {
    throw new SessionEndedError();
  }

  const elapsedSec = Math.max(0, (Date.now() - session.startedAt.getTime()) / 1000);
  if (timestampSec > elapsedSec) {
    throw new InvalidTimestampError();
  }

  const turnCount = await prisma.turn.count({ where: { sessionId } });

  return prisma.turn.create({
    data: {
      sessionId,
      speaker,
      text,
      timestampSec,
      turnIndex: turnCount + 1,
    },
  });
}

/**
 * Asynchronously evaluates the transcript for an ended session, persisting
 * ready feedback or recording the failure in feedback.error.
 */
export async function runFeedbackEvaluation(
  sessionId: string,
  role?: string,
  options?: EvaluatorOptions
): Promise<void> {
  const session = await prisma.session.findUniqueOrThrow({
    where: { id: sessionId },
    include: { turns: { orderBy: { turnIndex: 'asc' } } },
  });

  const sessionRole = role ?? session?.role;
  const roleLabel = ROLES.find((r) => r.id === sessionRole)?.label ?? sessionRole;
  const turns = session?.turns ?? [];

  try {
    const evaluation = await evaluateTranscript({ roleLabel, turns }, options);
    await prisma.feedback.upsert({
      where: { sessionId },
      create: {
        sessionId,
        status: 'ready',
        summary: evaluation.summary,
        scores: evaluation.scores,
        error: null,
      },
      update: {
        status: 'ready',
        summary: evaluation.summary,
        scores: evaluation.scores,
        error: null,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Feedback evaluation failed for session ${sessionId}:`, error);
    await prisma.feedback.upsert({
      where: { sessionId },
      create: {
        sessionId,
        status: 'failed',
        error: message,
      },
      update: {
        status: 'failed',
        error: message,
      },
    });
  }
}

/**
 * LS4 — End the session and initialize feedback in ONE atomic transaction:
 * mark the session ENDED and upsert a pending feedback row.
 * After the transaction successfully commits, directly fire feedback evaluation asynchronously.
 */
export async function endSession(sessionId: string, userId: string) {
  const session = await getOwnedSession(sessionId, userId);

  if (session.status === 'ENDED') {
    // Idempotent: calling end twice just returns the already-ended session.
    return session;
  }

  const [updatedSession] = await prisma.$transaction([
    prisma.session.update({
      where: { id: sessionId },
      data: { status: 'ENDED', endedAt: new Date() },
    }),
    prisma.feedback.upsert({
      where: { sessionId },
      create: {
        sessionId,
        status: 'pending',
      },
      update: {
        status: 'pending',
      },
    }),
  ]);

  // Step B: Trigger evaluation directly without awaiting it.
  // Evaluation continues independently of the response returned to the client.
  runFeedbackEvaluation(sessionId, updatedSession.role).catch((err) => {
    console.error(`Unhandled error during feedback evaluation for session ${sessionId}:`, err);
  });

  return updatedSession;
}
