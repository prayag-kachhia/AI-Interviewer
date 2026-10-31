import prisma from '../utils/db';
import { NotFoundError } from '../utils/resource';
import { ROLES } from '@interview/contracts';

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

  return prisma.session.create({
    data: { userId, role: roleId },
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

export async function listTurns(sessionId: string, userId: string) {
  await getOwnedSession(sessionId, userId);
  return prisma.turn.findMany({
    where: { sessionId },
    orderBy: { turnIndex: 'asc' },
  });
}

/**
 * Store one transcript turn, after ownership + timestamp validation.
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
