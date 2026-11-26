import { createClient, type User, type UserIdentity } from '@supabase/supabase-js';
import type { Job } from '../generated/prisma/client';
import prisma from '../db';
import { JOB_TYPES } from './job-types';

export const GITHUB_API_BASE_URL = 'https://api.github.com';
export const DEFAULT_MAX_CONTRIBUTIONS = 30;

// Structured contribution representation (FR-10, VM-12)
export interface GitHubContribution {
  repoName: string;
  repoUrl: string;
  repoStars: number;
  title: string;
  prNumber: number;
  prUrl: string;
  merged: boolean;
  additions: number;
  deletions: number;
  filesChanged: number;
}

export class SupabaseAdminApiError extends Error {
  public readonly status: number;

  constructor(message: string, status = 503) {
    super(message);
    this.name = 'SupabaseAdminApiError';
    this.status = status;
  }
}

export class GitHubTokenMissingError extends Error {
  public readonly status = 401;

  constructor(message = 'GITHUB_TOKEN environment variable is not configured') {
    super(message);
    this.name = 'GitHubTokenMissingError';
  }
}

export class GitHubAuthError extends Error {
  public readonly status = 401;

  constructor(message = 'GitHub authentication failed. Please check GITHUB_TOKEN.') {
    super(message);
    this.name = 'GitHubAuthError';
  }
}

export class GitHubUserNotFoundError extends Error {
  public readonly status = 404;

  constructor(message = 'GitHub user not found or invalid.') {
    super(message);
    this.name = 'GitHubUserNotFoundError';
  }
}

export class GitHubRateLimitError extends Error {
  public readonly status = 429;
  public readonly resetAt?: Date;

  constructor(message = 'GitHub API rate limit exceeded', resetAt?: Date) {
    super(message);
    this.name = 'GitHubRateLimitError';
    this.resetAt = resetAt;
  }
}

export class GitHubApiError extends Error {
  public readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'GitHubApiError';
    this.status = status;
  }
}

export interface AnalyzeContributionsOptions {
  token?: string;
  fetchFn?: typeof fetch;
  maxContributions?: number;
}

/**
 * Safely parses GitHub rate-limit headers (X-RateLimit-Reset and Retry-After).
 * Prefers a valid future X-RateLimit-Reset (epoch seconds).
 * If absent, non-numeric, or not in the future, falls back to Retry-After (seconds or HTTP-date).
 * Returns undefined if neither produces a valid future Date.
 */
export function parseRateLimitHeaders(
  resetHeader: string | null | undefined,
  retryAfter: string | null | undefined,
  nowMs: number = Date.now()
): Date | undefined {
  if (resetHeader) {
    const resetEpochSec = Number(resetHeader);
    if (Number.isFinite(resetEpochSec) && resetEpochSec > 0) {
      const candidateMs = resetEpochSec * 1000;
      if (candidateMs > nowMs) {
        return new Date(candidateMs);
      }
    }
  }

  if (retryAfter) {
    const delaySec = Number(retryAfter);
    if (Number.isFinite(delaySec) && delaySec > 0) {
      const candidateMs = nowMs + delaySec * 1000;
      if (candidateMs > nowMs) {
        return new Date(candidateMs);
      }
    } else {
      const parsedEpoch = Date.parse(retryAfter);
      if (Number.isFinite(parsedEpoch) && parsedEpoch > nowMs) {
        return new Date(parsedEpoch);
      }
    }
  }

  return undefined;
}

/**
 * Handles error responses from GitHub REST API, converting rate limits (403/429)
 * into a typed GitHubRateLimitError with status 429 so the job worker recognizes it as transient.
 */
export async function handleGitHubErrorResponse(res: Response, contextMsg: string): Promise<never> {
  const status = res.status;
  const remaining = res.headers.get('x-ratelimit-remaining');
  const resetHeader = res.headers.get('x-ratelimit-reset');
  const retryAfter = res.headers.get('retry-after');

  let bodyText = '';
  try {
    bodyText = await res.text();
  } catch {
    // body read failure ignored
  }

  const isRateLimit =
    status === 429 ||
    (status === 403 && (remaining === '0' || bodyText.toLowerCase().includes('rate limit')));

  if (isRateLimit) {
    const resetAt = parseRateLimitHeaders(resetHeader, retryAfter);
    throw new GitHubRateLimitError(`GitHub API rate limit exceeded: ${contextMsg}`, resetAt);
  }

  if (status === 401) {
    throw new GitHubAuthError(`GitHub authentication failed: ${contextMsg}`);
  }

  if (status === 404) {
    throw new GitHubUserNotFoundError(`GitHub resource or user not found: ${contextMsg}`);
  }

  throw new GitHubApiError(`GitHub API error (${status}): ${contextMsg} - ${bodyText.slice(0, 200)}`, status);
}

