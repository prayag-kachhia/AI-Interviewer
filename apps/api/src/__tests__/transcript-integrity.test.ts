import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../server';
import prisma from '../db';
import {
  addTurn,
  TurnTextTooLongError,
  SessionEndedError,
  MAX_TURN_TEXT_LENGTH,
} from '../services/session.service';

vi.mock('@supabase/supabase-js', () => {
  const getUserMock = vi.fn();
  return {
    createClient: vi.fn(() => ({ auth: { getUser: getUserMock } })),
    __getUserMock: getUserMock,
  };
});

vi.mock('../db', () => ({
  default: {
    user: { findUnique: vi.fn() },
    session: { findFirst: vi.fn() },
    turn: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
  },
}));

import * as supabase from '@supabase/supabase-js';
const { __getUserMock } = supabase as any;

const AUTH_USER = {
  id: 'user-integrity-1',
  supabaseUserId: 'supabase-user-integrity-1',
  email: 'prakriti@example.com',
  name: 'Prakriti',
};

const LIVE_SESSION = {
  id: 'sess-integrity-1',
  userId: AUTH_USER.id,
  role: 'software-engineer',
  status: 'LIVE',
  startedAt: new Date(Date.now() - 30_000),
  endedAt: null,
  createdAt: new Date(Date.now() - 30_000),
};

