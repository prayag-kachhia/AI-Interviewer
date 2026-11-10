import prisma from '../db';
import { NotFoundError } from '../errors';
import { FeedbackStatus, ROLES } from '@interview/contracts';

// The role list lives in @interview/contracts so the API and the web app share it.
const VALID_ROLE_IDS = new Set(ROLES.map((r) => r.id));

export function isValidRoleId(roleId: string): boolean {
  return typeof roleId === 'string' && VALID_ROLE_IDS.has(roleId);
}

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
 * Create a session for a signed-in candidate + a validated role.
 */

export async function createSession(userId: string, roleId: string) {
  if (!isValidRoleId(roleId)) {
    throw new InvalidRoleError(`Unknown role id: ${roleId}`);
  }

  const latestResume = await prisma.resume.findFirst({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });

  return prisma.session.create({
    data: {
      userId,
      role: roleId,
      resumeId: latestResume?.id ?? null,
    },
  });
}

/**
 * Ownership-scoped lookup. Always query by (id AND userId) together so a
 * session belonging to another user resolves to "not found" (404), never a
 * 403 — this avoids revealing whether the id exists at all.
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

// Matches the briefing's default time limit; sessions have no per-session limit yet.
export const EARLY_END_THRESHOLD_MINUTES = 15;

/**
 * Computes an overall feedback score from the rubric scores array.
 * Only accepts rubric score objects with a finite numeric score between 1 and 5,
 * ignoring malformed or out-of-range entries.
 * Returns the average of valid scores rounded to 1 decimal place, or null if no valid scores remain.
 */
export function computeOverallScore(scores: unknown): number | null {
  if (!Array.isArray(scores) || scores.length === 0) {
    return null;
  }

  const validScores: number[] = [];

  for (const item of scores) {
    if (typeof item === 'object' && item !== null && 'score' in item) {
      const val = (item as { score?: unknown }).score;
      if (typeof val === 'number' && Number.isFinite(val) && val >= 1 && val <= 5) {
        validScores.push(val);
      }
    }
  }

  if (validScores.length === 0) {
    return null;
  }

  const sum = validScores.reduce((acc, curr) => acc + curr, 0);
  return Math.round((sum / validScores.length) * 10) / 10;
}

/** The user's sessions, newest first, with their feedback status, overall score, and whether they ended early. */
export async function listSessions(userId: string) {
  const sessions = await prisma.session.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    include: { feedback: { select: { status: true, scores: true } } },
  });

  return sessions.map(({ feedback, ...session }) => ({
    ...session,
    // An ended session whose feedback row isn't written yet is still pending.
    feedbackStatus: feedback
      ? FeedbackStatus.parse(feedback.status)
      : session.status === 'ENDED'
        ? 'pending'
        : null,
    overallScore: feedback?.status === 'ready' ? computeOverallScore(feedback.scores) : null,
    endedEarly:
      session.endedAt !== null &&
      session.endedAt.getTime() - session.startedAt.getTime() < EARLY_END_THRESHOLD_MINUTES * 60_000,
  }));
}

export async function listTurns(sessionId: string, userId: string) {
  await getOwnedSession(sessionId, userId);
  return prisma.turn.findMany({
    where: { sessionId },
    orderBy: { turnIndex: 'asc' },
  });
}

/**
 * Store one transcript turn, computing timestampSec on the server.
 */
export async function addTurn(
  sessionId: string,
  userId: string,
  speaker: 'AI' | 'CANDIDATE',
  text: string
) {
  const session = await getOwnedSession(sessionId, userId);

  if (session.status !== 'LIVE') {
    throw new SessionEndedError();
  }

  const elapsedSec = Math.max(0, (Date.now() - session.startedAt.getTime()) / 1000);
  const turnCount = await prisma.turn.count({ where: { sessionId } });

  return prisma.turn.create({
    data: {
      sessionId,
      speaker,
      text,
      timestampSec: elapsedSec,
      turnIndex: turnCount + 1,
    },
  });
}

/**
 * End the session and hand off to Feedback in ONE transaction:
 * mark the session ENDED and insert a `session.ended` job row. Either both
 * happen or neither does.
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
    prisma.job.create({
      data: {
        type: 'session.ended',
        sessionId,
        status: 'pending',
      },
    }),
  ]);

  return updatedSession;
}

/**
 * Permanently delete an interview session and its cascade data.
 * Reuses getOwnedSession to verify ownership: non-existent sessions and
 * sessions owned by another user resolve to NotFoundError (404).
 */
export async function deleteSession(sessionId: string, userId: string) {
  await getOwnedSession(sessionId, userId);

  return prisma.session.delete({
    where: { id: sessionId },
  });
}
