import { describe, it, expect } from 'vitest';
import {
  deriveAchievements,
  checkImprovedScore,
  hasConsistencyStreak,
  getUtcDayNumber,
} from './achievements';
import type { HistorySession } from '../../types';

  function makeSession(overrides: Partial<HistorySession> = {}): HistorySession {
    return {
      id: `session-${Math.random().toString(36).slice(2, 9)}`,
      userId: 'user-1',
      role: 'software-engineer',
      status: 'ENDED',
      startedAt: '2026-11-01T10:00:00.000Z',
      endedAt: '2026-11-01T10:20:00.000Z',
      feedbackStatus: 'ready',
      overallScore: 3.5,
      ...overrides,
    };
  }

  describe('Achievement Badges Logic', () => {
    describe('Zero and null/undefined sessions', () => {
      it('returns all 4 badges locked for empty array', () => {
        const badges = deriveAchievements([]);
        expect(badges).toHaveLength(4);
        expect(badges.every((b) => b.unlocked === false)).toBe(true);
      });

      it('returns all 4 badges locked for null or undefined input', () => {
        const fromNull = deriveAchievements(null);
        const fromUndefined = deriveAchievements(undefined);

        expect(fromNull).toHaveLength(4);
        expect(fromNull.every((b) => b.unlocked === false)).toBe(true);

        expect(fromUndefined).toHaveLength(4);
        expect(fromUndefined.every((b) => b.unlocked === false)).toBe(true);
      });
    });

    describe('Badge: First Interview', () => {
      it('is locked when user only has LIVE sessions', () => {
        const sessions = [
          makeSession({ status: 'LIVE' }),
          makeSession({ status: 'LIVE' }),
        ];
        const badges = deriveAchievements(sessions);
        const first = badges.find((b) => b.id === 'first-interview');
        expect(first?.unlocked).toBe(false);
      });

      it('is unlocked when user has at least 1 ENDED session', () => {
        const sessions = [makeSession({ status: 'ENDED' })];
        const badges = deriveAchievements(sessions);
        const first = badges.find((b) => b.id === 'first-interview');
        expect(first?.unlocked).toBe(true);
      });
    });

    describe('Badge: 5 Interviews', () => {
      it('is locked when user has 4 completed interviews', () => {
        const sessions = Array.from({ length: 4 }, () => makeSession({ status: 'ENDED' }));
        const badges = deriveAchievements(sessions);
        const five = badges.find((b) => b.id === 'five-interviews');
        expect(five?.unlocked).toBe(false);
      });

      it('is locked when user has 4 ENDED interviews and 2 LIVE interviews', () => {
        const sessions = [
          ...Array.from({ length: 4 }, () => makeSession({ status: 'ENDED' })),
          makeSession({ status: 'LIVE' }),
          makeSession({ status: 'LIVE' }),
        ];
        const badges = deriveAchievements(sessions);
        const five = badges.find((b) => b.id === 'five-interviews');
        expect(five?.unlocked).toBe(false);
      });

      it('is unlocked when user reaches 5 completed interviews', () => {
        const sessions = Array.from({ length: 5 }, () => makeSession({ status: 'ENDED' }));
        const badges = deriveAchievements(sessions);
        const five = badges.find((b) => b.id === 'five-interviews');
        expect(five?.unlocked).toBe(true);
      });

      it('is unlocked when user has more than 5 completed interviews', () => {
        const sessions = Array.from({ length: 7 }, () => makeSession({ status: 'ENDED' }));
        const badges = deriveAchievements(sessions);
        const five = badges.find((b) => b.id === 'five-interviews');
        expect(five?.unlocked).toBe(true);
      });
    });

    describe('Badge: Improved Score', () => {
      it('is locked when there is 0 or 1 scored session', () => {
        expect(checkImprovedScore([])).toBe(false);
        expect(checkImprovedScore([makeSession({ overallScore: 4.0 })])).toBe(false);
      });

      it('compares chronologically when sessions are passed in newest-first (API order)', () => {
        // Newest session first: 4.5 on Nov 5, 3.0 on Nov 1
        // Chronologically: 3.0 -> 4.5 (improved!)
        const sessions = [
          makeSession({ startedAt: '2026-11-05T10:00:00Z', overallScore: 4.5 }),
          makeSession({ startedAt: '2026-11-01T10:00:00Z', overallScore: 3.0 }),
        ];
        expect(checkImprovedScore(sessions)).toBe(true);
      });

      it('is locked when score decreases chronologically', () => {
        // 4.5 on Nov 1 -> 3.0 on Nov 5
        const sessions = [
          makeSession({ startedAt: '2026-11-01T10:00:00Z', overallScore: 4.5 }),
          makeSession({ startedAt: '2026-11-05T10:00:00Z', overallScore: 3.0 }),
        ];
        expect(checkImprovedScore(sessions)).toBe(false);
      });

      it('is locked when scores are identical across sessions', () => {
        const sessions = [
          makeSession({ startedAt: '2026-11-01T10:00:00Z', overallScore: 3.8 }),
          makeSession({ startedAt: '2026-11-05T10:00:00Z', overallScore: 3.8 }),
        ];
        expect(checkImprovedScore(sessions)).toBe(false);
      });

      it('detects improvement across non-consecutive dips (e.g. 4.0 -> 2.5 -> 3.5)', () => {
        const sessions = [
          makeSession({ startedAt: '2026-11-01T10:00:00Z', overallScore: 4.0 }),
          makeSession({ startedAt: '2026-11-02T10:00:00Z', overallScore: 2.5 }),
          makeSession({ startedAt: '2026-11-03T10:00:00Z', overallScore: 3.5 }), // Improved vs 2.5
        ];
        expect(checkImprovedScore(sessions)).toBe(true);
      });

      it('is locked for strictly decreasing score sequences', () => {
        const sessions = [
          makeSession({ startedAt: '2026-11-01T10:00:00Z', overallScore: 5.0 }),
          makeSession({ startedAt: '2026-11-02T10:00:00Z', overallScore: 4.5 }),
          makeSession({ startedAt: '2026-11-03T10:00:00Z', overallScore: 4.0 }),
          makeSession({ startedAt: '2026-11-04T10:00:00Z', overallScore: 3.0 }),
        ];
        expect(checkImprovedScore(sessions)).toBe(false);
      });

      it('ignores missing, null, undefined, NaN, and non-finite scores', () => {
        const sessions = [
          makeSession({ startedAt: '2026-11-01T10:00:00Z', overallScore: 3.0 }),
          makeSession({ startedAt: '2026-11-02T10:00:00Z', overallScore: null }),
          makeSession({ startedAt: '2026-11-03T10:00:00Z', overallScore: undefined }),
          makeSession({ startedAt: '2026-11-04T10:00:00Z', overallScore: NaN }),
          makeSession({ startedAt: '2026-11-05T10:00:00Z', overallScore: Infinity }),
          makeSession({ startedAt: '2026-11-06T10:00:00Z', overallScore: 4.2 }), // Improved vs 3.0
        ];
        expect(checkImprovedScore(sessions)).toBe(true);
      });

      it('is locked if all completed sessions have null or invalid scores', () => {
        const sessions = [
          makeSession({ startedAt: '2026-11-01T10:00:00Z', overallScore: null }),
          makeSession({ startedAt: '2026-11-02T10:00:00Z', overallScore: undefined }),
        ];
        expect(checkImprovedScore(sessions)).toBe(false);
      });

      it('ignores LIVE sessions even if they have scores', () => {
        const sessions = [
          makeSession({ startedAt: '2026-11-01T10:00:00Z', status: 'ENDED', overallScore: 3.0 }),
          makeSession({ startedAt: '2026-11-02T10:00:00Z', status: 'LIVE', overallScore: 5.0 }),
        ];
        const badges = deriveAchievements(sessions);
        const improved = badges.find((b) => b.id === 'improved-score');
        expect(improved?.unlocked).toBe(false);
      });
    });

    describe('Badge: Consistency Streak', () => {
      it('is locked for fewer than 3 total days', () => {
        const sessions = [
          makeSession({ startedAt: '2026-11-01T10:00:00Z' }),
          makeSession({ startedAt: '2026-11-02T10:00:00Z' }),
        ];
        expect(hasConsistencyStreak(sessions, 3)).toBe(false);
      });

      it('counts each calendar date only once (multiple sessions on same day do not count as streak)', () => {
        const sessions = [
          makeSession({ startedAt: '2026-11-01T09:00:00Z' }),
          makeSession({ startedAt: '2026-11-01T14:00:00Z' }),
          makeSession({ startedAt: '2026-11-01T19:00:00Z' }),
        ];
        expect(hasConsistencyStreak(sessions, 3)).toBe(false);
      });

      it('unlocks on exactly 3 consecutive UTC calendar days', () => {
        const sessions = [
          makeSession({ startedAt: '2026-11-01T10:00:00Z' }),
          makeSession({ startedAt: '2026-11-02T15:00:00Z' }),
          makeSession({ startedAt: '2026-11-03T08:00:00Z' }),
        ];
        expect(hasConsistencyStreak(sessions, 3)).toBe(true);
      });

      it('is locked when there is a 1-day gap (e.g. Nov 1, Nov 3, Nov 4)', () => {
        const sessions = [
          makeSession({ startedAt: '2026-11-01T10:00:00Z' }),
          makeSession({ startedAt: '2026-11-03T10:00:00Z' }),
          makeSession({ startedAt: '2026-11-04T10:00:00Z' }),
        ];
        expect(hasConsistencyStreak(sessions, 3)).toBe(false);
      });

      it('unlocks if 3 consecutive days occurred earlier in history', () => {
        const sessions = [
          makeSession({ startedAt: '2026-11-01T10:00:00Z' }),
          makeSession({ startedAt: '2026-11-02T10:00:00Z' }),
          makeSession({ startedAt: '2026-11-03T10:00:00Z' }),
          // Gap of a week
          makeSession({ startedAt: '2026-11-10T10:00:00Z' }),
        ];
        expect(hasConsistencyStreak(sessions, 3)).toBe(true);
      });

      it('handles month boundaries correctly (e.g. March 30, March 31, April 1)', () => {
        const sessions = [
          makeSession({ startedAt: '2026-03-30T10:00:00Z' }),
          makeSession({ startedAt: '2026-03-31T10:00:00Z' }),
          makeSession({ startedAt: '2026-04-01T10:00:00Z' }),
        ];
        expect(hasConsistencyStreak(sessions, 3)).toBe(true);
      });

      it('handles leap year boundaries correctly (Feb 28, Feb 29, March 1 in 2024)', () => {
        const sessions = [
          makeSession({ startedAt: '2024-02-28T18:00:00Z' }),
          makeSession({ startedAt: '2024-02-29T10:00:00Z' }),
          makeSession({ startedAt: '2024-03-01T09:00:00Z' }),
        ];
        expect(hasConsistencyStreak(sessions, 3)).toBe(true);
      });

      it('handles non-leap year February boundaries correctly (Feb 27, Feb 28, March 1 in 2025)', () => {
        const sessions = [
          makeSession({ startedAt: '2025-02-27T10:00:00Z' }),
          makeSession({ startedAt: '2025-02-28T10:00:00Z' }),
          makeSession({ startedAt: '2025-03-01T10:00:00Z' }),
        ];
        expect(hasConsistencyStreak(sessions, 3)).toBe(true);
      });

      it('handles year boundary rollover correctly (Dec 31, Jan 1, Jan 2)', () => {
        const sessions = [
          makeSession({ startedAt: '2025-12-31T20:00:00Z' }),
          makeSession({ startedAt: '2026-01-01T10:00:00Z' }),
          makeSession({ startedAt: '2026-01-02T11:00:00Z' }),
        ];
        expect(hasConsistencyStreak(sessions, 3)).toBe(true);
      });

      it('evaluates calendar days strictly in UTC across extreme times of day', () => {
        // Day 1 late evening UTC, Day 2 noon UTC, Day 3 early morning UTC
        const sessions = [
          makeSession({ startedAt: '2026-11-01T23:59:59.999Z' }),
          makeSession({ startedAt: '2026-11-02T12:00:00.000Z' }),
          makeSession({ startedAt: '2026-11-03T00:00:01.000Z' }),
        ];
        expect(hasConsistencyStreak(sessions, 3)).toBe(true);
      });

      it('only counts completed (ENDED) sessions for streak', () => {
        const sessions = [
          makeSession({ startedAt: '2026-11-01T10:00:00Z', status: 'ENDED' }),
          makeSession({ startedAt: '2026-11-02T10:00:00Z', status: 'LIVE' }),
          makeSession({ startedAt: '2026-11-03T10:00:00Z', status: 'ENDED' }),
        ];
        const badges = deriveAchievements(sessions);
        const streak = badges.find((b) => b.id === 'consistency-streak');
        expect(streak?.unlocked).toBe(false);
      });

      it('gracefully skips sessions with missing or invalid date strings', () => {
        expect(getUtcDayNumber(null)).toBeNull();
        expect(getUtcDayNumber('not-a-valid-date')).toBeNull();

        const sessions = [
          makeSession({ startedAt: 'not-a-date' }),
          makeSession({ startedAt: '2026-11-01T10:00:00Z' }),
          makeSession({ startedAt: '2026-11-02T10:00:00Z' }),
          makeSession({ startedAt: '2026-11-03T10:00:00Z' }),
        ];
        expect(hasConsistencyStreak(sessions, 3)).toBe(true);
      });
    });
  });