describe('PK-6 — Transcript Integrity Checks (NFR-10)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __getUserMock.mockResolvedValue({
      data: { user: { id: AUTH_USER.supabaseUserId, email: AUTH_USER.email } },
      error: null,
    });
    (prisma.user.findUnique as any).mockResolvedValue({ ...AUTH_USER, passwordHash: 'x' });
    (prisma.session.findFirst as any).mockResolvedValue(LIVE_SESSION);
    (prisma.turn.findFirst as any).mockResolvedValue(null);
    (prisma.turn.count as any).mockResolvedValue(0);
  });

  describe('Turn payload length bounds (4,000 characters)', () => {
    it('accepts turn text up to 4,000 characters', async () => {
      const validText = 'A'.repeat(MAX_TURN_TEXT_LENGTH);
      (prisma.turn.create as any).mockResolvedValueOnce({
        id: 'turn-1',
        sessionId: LIVE_SESSION.id,
        speaker: 'CANDIDATE',
        text: validText,
        timestampSec: 30,
        turnIndex: 1,
        createdAt: new Date(),
      });

      const result = await addTurn(LIVE_SESSION.id, AUTH_USER.id, 'CANDIDATE', validText);
      expect(result.text).toBe(validText);
      expect(prisma.turn.create).toHaveBeenCalled();
    });

    it('rejects turn text exceeding 4,000 characters with TurnTextTooLongError in service', async () => {
      const excessiveText = 'A'.repeat(MAX_TURN_TEXT_LENGTH + 1);

      await expect(
        addTurn(LIVE_SESSION.id, AUTH_USER.id, 'CANDIDATE', excessiveText)
      ).rejects.toThrow(TurnTextTooLongError);

      expect(prisma.turn.create).not.toHaveBeenCalled();
    });

    it('returns HTTP 400 when submitting text exceeding 4,000 characters via POST /api/sessions/:id/turns', async () => {
      const excessiveText = 'B'.repeat(4001);

      const res = await request(app)
        .post(`/api/sessions/${LIVE_SESSION.id}/turns`)
        .set('Authorization', 'Bearer valid-token')
        .send({ speaker: 'CANDIDATE', text: excessiveText });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('4000 characters');
      expect(prisma.turn.create).not.toHaveBeenCalled();
    });
  });

  describe('Session status enforcement', () => {
    it('rejects turns for ENDED sessions with SessionEndedError (HTTP 409)', async () => {
      (prisma.session.findFirst as any).mockResolvedValueOnce({
        ...LIVE_SESSION,
        status: 'ENDED',
        endedAt: new Date(),
      });

      const res = await request(app)
        .post(`/api/sessions/${LIVE_SESSION.id}/turns`)
        .set('Authorization', 'Bearer valid-token')
        .send({ speaker: 'CANDIDATE', text: 'Late turn' });

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(prisma.turn.create).not.toHaveBeenCalled();
    });
  });

  describe('Concurrency retry on unique-index conflict', () => {
    it('retries when a unique constraint conflict (P2002) occurs and succeeds on the next attempt', async () => {
      // First attempt: count is 0 -> tries turnIndex: 1 -> fails with P2002
      // Second attempt: count is 1 -> tries turnIndex: 2 -> succeeds
      (prisma.turn.count as any)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(1);

      const uniqueConstraintError = new Error('Unique constraint failed on the fields: (`sessionId`,`turnIndex`)');
      (uniqueConstraintError as any).code = 'P2002';
      (uniqueConstraintError as any).meta = { target: ['sessionId', 'turnIndex'] };

      const successfulTurn = {
        id: 'turn-2',
        sessionId: LIVE_SESSION.id,
        speaker: 'CANDIDATE',
        text: 'Concurrent turn',
        timestampSec: 30,
        turnIndex: 2,
        createdAt: new Date(),
      };

      (prisma.turn.create as any)
        .mockRejectedValueOnce(uniqueConstraintError)
        .mockResolvedValueOnce(successfulTurn);

      const result = await addTurn(LIVE_SESSION.id, AUTH_USER.id, 'CANDIDATE', 'Concurrent turn');

      expect(result).toEqual(successfulTurn);
      expect(prisma.turn.count).toHaveBeenCalledTimes(2);
      expect(prisma.turn.create).toHaveBeenCalledTimes(2);
    });

    it('throws when max retries are exhausted under persistent conflicts', async () => {
      (prisma.turn.count as any).mockResolvedValue(0);

      const uniqueConstraintError = new Error('Unique constraint failed');
      (uniqueConstraintError as any).code = 'P2002';
      (uniqueConstraintError as any).meta = { target: ['turnIndex'] };

      (prisma.turn.create as any).mockRejectedValue(uniqueConstraintError);

      await expect(
        addTurn(LIVE_SESSION.id, AUTH_USER.id, 'CANDIDATE', 'Race condition')
      ).rejects.toThrow('Unique constraint failed');

      expect(prisma.turn.create).toHaveBeenCalledTimes(3);
    });
  });

  describe('Soft integrity warnings (never reject legitimate live voice turns)', () => {
    it('logs a warning when speakers do not alternate, but stores the turn successfully', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      // Previous turn was also CANDIDATE (e.g. candidate paused and spoke again before AI responded)
      (prisma.turn.findFirst as any).mockResolvedValueOnce({
        id: 'turn-prev',
        sessionId: LIVE_SESSION.id,
        speaker: 'CANDIDATE',
        text: 'Previous sentence.',
        timestampSec: 10,
        turnIndex: 1,
      });
      (prisma.turn.count as any).mockResolvedValueOnce(1);
      (prisma.turn.create as any).mockResolvedValueOnce({
        id: 'turn-next',
        sessionId: LIVE_SESSION.id,
        speaker: 'CANDIDATE',
        text: 'Next sentence.',
        timestampSec: 12,
        turnIndex: 2,
        createdAt: new Date(),
      });

      const result = await addTurn(LIVE_SESSION.id, AUTH_USER.id, 'CANDIDATE', 'Next sentence.');

      expect(result.id).toBe('turn-next');
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[transcript-integrity] Non-alternating speaker')
      );

      warnSpy.mockRestore();
    });

    it('logs a warning when timestamps are non-monotonic due to packet jitter, but stores the turn', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      // Simulate session started 10 seconds ago
      const recentSession = {
        ...LIVE_SESSION,
        startedAt: new Date(Date.now() - 10_000), // elapsedSec ~ 10s
      };
      (prisma.session.findFirst as any).mockResolvedValueOnce(recentSession);

      // Previous turn recorded at 25 seconds (e.g. clock adjustment or previous turn delay)
      (prisma.turn.findFirst as any).mockResolvedValueOnce({
        id: 'turn-prev',
        sessionId: LIVE_SESSION.id,
        speaker: 'AI',
        text: 'Hello',
        timestampSec: 25,
        turnIndex: 1,
      });
      (prisma.turn.count as any).mockResolvedValueOnce(1);
      (prisma.turn.create as any).mockResolvedValueOnce({
        id: 'turn-next',
        sessionId: LIVE_SESSION.id,
        speaker: 'CANDIDATE',
        text: 'Hi there',
        timestampSec: 10,
        turnIndex: 2,
        createdAt: new Date(),
      });

      const result = await addTurn(LIVE_SESSION.id, AUTH_USER.id, 'CANDIDATE', 'Hi there');

      expect(result.id).toBe('turn-next');
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[transcript-integrity] Turn timestamp out of order')
      );

      warnSpy.mockRestore();
    });

    it('does not log warnings on normal alternating turns with monotonic timestamps', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      (prisma.turn.findFirst as any).mockResolvedValueOnce({
        id: 'turn-prev',
        sessionId: LIVE_SESSION.id,
        speaker: 'AI',
        text: 'Tell me about yourself.',
        timestampSec: 5,
        turnIndex: 1,
      });
      (prisma.turn.count as any).mockResolvedValueOnce(1);
      (prisma.turn.create as any).mockResolvedValueOnce({
        id: 'turn-next',
        sessionId: LIVE_SESSION.id,
        speaker: 'CANDIDATE',
        text: 'I am a software engineer.',
        timestampSec: 15,
        turnIndex: 2,
        createdAt: new Date(),
      });

      const result = await addTurn(LIVE_SESSION.id, AUTH_USER.id, 'CANDIDATE', 'I am a software engineer.');

      expect(result.id).toBe('turn-next');
      expect(warnSpy).not.toHaveBeenCalled();

      warnSpy.mockRestore();
    });
  });
});