/**
 * Fetches public pull requests authored by the candidate in repositories outside their own ownership,
 * gathering repository stars, merged status, additions, deletions, and changed files.
 */
export async function analyzeUserContributions(
  login: string,
  options: AnalyzeContributionsOptions = {}
): Promise<GitHubContribution[]> {
  const cleanLogin = login?.trim();
  if (!cleanLogin) {
    throw new GitHubUserNotFoundError('GitHub login is required and cannot be empty');
  }

  const token = options.token ?? process.env.GITHUB_TOKEN?.trim();
  if (!token) {
    throw new GitHubTokenMissingError();
  }

  const fetchFn = options.fetchFn ?? fetch;
  const maxContributions = options.maxContributions ?? DEFAULT_MAX_CONTRIBUTIONS;

  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'AI-Interviewer-App',
  };

  // Required GitHub search query structure:
  // type:pr author:<login> -user:<login> is:public
  const searchQuery = `type:pr author:${cleanLogin} -user:${cleanLogin} is:public`;
  const searchUrl = `${GITHUB_API_BASE_URL}/search/issues?q=${encodeURIComponent(searchQuery)}&per_page=${maxContributions}`;

  const searchRes = await fetchFn(searchUrl, { headers });
  if (!searchRes.ok) {
    await handleGitHubErrorResponse(searchRes, `Failed searching public PRs for user ${cleanLogin}`);
  }

  const searchData = (await searchRes.json()) as { items?: any[]; total_count?: number };
  const items = searchData.items || [];

  if (items.length === 0) {
    return [];
  }

  const repoCache = new Map<string, { repoName: string; repoUrl: string; stars: number }>();
  const contributions: GitHubContribution[] = [];

  for (const item of items.slice(0, maxContributions)) {
    const prApiUrl: string | undefined = item.pull_request?.url;
    if (!prApiUrl) {
      continue;
    }

    // Determine repository full name
    let repoFullName = '';
    if (typeof item.repository_url === 'string') {
      repoFullName = item.repository_url.replace(/^https:\/\/api\.github\.com\/repos\//, '');
    } else {
      const match = prApiUrl.match(/repos\/([^/]+\/[^/]+)\/pulls/);
      if (match) {
        repoFullName = match[1];
      }
    }

    if (!repoFullName) {
      continue;
    }

    // Fetch repository details (cached per repository to avoid duplicate calls)
    let repoInfo = repoCache.get(repoFullName);
    if (!repoInfo) {
      const repoRes = await fetchFn(`${GITHUB_API_BASE_URL}/repos/${repoFullName}`, { headers });
      if (!repoRes.ok) {
        if (repoRes.status === 404 || repoRes.status === 410 || repoRes.status === 451) {
          // Repository is no longer accessible
          continue;
        }
        await handleGitHubErrorResponse(repoRes, `Failed fetching repository ${repoFullName}`);
      }
      const repoData = (await repoRes.json()) as any;
      repoInfo = {
        repoName: repoData.full_name || repoFullName,
        repoUrl: repoData.html_url || `https://github.com/${repoFullName}`,
        stars: typeof repoData.stargazers_count === 'number' ? repoData.stargazers_count : 0,
      };
      repoCache.set(repoFullName, repoInfo);
    }

    // Fetch individual pull request statistics
    const prRes = await fetchFn(prApiUrl, { headers });
    if (!prRes.ok) {
      if (prRes.status === 404 || prRes.status === 410 || prRes.status === 451) {
        // PR is no longer accessible
        continue;
      }
      await handleGitHubErrorResponse(prRes, `Failed fetching PR details for ${prApiUrl}`);
    }
    const prData = (await prRes.json()) as any;

    // Determine files changed: check changed_files field, or fetch pull request files endpoint when needed
    let filesChanged = typeof prData.changed_files === 'number' ? prData.changed_files : 0;
    if (prData.changed_files === undefined || prData.changed_files === null) {
      const filesRes = await fetchFn(`${prApiUrl}/files?per_page=100`, { headers });
      if (!filesRes.ok) {
        if (filesRes.status === 404 || filesRes.status === 410 || filesRes.status === 451) {
          // PR or files endpoint no longer accessible; keep filesChanged as 0
        } else {
          await handleGitHubErrorResponse(filesRes, `Failed fetching PR files for ${prApiUrl}`);
        }
      } else {
        const filesData = (await filesRes.json()) as any[];
        if (Array.isArray(filesData)) {
          filesChanged = filesData.length;
        }
      }
    }

    contributions.push({
      repoName: repoInfo.repoName,
      repoUrl: repoInfo.repoUrl,
      repoStars: repoInfo.stars,
      title: prData.title || item.title || '',
      prNumber: typeof prData.number === 'number' ? prData.number : item.number,
      prUrl: prData.html_url || item.html_url || `https://github.com/${repoFullName}/pull/${item.number}`,
      merged: Boolean(prData.merged || prData.merged_at),
      additions: typeof prData.additions === 'number' ? prData.additions : 0,
      deletions: typeof prData.deletions === 'number' ? prData.deletions : 0,
      filesChanged,
    });
  }

  return contributions;
}

