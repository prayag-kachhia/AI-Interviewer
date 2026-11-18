import { ROLES, AdminStats } from '@interview/contracts';
import prisma from '../db';
import { computeOverallScore } from './session.service';

/**
 * Parses the server-side ADMIN_EMAILS environment variable into a Set of normalized emails.
 *
 * Supported format: comma- or semicolon-separated list of email addresses.
 * Example: ADMIN_EMAILS="admin@example.com, owner@company.org"
 *
 * If missing, empty, or whitespace-only, an empty Set is returned so no users gain admin access.
 */
export function getAdminEmails(): Set<string> {
  const raw = process.env.ADMIN_EMAILS;
  if (!raw || !raw.trim()) {
    return new Set();
  }
  return new Set(
    raw
      .split(/[,;]/)
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean)
  );
}

/**
 * Checks whether an email address is configured as an authorized admin.
 * Comparison is case-insensitive and whitespace-tolerant.
 */
export function isAdminEmail(email?: string | null): boolean {
  if (!email || typeof email !== 'string') return false;
  const adminEmails = getAdminEmails();
  if (adminEmails.size === 0) return false;
  return adminEmails.has(email.trim().toLowerCase());
}

/**
 * Checks whether a Supabase user has a verified/confirmed email address.
 * Inspects both email_confirmed_at and confirmed_at (historical Supabase alias).
 */
export function isUserEmailConfirmed(
  user?: {
    email_confirmed_at?: string | null;
    confirmed_at?: string | null;
  } | null
): boolean {
  if (!user) return false;
  return Boolean(user.email_confirmed_at || user.confirmed_at);
}

/**
 * Validates that the caller is both confirmed in Supabase Auth and listed in ADMIN_EMAILS.
 * An unverified account must never receive admin privileges.
 */
export function isVerifiedAdmin(
  email?: string | null,
  isConfirmed?: boolean | null
): boolean {
  if (!isConfirmed) return false;
  return isAdminEmail(email);
}

function formatRoleFallback(roleId: string): string {
  return roleId
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Computes platform-wide statistics for the Owner Dashboard (FR-32, Issue #201).
 *
 * @param referenceDate Optional reference Date for window calculations (defaults to new Date())
 */
export async function getPlatformStats(referenceDate: Date = new Date()): Promise<AdminStats> {
  const refYear = referenceDate.getUTCFullYear();
  const refMonth = referenceDate.getUTCMonth();
  const refDate = referenceDate.getUTCDate();

  // 1. Build the 14-day calendar window ending on referenceDate (UTC)
  const dailyMap = new Map<string, number>();
  for (let i = 13; i >= 0; i--) {
    const d = new Date(Date.UTC(refYear, refMonth, refDate - i));
    const key = d.toISOString().slice(0, 10);
    dailyMap.set(key, 0);
  }

  const windowStart = new Date(Date.UTC(refYear, refMonth, refDate - 13, 0, 0, 0, 0));
  const windowEnd = new Date(Date.UTC(refYear, refMonth, refDate, 23, 59, 59, 999));

  // 2. Fetch total user count
  const totalUsersPromise = prisma.user.count();

  // 3. Fetch interview counts for the 14-day window
  const sessionsInWindowPromise = prisma.session.findMany({
    where: {
      startedAt: {
        gte: windowStart,
        lte: windowEnd,
      },
    },
    select: {
      startedAt: true,
    },
  });

  // 4. Fetch feedback ready and failed counts
  const feedbackReadyPromise = prisma.feedback.count({ where: { status: 'ready' } });
  const feedbackFailedPromise = prisma.feedback.count({ where: { status: 'failed' } });

  // 5. Fetch sessions with ready feedback for average score calculation by role
  const scoredSessionsPromise = prisma.session.findMany({
    where: {
      feedback: {
        status: 'ready',
      },
    },
    select: {
      role: true,
      feedback: {
        select: {
          scores: true,
        },
      },
    },
  });

  const [totalUsers, sessionsInWindow, readyCount, failedCount, scoredSessions] = await Promise.all([
    totalUsersPromise,
    sessionsInWindowPromise,
    feedbackReadyPromise,
    feedbackFailedPromise,
    scoredSessionsPromise,
  ]);

  // Aggregate interviews by day in the 14-day window
  for (const session of sessionsInWindow) {
    const dayKey = session.startedAt.toISOString().slice(0, 10);
    if (dailyMap.has(dayKey)) {
      dailyMap.set(dayKey, (dailyMap.get(dayKey) ?? 0) + 1);
    }
  }

  const interviewsPast14Days = Array.from(dailyMap.entries()).map(([date, count]) => ({
    date,
    count,
  }));

  // Aggregate scores by role
  const roleScoresMap = new Map<string, number[]>();
  for (const s of scoredSessions) {
    if (!s.role) continue;
    const score = computeOverallScore(s.feedback?.scores);
    if (score !== null) {
      const list = roleScoresMap.get(s.role) ?? [];
      list.push(score);
      roleScoresMap.set(s.role, list);
    }
  }

  // Include all standard roles plus any extra roles found in database
  const rolesSeen = new Set<string>(ROLES.map((r) => r.id));
  for (const roleKey of roleScoresMap.keys()) {
    rolesSeen.add(roleKey);
  }

  const averageScoresByRole = Array.from(rolesSeen).map((roleId) => {
    const canonical = ROLES.find((r) => r.id === roleId);
    const roleLabel = canonical?.label || formatRoleFallback(roleId);
    const scores = roleScoresMap.get(roleId) ?? [];
    const sessionCount = scores.length;
    let averageScore: number | null = null;
    if (sessionCount > 0) {
      const sum = scores.reduce((acc, curr) => acc + curr, 0);
      averageScore = Math.round((sum / sessionCount) * 10) / 10;
    }
    return {
      role: roleId,
      roleLabel,
      averageScore,
      sessionCount,
    };
  });

  const stats: AdminStats = {
    totalUsers,
    interviewsPast14Days,
    feedbackCounts: {
      ready: readyCount,
      failed: failedCount,
    },
    averageScoresByRole,
  };

  return AdminStats.parse(stats);
}
