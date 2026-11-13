import prisma from '../db';
import { AppError, NotFoundError } from '../errors';
import { FeedbackStatus, ROLES, type CreateSessionInput } from '@interview/contracts';

// The role list lives in @interview/contracts so the API and the web app share it.
const VALID_ROLE_IDS = new Set(ROLES.map((r) => r.id));

export function isValidRoleId(roleId: string): boolean {
  return typeof roleId === 'string' && VALID_ROLE_IDS.has(roleId);
}

export class InvalidRoleError extends AppError {
  constructor(message: string = 'Invalid role') {
    super(400, message);
  }
}

export const MAX_TURN_TEXT_LENGTH = 4000;

export class TurnTextTooLongError extends AppError {
  constructor(message: string = `Turn text exceeds maximum allowed length of ${MAX_TURN_TEXT_LENGTH} characters`) {
    super(400, message);
  }
}

export class InvalidTimestampError extends AppError {
  constructor(message: string = 'Turn timestamp is ahead of the session\'s elapsed time') {
    super(400, message);
  }
}

export class SessionEndedError extends AppError {
  constructor(message: string = 'This session has already ended') {
    super(409, message);
  }
}

/**
 * Create a session for a signed-in candidate with the setup they chose
 * (role, and optionally focus, company, level and mode).
 */
export async function createSession(userId: string, input: CreateSessionInput) {
  const { roleId } = input;
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
      company: input.company ?? null,
      level: input.level ?? null,
      focus: input.focus ?? null,
      mode: input.mode,
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
  const items = Array.isArray(scores)
    ? scores
    : scores && typeof scores === 'object' && Array.isArray((scores as { scores?: unknown }).scores)
      ? (scores as { scores: unknown[] }).scores
      : null;

  if (!items || items.length === 0) {
    return null;
  }

  const validScores: number[] = [];

  for (const item of items) {
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
 * Store one transcript turn, computing timestampSec on the server and enforcing integrity rules (PK-6, NFR-10):
 * - Rejects turns on non-LIVE or ended sessions (SessionEndedError -> 409).
 * - Rejects text exceeding 4,000 characters (TurnTextTooLongError -> 400).
 * - Logs warnings (without rejecting) on alternating speaker anomalies or non-monotonic timestamps.
 * - Automatically retries on unique-index conflicts for (sessionId, turnIndex) under concurrent submissions.
 */
export async function addTurn(
  sessionId: string,
  userId: string,
  speaker: 'AI' | 'CANDIDATE',
  text: string
) {
  if (text.length > MAX_TURN_TEXT_LENGTH) {
    throw new TurnTextTooLongError();
  }

  const session = await getOwnedSession(sessionId, userId);

  if (session.status !== 'LIVE') {
    throw new SessionEndedError();
  }

  const elapsedSec = Math.max(0, (Date.now() - session.startedAt.getTime()) / 1000);

  // Soft integrity checks: log warnings without rejecting turns
  // (Live interruptions and conversational overlap make consecutive turns or slight jitter legitimate)
  const lastTurn = await prisma.turn.findFirst({
    where: { sessionId },
    orderBy: { turnIndex: 'desc' },
  });

  if (lastTurn) {
    if (lastTurn.speaker === speaker) {
      console.warn(
        `[transcript-integrity] Non-alternating speaker for session ${sessionId}: consecutive ${speaker} turns`
      );
    }
    if (elapsedSec < lastTurn.timestampSec) {
      console.warn(
        `[transcript-integrity] Turn timestamp out of order for session ${sessionId}: new=${elapsedSec}s, last=${lastTurn.timestampSec}s`
      );
    }
  }

  const MAX_RETRIES = 3;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const turnCount = await prisma.turn.count({ where: { sessionId } });
      return await prisma.turn.create({
        data: {
          sessionId,
          speaker,
          text,
          timestampSec: elapsedSec,
          turnIndex: turnCount + 1,
        },
      });
    } catch (error: any) {
      const isUniqueIndexConflict =
        error?.code === 'P2002' ||
        (Array.isArray(error?.meta?.target) && error.meta.target.includes('turnIndex'));

      if (isUniqueIndexConflict && attempt < MAX_RETRIES - 1) {
        continue;
      }
      throw error;
    }
  }

  throw new Error('Failed to record turn after retrying on unique-index conflict');
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

/**
 * Query AI questions from the candidate's last N ended sessions for a given role (FR-16).
 * Capped at 30 questions to fit within context limits.
 */
export async function recentQuestions(
  userId: string,
  roleId: string,
  limitSessions = 3
): Promise<string[]> {
  const pastSessions = await prisma.session.findMany({
    where: {
      userId,
      role: roleId,
      status: 'ENDED',
    },
    orderBy: { endedAt: 'desc' },
    take: limitSessions,
    select: { id: true },
  });

  if (pastSessions.length === 0) {
    return [];
  }

  const sessionIds = pastSessions.map((s) => s.id);
  const aiTurns = await prisma.turn.findMany({
    where: {
      sessionId: { in: sessionIds },
      speaker: 'AI',
    },
    orderBy: { turnIndex: 'asc' },
    take: 30,
    select: { text: true },
  });

  return aiTurns.map((t) => t.text.trim()).filter((t) => t.length > 0);
}