/**
 * Worker handler for `github.analyze` jobs.
 * Runs in background, revalidates linked identity with Supabase Auth, fetches public contributions,
 * and upserts user's GithubProfile.
 * Only updates `fetchedAt` upon successful analysis.
 */
export async function handleGithubAnalyze(
  job: Job,
  options?: AnalyzeContributionsOptions
): Promise<void> {
  const payload = job.payload as { userId?: string; login?: string };
  const userId = payload?.userId;
  const login = payload?.login;

  if (!userId || !login) {
    throw new Error(`Invalid github.analyze job payload: missing userId or login (job ${job.id})`);
  }

  // 1. Resolve candidate from database
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { supabaseUserId: true },
  });

  if (!user || !user.supabaseUserId) {
    console.warn(`[github.analyze] User ${userId} no longer exists or has no supabaseUserId. Skipping job ${job.id}.`);
    return;
  }

  // 2. Re-validate currently linked GitHub identity from Supabase Auth admin API.
  // Any transient network or 5xx Supabase error throws SupabaseAdminApiError to trigger a queue retry.
  const currentLogin = await getVerifiedGitHubLoginForUser(user.supabaseUserId);

  if (!currentLogin) {
    console.warn(`[github.analyze] User ${userId} has unlinked their GitHub account. Skipping job ${job.id}.`);
    return; // Legitimately unlinked: complete cleanly without retrying permanently invalid job
  }

  if (currentLogin.trim().toLowerCase() !== login.trim().toLowerCase()) {
    console.warn(
      `[github.analyze] User ${userId} linked GitHub login changed from "${login}" to "${currentLogin}". Skipping stale job ${job.id}.`
    );
    return; // Changed identity: complete cleanly without persisting stale contribution data
  }

  // 3. Identity confirmed: fetch public contributions
  const contributions = await analyzeUserContributions(login, options);

  // 4. Re-verify identity immediately before persistence to reduce the in-flight race window.
  // If candidate unlinked or changed their account while analysis was running, do not persist.
  // Any transient Supabase error throws SupabaseAdminApiError to let the queue worker retry.
  const postAnalysisLogin = await getVerifiedGitHubLoginForUser(user.supabaseUserId);

  if (!postAnalysisLogin) {
    console.warn(
      `[github.analyze] User ${userId} unlinked GitHub account while analysis was in flight. Skipping persistence for job ${job.id}.`
    );
    return;
  }

  if (postAnalysisLogin.trim().toLowerCase() !== login.trim().toLowerCase()) {
    console.warn(
      `[github.analyze] User ${userId} GitHub login changed from "${login}" to "${postAnalysisLogin}" while analysis was in flight. Skipping persistence for job ${job.id}.`
    );
    return;
  }

  // 5. Coordinate final persistence with the local Prisma user record inside a transaction.
  // Protects against concurrent account deletion (DELETE /api/auth/account) to ensure we don't
  // leave a stale profile or fail the worker with a foreign key constraint violation.
  try {
    await prisma.$transaction(async (tx) => {
      // Coordinate with local Prisma user record: verify and lock the user row (FOR UPDATE)
      // to synchronize with any concurrent account deletion transaction.
      const userRows = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM users WHERE id = ${userId} FOR UPDATE
      `;

      if (!userRows || userRows.length === 0) {
        console.warn(
          `[github.analyze] User ${userId} was deleted before persistence. Skipping job ${job.id}.`
        );
        return;
      }

      const profileLogin = postAnalysisLogin ?? login;
      await tx.githubProfile.upsert({
        where: { userId },
        create: {
          userId,
          login: profileLogin,
          fetchedAt: new Date(),
          contributions: contributions as any,
        },
        update: {
          login: profileLogin,
          fetchedAt: new Date(),
          contributions: contributions as any,
        },
      });
    });
  } catch (err: any) {
    // If concurrent deletion occurred and triggered a foreign key constraint violation (P2003)
    // or record-not-found (P2025), verify whether the application user actually no longer exists.
    if (err?.code === 'P2003' || err?.code === 'P2025') {
      const userExists = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true },
      });

      if (!userExists) {
        console.warn(
          `[github.analyze] User ${userId} was concurrently deleted during persistence (${err.code}). Skipping job ${job.id}.`
        );
        return;
      }
    }
    throw err;
  }
}

export interface UserIdentityLike {
  id?: string;
  identity_id?: string;
  provider?: string;
  identity_data?: Record<string, any> | null;
  [key: string]: any;
}

export interface UserWithIdentitiesLike {
  identities?: (UserIdentity | UserIdentityLike)[] | null;
  [key: string]: any;
}

/**
 * Extracts verified GitHub login strictly from a user's verified linked OAuth identity.
 * Never derives from display name or user-editable metadata.
 */
export function extractVerifiedGitHubLogin(
  user: User | UserWithIdentitiesLike | null | undefined
): string | null {
  if (!user || typeof user !== 'object') return null;
  const identities = (user as any).identities;
  if (!Array.isArray(identities)) return null;

  const ghIdentity = identities.find(
    (id: any) => Boolean(id && typeof id === 'object' && id.provider === 'github')
  );
  if (!ghIdentity || typeof ghIdentity !== 'object') return null;

  const data = ghIdentity.identity_data;
  if (!data || typeof data !== 'object') return null;

  // Supabase Auth maps GitHub login to `user_name` (default) or `preferred_username` (OIDC standard)
  const candidates = [data.user_name, data.preferred_username, data.login];
  for (const candidate of candidates) {
    if (typeof candidate === 'string') {
      const trimmed = candidate.trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
    }
  }

  return null;
}

let supabaseAdminClient: ReturnType<typeof createClient> | null = null;

export function getSupabaseAdminClient(): ReturnType<typeof createClient> | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  if (!supabaseAdminClient) {
    supabaseAdminClient = createClient(url, key);
  }
  return supabaseAdminClient;
}

/**
 * Queries Supabase Auth admin API to obtain the verified linked GitHub login for a user.
 * Returns null if the user has no linked GitHub identity or the user is not found.
 * Throws SupabaseAdminApiError on API, network, or server failures so the worker can retry transiently.
 */
export async function getVerifiedGitHubLoginForUser(
  supabaseUserId: string
): Promise<string | null> {
  if (!supabaseUserId || typeof supabaseUserId !== 'string' || supabaseUserId.trim().length === 0) {
    return null;
  }

  const client = getSupabaseAdminClient();
  if (!client) {
    throw new SupabaseAdminApiError(
      'Supabase admin client is not configured (missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY)',
      503
    );
  }

  let result: Awaited<ReturnType<typeof client.auth.admin.getUserById>>;
  try {
    result = await client.auth.admin.getUserById(supabaseUserId);
  } catch (err: unknown) {
    if (err instanceof SupabaseAdminApiError) {
      throw err;
    }
    const message = err instanceof Error ? err.message : String(err);
    const status = (err as any)?.status ?? (err as any)?.statusCode ?? 503;
    throw new SupabaseAdminApiError(`Supabase admin API connection failed: ${message}`, status);
  }

  const { data, error } = result;

  if (error) {
    const status = (error as any)?.status;
    if (status === 404 || error.name === 'AuthNotFoundError') {
      return null;
    }
    throw new SupabaseAdminApiError(`Supabase admin API error: ${error.message}`, status ?? 503);
  }

  if (!data?.user) {
    return null;
  }

  return extractVerifiedGitHubLogin(data.user);
}

/**
 * 24 hours in milliseconds for GitHub analysis daily refresh protection (FR-10, VM-12).
 */
export const DAILY_GITHUB_REFRESH_MS = 24 * 60 * 60 * 1000;

export function isEligibleForDailyGithubRefresh(
  fetchedAt?: Date | string | null,
  now: Date = new Date()
): boolean {
  if (!fetchedAt) return true;
  const fetchedTime = fetchedAt instanceof Date ? fetchedAt.getTime() : new Date(fetchedAt).getTime();
  if (isNaN(fetchedTime)) return true;
  return now.getTime() - fetchedTime >= DAILY_GITHUB_REFRESH_MS;
}

/**
 * Enqueues a `github.analyze` job with daily refresh protection and concurrency control.
 *
 * 1. Checks if the user already has a GithubProfile fetched < 24h ago; if so, skips.
 * 2. Checks if there is already a pending or processing `github.analyze` job for this user; if so, skips.
 * 3. Uses a PostgreSQL advisory lock on userId to prevent concurrent requests from bypassing the check.
 */
export async function maybeEnqueueGithubAnalysis(
  userId: string,
  login: string,
  now: Date = new Date()
): Promise<{ queued: boolean; reason?: string; job?: Job }> {
  if (!login || typeof login !== 'string' || login.trim().length === 0) {
    return { queued: false, reason: 'invalid_login' };
  }

  const cleanLogin = login.trim();
  const normalizedLogin = cleanLogin.toLowerCase();

  return prisma.$transaction(async (tx) => {
    // PostgreSQL advisory transaction lock on userId to serialize concurrent requests for the same user
    await tx.$queryRaw`
      SELECT 1::int AS locked
      FROM (
        SELECT pg_advisory_xact_lock(195, hashtext(${userId}))
      ) AS advisory_lock
    `;

    // 1. Check existing GithubProfile
    const profile = await tx.githubProfile.findUnique({
      where: { userId },
      select: { fetchedAt: true, login: true },
    });

    const isSameLogin = profile?.login ? profile.login.trim().toLowerCase() === normalizedLogin : false;
    if (isSameLogin && profile?.fetchedAt && !isEligibleForDailyGithubRefresh(profile.fetchedAt, now)) {
      return { queued: false, reason: 'recently_fetched' };
    }

    // 2. Prevent duplicate pending or processing jobs for the same user and same GitHub login
    const existingJob = await tx.job.findFirst({
      where: {
        type: JOB_TYPES.GITHUB_ANALYZE,
        status: { in: ['pending', 'processing'] },
        AND: [
          {
            payload: {
              path: ['userId'],
              equals: userId,
            },
          },
          {
            payload: {
              path: ['login'],
              equals: normalizedLogin,
            },
          },
        ],
      },
    });

    if (existingJob) {
      return { queued: false, reason: 'already_queued', job: existingJob };
    }

    // 3. Enqueue the analysis job
    const job = await tx.job.create({
      data: {
        type: JOB_TYPES.GITHUB_ANALYZE,
        payload: { userId, login: normalizedLogin },
      },
    });

    return { queued: true, job };
  });
}

/**
 * Triggers GitHub analysis only if the user has a verified linked GitHub OAuth account.
 * Rejects unlinked accounts and respects daily refresh limits.
 */
export async function triggerGithubAnalysisIfLinked(
  userId: string,
  supabaseUserId?: string | null,
  now: Date = new Date()
): Promise<{ queued: boolean; reason?: string; job?: Job }> {
  let targetSupabaseId = supabaseUserId;
  if (!targetSupabaseId) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { supabaseUserId: true },
    });
    targetSupabaseId = user?.supabaseUserId ?? null;
  }

  if (!targetSupabaseId) {
    return { queued: false, reason: 'no_github_linked' };
  }

  const login = await getVerifiedGitHubLoginForUser(targetSupabaseId);
  if (!login) {
    return { queued: false, reason: 'no_github_linked' };
  }

  return maybeEnqueueGithubAnalysis(userId, login, now);
}
