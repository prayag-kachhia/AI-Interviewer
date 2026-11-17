import type { HistorySession } from '../../types';

export type AchievementId =
  | 'first-interview'
  | 'five-interviews'
  | 'improved-score'
  | 'consistency-streak';

export interface AchievementBadge {
  id: AchievementId;
  title: string;
  description: string;
  unlocked: boolean;
}

/**
 * Returns a UTC day number (integer days since epoch) for a given ISO date string.
 * Returns null if the date string is missing or invalid.
 */
export function getUtcDayNumber(dateString?: string | null): number | null {
  if (!dateString) {
    return null;
  }
  const d = new Date(dateString);
  if (Number.isNaN(d.getTime())) {
    return null;
  }
  return Math.floor(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 86_400_000
  );
}

/**
 * Checks if a later completed interview has a strictly higher valid overall score
 * than an earlier scored, completed interview.
 *
 * Compares chronologically (oldest to newest).
 * Ignores non-ended sessions and missing, null, or non-finite scores.
 */
  export function checkImprovedScore(completedSessions: HistorySession[]): boolean {
    // Sort chronologically ascending by startedAt (fallback to createdAt)
    const chronological = [...completedSessions].sort((a, b) => {
      const timeA = new Date(a.startedAt).getTime() || (a.createdAt ? new Date(a.createdAt).getTime() : 0);
      const timeB = new Date(b.startedAt).getTime() || (b.createdAt ? new Date(b.createdAt).getTime() : 0);
      return timeA - timeB;
    });

    const scoredSessions = chronological.filter(
        (s): s is HistorySession & { overallScore: number } =>
          typeof s.overallScore === 'number' && Number.isFinite(s.overallScore)
    );

    let hasImproved = false;
    let minScoreSoFar = Infinity;

    for (const session of scoredSessions) {
      if (session.overallScore > minScoreSoFar) {
        hasImproved = true;
        break;
      }
      if (session.overallScore < minScoreSoFar) {
        minScoreSoFar = session.overallScore;
      }
    }

    return hasImproved;
  }

  /**
   * Checks if the user completed interviews on at least `requiredDays` consecutive calendar days.
   * Each UTC date is counted at most once.
   */
  export function hasConsistencyStreak(
    completedSessions: HistorySession[],
    requiredDays = 3
  ): boolean {
    const dayNumbers = new Set<number>();

    for (const session of completedSessions) {
      const day = getUtcDayNumber(session.startedAt);
      if (day !== null) {
        dayNumbers.add(day);
      }
    }

    const sortedDays = Array.from(dayNumbers).sort((a, b) => a - b);

    if (sortedDays.length < requiredDays) {
      return false;
    }

    let currentStreak = 1;

    for (let i = 1; i < sortedDays.length; i++) {
      if (sortedDays[i] === sortedDays[i - 1] + 1) {
        currentStreak++;
        if (currentStreak >= requiredDays) {
          return true;
        }
      } else {
        currentStreak = 1;
      }
    }

    return false;
  }

  /**
   * Pure function deriving the four dashboard achievement badges from existing session history.
   */
    export function deriveAchievements(sessions?: HistorySession[] | null): AchievementBadge[] {
      const completed = (sessions ?? []).filter((s) => s.status === 'ENDED');

      const hasFirstInterview = completed.length >= 1;
      const hasFiveInterviews = completed.length >= 5;
      const hasImproved = checkImprovedScore(completed);
      const hasStreak = hasConsistencyStreak(completed, 3);

      return [
        {
          id: 'first-interview',
          title: 'First Interview',
          description: 'Complete at least one mock interview',
          unlocked: hasFirstInterview,
        },
        {
          id: 'five-interviews',
          title: '5 Interviews',
          description: 'Complete at least 5 mock interviews',
          unlocked: hasFiveInterviews,
        },
        {
          id: 'improved-score',
          title: 'Improved Score',
          description: 'Earn a higher score on a later interview than an earlier one',
          unlocked: hasImproved,
        },
        {
          id: 'consistency-streak',
          title: 'Consistency Streak',
          description: 'Complete interviews on 3 consecutive calendar days',
          unlocked: hasStreak,
        },
      ];
    }
