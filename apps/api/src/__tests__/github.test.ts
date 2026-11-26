import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import prisma from '../db';
import {
  analyzeUserContributions,
  handleGithubAnalyze,
  extractVerifiedGitHubLogin,
  getVerifiedGitHubLoginForUser,
  GitHubTokenMissingError,
  GitHubAuthError,
  GitHubUserNotFoundError,
  GitHubRateLimitError,
  GitHubApiError,
  SupabaseAdminApiError,
  DEFAULT_MAX_CONTRIBUTIONS,
  type GitHubContribution,
  parseRateLimitHeaders,
  handleGitHubErrorResponse,
  DAILY_GITHUB_REFRESH_MS,
  isEligibleForDailyGithubRefresh,
  maybeEnqueueGithubAnalysis,
  triggerGithubAnalysisIfLinked,
} from '../services/github.service';
import { JOB_TYPES } from '../services/job-types';
import {
  processNextJob,
  isTransientError,
  MAX_ATTEMPTS,
  calculateRateLimitRetryAt,
  isRateLimitError,
} from '../services/job-queue.service';
import { handleJob } from '../worker';
import request from 'supertest';
import app from '../server';
import { createAuthMiddleware } from '../middleware/auth';

const {
  mockGetUser,
  mockGetUserById,
  mockTxJobCreate,
  mockTxJobFindFirst,
  mockTxJobFindMany,
  mockTxGithubProfileFindUnique,
} = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockGetUserById: vi.fn(),
  mockTxJobCreate: vi.fn().mockResolvedValue({ id: 'job-1', type: 'github.analyze' }),
  mockTxJobFindFirst: vi.fn().mockResolvedValue(null),
  mockTxJobFindMany: vi.fn().mockResolvedValue([]),
  mockTxGithubProfileFindUnique: vi.fn().mockResolvedValue(null),
}));

vi.mock('../db', () => ({
  default: {
    user: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
    },
    githubProfile: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      deleteMany: vi.fn(),
    },
    job: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
    },
    $transaction: vi.fn(async (cb: (tx: any) => Promise<any>) => {
      const mockTx = {
        $queryRaw: vi.fn().mockResolvedValue([{ locked: 1, id: 'mock-user' }]),
        user: {
          findUnique: vi.fn().mockResolvedValue({ id: 'mock-user' }),
        },
        githubProfile: {
          findUnique: mockTxGithubProfileFindUnique,
          upsert: vi.fn((...args: any[]) => (prisma.githubProfile.upsert as any)(...args)),
        },
        job: {
          findFirst: mockTxJobFindFirst,
          findMany: mockTxJobFindMany,
          create: mockTxJobCreate,
        },
      };
      return cb(mockTx);
    }),
  },
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    auth: {
      getUser: mockGetUser,
      admin: {
        getUserById: mockGetUserById,
      },
    },
  })),
}));

describe('VM-12 / FR-10 — GitHub Public Contributions Analysis', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GITHUB_TOKEN = 'test-mock-token-xyz';
    process.env.SUPABASE_URL = 'https://mock.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'mock-service-role-key';
    mockTxJobCreate.mockResolvedValue({ id: 'job-1', type: 'github.analyze' });
    mockTxJobFindFirst.mockResolvedValue(null);
    mockTxJobFindMany.mockResolvedValue([]);
    mockTxGithubProfileFindUnique.mockResolvedValue(null);

    (prisma.user.findUnique as any).mockImplementation(async (args: any) => {
      const id = args?.where?.id;
      const supaId = args?.where?.supabaseUserId;
      return {
        id: id || 'u-default',
        supabaseUserId: supaId || `supa-${id || 'default'}`,
        email: 'dev@example.com',
        name: 'Developer',
      } as any;
    });

    mockGetUserById.mockImplementation(async (userId: string) => {
      let login = 'octocat';
      if (typeof userId === 'string') {
        if (userId.includes('dispatch')) login = 'octocat-dispatch';
        else if (userId.includes('456') || userId.includes('pro-coder')) login = 'pro-coder';
        else if (userId.includes('fail') || userId.includes('bad-request')) login = 'bad-request';
      }
      return {
        data: {
          user: {
            id: userId,
            identities: [
              {
                provider: 'github',
                identity_data: { user_name: login },
              },
            ],
          },
        },
        error: null,
      };
    });
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('1. GitHub Service (REST API & Contribution Data Extraction)', () => {
    it('successfully retrieves public PRs from repositories outside the candidate ownership', async () => {
      const mockFetch = vi.fn();

      // Search endpoint returns 2 PRs
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          total_count: 2,
          items: [
            {
              number: 101,
              title: 'Fix race condition in connection pool',
              repository_url: 'https://api.github.com/repos/facebook/react',
              pull_request: {
                url: 'https://api.github.com/repos/facebook/react/pulls/101',
              },
            },
            {
              number: 202,
              title: 'Improve memory footprint in kernel scheduler',
              repository_url: 'https://api.github.com/repos/torvalds/linux',
              pull_request: {
                url: 'https://api.github.com/repos/torvalds/linux/pulls/202',
              },
            },
          ],
        }),
      });

      // facebook/react repo lookup
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          full_name: 'facebook/react',
          html_url: 'https://github.com/facebook/react',
          stargazers_count: 220000,
        }),
      });

      // PR 101 details (merged: true)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          number: 101,
          title: 'Fix race condition in connection pool',
          html_url: 'https://github.com/facebook/react/pull/101',
          merged: true,
          merged_at: '2026-03-01T12:00:00Z',
          additions: 150,
          deletions: 45,
          changed_files: 4,
        }),
      });

      // torvalds/linux repo lookup
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          full_name: 'torvalds/linux',
          html_url: 'https://github.com/torvalds/linux',
          stargazers_count: 180000,
        }),
      });

      // PR 202 details (unmerged: false)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          number: 202,
          title: 'Improve memory footprint in kernel scheduler',
          html_url: 'https://github.com/torvalds/linux/pull/202',
          merged: false,
          merged_at: null,
          additions: 300,
          deletions: 120,
          changed_files: 8,
        }),
      });

      const results = await analyzeUserContributions('vismay-solanki', { fetchFn: mockFetch });

      expect(results).toHaveLength(2);
      expect(results[0]).toEqual({
        repoName: 'facebook/react',
        repoUrl: 'https://github.com/facebook/react',
        repoStars: 220000,
        title: 'Fix race condition in connection pool',
        prNumber: 101,
        prUrl: 'https://github.com/facebook/react/pull/101',
        merged: true,
        additions: 150,
        deletions: 45,
        filesChanged: 4,
      });

      expect(results[1]).toEqual({
        repoName: 'torvalds/linux',
        repoUrl: 'https://github.com/torvalds/linux',
        repoStars: 180000,
        title: 'Improve memory footprint in kernel scheduler',
        prNumber: 202,
        prUrl: 'https://github.com/torvalds/linux/pull/202',
        merged: false,
        additions: 300,
        deletions: 120,
        filesChanged: 8,
      });
    });

    it('uses the exact expected GitHub search query with url encoding and headers', async () => {
      const mockFetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ items: [] }),
      });

      await analyzeUserContributions('octocat', { fetchFn: mockFetch });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];

      // Exact query structure: type:pr author:<login> -user:<login> is:public
      const expectedQuery = encodeURIComponent('type:pr author:octocat -user:octocat is:public');
      expect(url).toBe(`https://api.github.com/search/issues?q=${expectedQuery}&per_page=${DEFAULT_MAX_CONTRIBUTIONS}`);

      expect(options.headers).toEqual({
        Accept: 'application/vnd.github+json',
        Authorization: 'Bearer test-mock-token-xyz',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'AI-Interviewer-App',
      });
    });

    it('handles multiple PRs in the same repository without duplicate repository lookups (caching)', async () => {
      const mockFetch = vi.fn();

      // Search returns 2 PRs in the same repo "vercel/next.js"
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          items: [
            {
              number: 1,
              title: 'PR One',
              repository_url: 'https://api.github.com/repos/vercel/next.js',
              pull_request: { url: 'https://api.github.com/repos/vercel/next.js/pulls/1' },
            },
            {
              number: 2,
              title: 'PR Two',
              repository_url: 'https://api.github.com/repos/vercel/next.js',
              pull_request: { url: 'https://api.github.com/repos/vercel/next.js/pulls/2' },
            },
          ],
        }),
      });

      // Repository lookup
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          full_name: 'vercel/next.js',
          html_url: 'https://github.com/vercel/next.js',
          stargazers_count: 125000,
        }),
      });

      // PR 1
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          number: 1,
          title: 'PR One',
          html_url: 'https://github.com/vercel/next.js/pull/1',
          merged: true,
          additions: 10,
          deletions: 5,
          changed_files: 2,
        }),
      });

      // PR 2
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          number: 2,
          title: 'PR Two',
          html_url: 'https://github.com/vercel/next.js/pull/2',
          merged: false,
          additions: 20,
          deletions: 2,
          changed_files: 1,
        }),
      });

      const results = await analyzeUserContributions('contributor-1', { fetchFn: mockFetch });

      expect(results).toHaveLength(2);
      // Verify repository was fetched only ONCE despite two PRs
      const repoCalls = mockFetch.mock.calls.filter((c) => c[0] === 'https://api.github.com/repos/vercel/next.js');
      expect(repoCalls).toHaveLength(1);
    });

    it('fetches changed files from the PR files endpoint when changed_files is missing on PR response', async () => {
      const mockFetch = vi.fn();

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          items: [
            {
              number: 55,
              repository_url: 'https://api.github.com/repos/owner/repo',
              pull_request: { url: 'https://api.github.com/repos/owner/repo/pulls/55' },
            },
          ],
        }),
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          full_name: 'owner/repo',
          html_url: 'https://github.com/owner/repo',
          stargazers_count: 99,
        }),
      });

      // PR without changed_files field
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          number: 55,
          title: 'Files fallback test',
          html_url: 'https://github.com/owner/repo/pull/55',
          merged: true,
          additions: 12,
          deletions: 4,
          changed_files: undefined,
        }),
      });

      // Pull request files endpoint returns 3 file entries
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [{ filename: 'a.ts' }, { filename: 'b.ts' }, { filename: 'c.ts' }],
      });

      const results = await analyzeUserContributions('author-x', { fetchFn: mockFetch });
      expect(results).toHaveLength(1);
      expect(results[0]?.filesChanged).toBe(3);
    });

    it('respects maxContributions limit', async () => {
      const mockFetch = vi.fn();

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          items: [
            { number: 1, repository_url: 'https://api.github.com/repos/a/1', pull_request: { url: 'https://api.github.com/repos/a/1/pulls/1' } },
            { number: 2, repository_url: 'https://api.github.com/repos/a/2', pull_request: { url: 'https://api.github.com/repos/a/2/pulls/2' } },
            { number: 3, repository_url: 'https://api.github.com/repos/a/3', pull_request: { url: 'https://api.github.com/repos/a/3/pulls/3' } },
          ],
        }),
      });

      // Only 2 PRs should be processed when maxContributions = 2
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          full_name: 'a/repo',
          stargazers_count: 10,
          number: 1,
          merged: true,
          additions: 1,
          deletions: 1,
          changed_files: 1,
        }),
      });

      const results = await analyzeUserContributions('author-y', { fetchFn: mockFetch, maxContributions: 2 });
      expect(results).toHaveLength(2);
    });

    it('handles user with zero matching public contributions and returns an empty array', async () => {
      const mockFetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ total_count: 0, items: [] }),
      });

      const results = await analyzeUserContributions('newbie-coder', { fetchFn: mockFetch });
      expect(results).toEqual([]);
    });

    it('handles rate-limit responses (HTTP 403 with x-ratelimit-remaining: 0 and HTTP 429)', async () => {
      // Test 1: HTTP 403 with rate limit header
      const mockFetch403 = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 403,
        headers: new Headers({
          'x-ratelimit-remaining': '0',
          'x-ratelimit-reset': '1800000000',
        }),
        text: async () => 'API rate limit exceeded',
      });

      let err403: any;
      try {
        await analyzeUserContributions('busy-dev', { fetchFn: mockFetch403 });
      } catch (err) {
        err403 = err;
      }
      expect(err403).toBeInstanceOf(GitHubRateLimitError);
      expect(err403.status).toBe(429);
      expect(err403.resetAt).toBeInstanceOf(Date);

      // Test 2: HTTP 429 secondary rate limit
      const mockFetch429 = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: new Headers({ 'retry-after': '120' }),
        text: async () => 'Secondary rate limit triggered',
      });

      let err429: any;
      try {
        await analyzeUserContributions('busy-dev', { fetchFn: mockFetch429 });
      } catch (err) {
        err429 = err;
      }
      expect(err429).toBeInstanceOf(GitHubRateLimitError);
      expect(err429.status).toBe(429);
    });

    it('handles missing GITHUB_TOKEN by throwing GitHubTokenMissingError', async () => {
      delete process.env.GITHUB_TOKEN;
      await expect(analyzeUserContributions('dev-no-token')).rejects.toThrowError(GitHubTokenMissingError);
    });

    it('handles network failures and HTTP 500 error responses without masking as empty array', async () => {
      const mockNetworkFail = vi.fn().mockRejectedValueOnce(new Error('connect ECONNRESET'));
      await expect(
        analyzeUserContributions('test-dev', { fetchFn: mockNetworkFail })
      ).rejects.toThrow('connect ECONNRESET');

      const mockHttp500 = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 500,
        headers: new Headers(),
        text: async () => 'Internal Server Error',
      });
      await expect(
        analyzeUserContributions('test-dev', { fetchFn: mockHttp500 })
      ).rejects.toThrowError(GitHubApiError);
    });

    it('propagates GitHubRateLimitError, GitHubApiError, and network errors when fetching PR details', async () => {
      const mockFetch = vi.fn();

      // Search returns 1 PR
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          items: [
            {
              number: 10,
              repository_url: 'https://api.github.com/repos/org/repo',
              pull_request: { url: 'https://api.github.com/repos/org/repo/pulls/10' },
            },
          ],
        }),
      });

      // Repo lookup returns 200
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          full_name: 'org/repo',
          html_url: 'https://github.com/org/repo',
          stargazers_count: 100,
        }),
      });

      // PR details returns 500 Server Error
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        headers: new Headers(),
        text: async () => 'Internal Server Error',
      });

      await expect(
        analyzeUserContributions('dev-err', { fetchFn: mockFetch })
      ).rejects.toThrowError(GitHubApiError);
    });

    it('propagates errors when PR files endpoint fallback fails with rate limit (429)', async () => {
      const mockFetch = vi.fn();

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          items: [
            {
              number: 20,
              repository_url: 'https://api.github.com/repos/org/repo',
              pull_request: { url: 'https://api.github.com/repos/org/repo/pulls/20' },
            },
          ],
        }),
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          full_name: 'org/repo',
          html_url: 'https://github.com/org/repo',
          stargazers_count: 100,
        }),
      });

      // PR details without changed_files
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          number: 20,
          title: 'PR without changed_files',
          html_url: 'https://github.com/org/repo/pull/20',
          merged: true,
          additions: 5,
          deletions: 1,
          changed_files: null,
        }),
      });

      // Files endpoint returns 429
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: new Headers({ 'retry-after': '60' }),
        text: async () => 'Rate limit exceeded',
      });

      await expect(
        analyzeUserContributions('dev-files-err', { fetchFn: mockFetch })
      ).rejects.toThrowError(GitHubRateLimitError);
    });

    it('gracefully skips PRs or repositories that return 404/410/451 (deleted or private)', async () => {
      const mockFetch = vi.fn();

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          items: [
            {
              number: 1,
              repository_url: 'https://api.github.com/repos/deleted/repo',
              pull_request: { url: 'https://api.github.com/repos/deleted/repo/pulls/1' },
            },
            {
              number: 2,
              repository_url: 'https://api.github.com/repos/active/repo',
              pull_request: { url: 'https://api.github.com/repos/active/repo/pulls/2' },
            },
          ],
        }),
      });

      // deleted/repo lookup returns 404
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        headers: new Headers(),
        text: async () => 'Not Found',
      });

      // active/repo lookup returns 200
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          full_name: 'active/repo',
          html_url: 'https://github.com/active/repo',
          stargazers_count: 50,
        }),
      });

      // PR 2 details returns 200
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          number: 2,
          title: 'Surviving PR',
          html_url: 'https://github.com/active/repo/pull/2',
          merged: true,
          additions: 10,
          deletions: 2,
          changed_files: 1,
        }),
      });

      const results = await analyzeUserContributions('dev-mixed', { fetchFn: mockFetch });
      expect(results).toHaveLength(1);
      expect(results[0]?.title).toBe('Surviving PR');
    });
  });

  describe('2. Verified GitHub Identity Extraction', () => {
    it('extracts username from identity_data.user_name', () => {
      const user = {
        identities: [
          {
            provider: 'github',
            identity_data: { user_name: 'vismay-solanki' },
          },
        ],
      };
      expect(extractVerifiedGitHubLogin(user)).toBe('vismay-solanki');
    });

    it('falls back to identity_data.preferred_username and identity_data.login', () => {
      const user1 = {
        identities: [
          {
            provider: 'github',
            identity_data: { preferred_username: 'octocat' },
          },
        ],
      };
      expect(extractVerifiedGitHubLogin(user1)).toBe('octocat');

      const user2 = {
        identities: [
          {
            provider: 'github',
            identity_data: { login: 'octo-login' },
          },
        ],
      };
      expect(extractVerifiedGitHubLogin(user2)).toBe('octo-login');
    });

    it('trims whitespace and ignores non-github providers', () => {
      const user = {
        identities: [
          {
            provider: 'google',
            identity_data: { user_name: 'google-user', email: 'g@example.com' },
          },
          {
            provider: 'github',
            identity_data: { user_name: '  vismay-trimmed  ' },
          },
        ],
      };
      expect(extractVerifiedGitHubLogin(user)).toBe('vismay-trimmed');
    });

    it('returns null when user has no github identity or empty username', () => {
      expect(extractVerifiedGitHubLogin(null)).toBeNull();
      expect(extractVerifiedGitHubLogin({})).toBeNull();
      expect(extractVerifiedGitHubLogin({ identities: [] })).toBeNull();
      expect(extractVerifiedGitHubLogin({ identities: undefined })).toBeNull();
      expect(
        extractVerifiedGitHubLogin({
          identities: [{ provider: 'google', identity_data: { user_name: 'google' } }],
        })
      ).toBeNull();
      expect(
        extractVerifiedGitHubLogin({
          identities: [{ provider: 'azure', identity_data: { preferred_username: 'azure-user' } }],
        })
      ).toBeNull();
      expect(
        extractVerifiedGitHubLogin({
          identities: [{ provider: 'github', identity_data: { user_name: '   ' } }],
        })
      ).toBeNull();
      expect(
        extractVerifiedGitHubLogin({
          identities: [{ provider: 'github', identity_data: { name: 'Full Display Name Only' } }],
        })
      ).toBeNull();
      expect(
        extractVerifiedGitHubLogin({
          identities: [{ provider: 'github', identity_data: { full_name: 'Full Name' } }],
        })
      ).toBeNull();
    });

    it('rejects malformed identity entries and non-string candidate values', () => {
      expect(extractVerifiedGitHubLogin({ identities: ['string-item'] as any })).toBeNull();
      expect(extractVerifiedGitHubLogin({ identities: [null] as any })).toBeNull();
      expect(
        extractVerifiedGitHubLogin({
          identities: [{ provider: 'github', identity_data: null as any }],
        })
      ).toBeNull();
      expect(
        extractVerifiedGitHubLogin({
          identities: [{ provider: 'github', identity_data: { user_name: 12345 as any } }],
        })
      ).toBeNull();
      expect(
        extractVerifiedGitHubLogin({
          identities: [{ provider: 'github', identity_data: { user_name: {} as any } }],
        })
      ).toBeNull();
    });

    it('never inspects user-editable user_metadata', () => {
      const spoofedUser = {
        user_metadata: { user_name: 'malicious-spoof' },
        identities: [],
      };
      expect(extractVerifiedGitHubLogin(spoofedUser)).toBeNull();
    });

    it('getVerifiedGitHubLoginForUser returns verified login for linked candidate', async () => {
      mockGetUserById.mockResolvedValueOnce({
        data: {
          user: {
            id: 'supa-user-v',
            identities: [{ provider: 'github', identity_data: { user_name: 'octocat' } }],
          },
        },
        error: null,
      });

      const login = await getVerifiedGitHubLoginForUser('supa-user-v');
      expect(login).toBe('octocat');
    });

    it('getVerifiedGitHubLoginForUser returns null for unlinked or nonexistent user', async () => {
      expect(await getVerifiedGitHubLoginForUser('')).toBeNull();

      // 404 from Supabase auth
      mockGetUserById.mockResolvedValueOnce({
        data: null,
        error: { message: 'User not found', status: 404 },
      });
      expect(await getVerifiedGitHubLoginForUser('nonexistent')).toBeNull();

      // User exists but has no GitHub identity
      mockGetUserById.mockResolvedValueOnce({
        data: {
          user: {
            id: 'supa-no-gh',
            identities: [{ provider: 'google', identity_data: { email: 'g@test.com' } }],
          },
        },
        error: null,
      });
      expect(await getVerifiedGitHubLoginForUser('supa-no-gh')).toBeNull();
    });

    it('getVerifiedGitHubLoginForUser throws SupabaseAdminApiError on transient 5xx or network errors', async () => {
      mockGetUserById.mockResolvedValueOnce({
        data: null,
        error: { message: 'Service Unavailable', status: 503 },
      });

      await expect(getVerifiedGitHubLoginForUser('supa-err-503')).rejects.toThrowError(SupabaseAdminApiError);

      mockGetUserById.mockRejectedValueOnce(new Error('Fetch timeout to Supabase'));
      await expect(getVerifiedGitHubLoginForUser('supa-net-err')).rejects.toThrowError(SupabaseAdminApiError);
    });

    it('getVerifiedGitHubLoginForUser throws SupabaseAdminApiError when admin client cannot be created', async () => {
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      await expect(getVerifiedGitHubLoginForUser('supa-missing-env')).rejects.toThrowError(SupabaseAdminApiError);
    });
  });

  describe('3. Job Queue & Worker Integration (`github.analyze`)', () => {
    it('dispatches `github.analyze` jobs to the GitHub analysis handler in handleJob', async () => {
      const spyFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ total_count: 0, items: [] }),
      } as any);

      const job: any = {
        id: 'job-gh-dispatch',
        type: 'github.analyze',
        payload: { userId: 'u-dispatch-1', login: 'octocat-dispatch' },
        status: 'processing',
        attempts: 1,
      };

      await handleJob(job);

      expect(prisma.githubProfile.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'u-dispatch-1' },
          create: expect.objectContaining({
            userId: 'u-dispatch-1',
            login: 'octocat-dispatch',
            contributions: [],
            fetchedAt: expect.any(Date),
          }),
        })
      );

      spyFetch.mockRestore();
    });

    it('throws when handleJob receives an unknown job type', async () => {
      const unknownJob: any = {
        id: 'job-unknown',
        type: 'nonexistent.job.type',
      };
      await expect(handleJob(unknownJob)).rejects.toThrow('Unknown job type: nonexistent.job.type');
    });

    it('directly handles `github.analyze` via handleGithubAnalyze service handler', async () => {
      const mockFetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ total_count: 0, items: [] }),
      });

      const job: any = {
        id: 'job-gh-1',
        type: JOB_TYPES.GITHUB_ANALYZE,
        payload: { userId: 'u-123', login: 'octocat' },
        status: 'processing',
        attempts: 1,
      };

      await handleGithubAnalyze(job, { fetchFn: mockFetch });

      expect(prisma.githubProfile.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'u-123' },
          create: expect.objectContaining({
            userId: 'u-123',
            login: 'octocat',
            contributions: [],
            fetchedAt: expect.any(Date),
          }),
        })
      );
    });

    it('persists contributions and updates fetchedAt upon successful analysis', async () => {
      const mockFetch = vi.fn();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          items: [
            {
              number: 42,
              repository_url: 'https://api.github.com/repos/org/repo',
              pull_request: { url: 'https://api.github.com/repos/org/repo/pulls/42' },
            },
          ],
        }),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ full_name: 'org/repo', html_url: 'https://github.com/org/repo', stargazers_count: 500 }),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          number: 42,
          title: 'Added caching layer',
          html_url: 'https://github.com/org/repo/pull/42',
          merged: true,
          additions: 120,
          deletions: 20,
          changed_files: 3,
        }),
      });

      const job: any = {
        id: 'job-gh-2',
        type: JOB_TYPES.GITHUB_ANALYZE,
        payload: { userId: 'user-456', login: 'pro-coder' },
      };

      await handleGithubAnalyze(job, { fetchFn: mockFetch });

      expect(prisma.githubProfile.upsert).toHaveBeenCalledTimes(1);
      const upsertArgs = vi.mocked(prisma.githubProfile.upsert).mock.calls[0][0];
      expect(upsertArgs.where).toEqual({ userId: 'user-456' });
      expect((upsertArgs.create as any).contributions).toHaveLength(1);
      expect((upsertArgs.create as any).contributions[0].repoName).toBe('org/repo');
      expect((upsertArgs.create as any).contributions[0].repoStars).toBe(500);
      expect((upsertArgs.create as any).fetchedAt).toBeInstanceOf(Date);
    });

    it('does not update fetchedAt or persist profile when analysis fails', async () => {
      const mockFetch = vi.fn().mockRejectedValueOnce(new Error('Fatal API crash'));

      const job: any = {
        id: 'job-gh-fail',
        type: JOB_TYPES.GITHUB_ANALYZE,
        payload: { userId: 'u-fail', login: 'bad-request' },
      };

      await expect(handleGithubAnalyze(job, { fetchFn: mockFetch })).rejects.toThrow('Fatal API crash');
      expect(prisma.githubProfile.upsert).not.toHaveBeenCalled();
    });

    it('skips analysis and completes cleanly if candidate unlinked their GitHub account before worker execution', async () => {
      mockGetUserById.mockResolvedValueOnce({
        data: {
          user: {
            id: 'supa-unlinked',
            identities: [{ provider: 'google', identity_data: { email: 'u@example.com' } }],
          },
        },
        error: null,
      });

      const job: any = {
        id: 'job-unlinked',
        type: JOB_TYPES.GITHUB_ANALYZE,
        payload: { userId: 'u-unlinked', login: 'octocat' },
        status: 'processing',
        attempts: 1,
      };

      await handleGithubAnalyze(job);
      expect(prisma.githubProfile.upsert).not.toHaveBeenCalled();
    });

    it('skips analysis and completes cleanly if candidate changed their GitHub login before worker execution', async () => {
      mockGetUserById.mockResolvedValueOnce({
        data: {
          user: {
            id: 'supa-changed',
            identities: [{ provider: 'github', identity_data: { user_name: 'new-login-dev' } }],
          },
        },
        error: null,
      });

      const job: any = {
        id: 'job-changed',
        type: JOB_TYPES.GITHUB_ANALYZE,
        payload: { userId: 'u-changed', login: 'old-login-dev' },
        status: 'processing',
        attempts: 1,
      };

      await handleGithubAnalyze(job);
      expect(prisma.githubProfile.upsert).not.toHaveBeenCalled();
    });

    it('requeues job on temporary Supabase admin API failure (status 503)', async () => {
      mockGetUserById.mockResolvedValueOnce({
        data: null,
        error: { message: 'Database connection timeout', status: 503 },
      });

      const job: any = {
        id: 'job-supa-503',
        type: JOB_TYPES.GITHUB_ANALYZE,
        payload: { userId: 'u-503', login: 'octocat' },
        status: 'pending',
        attempts: 1,
      };

      vi.mocked(prisma.$transaction).mockImplementationOnce(async () => job);

      const res = await processNextJob(
        'worker-test',
        async (j) => {
          await handleGithubAnalyze(j);
        },
        JOB_TYPES.GITHUB_ANALYZE
      );

      expect(res).toBeNull();
      expect(prisma.job.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: job.id },
          data: expect.objectContaining({
            status: 'pending',
            lastError: expect.stringContaining('Database connection timeout'),
          }),
        })
      );
      expect(prisma.githubProfile.upsert).not.toHaveBeenCalled();
    });

    it('skips analysis cleanly if candidate no longer exists in application database', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(null);

      const job: any = {
        id: 'job-no-user',
        type: JOB_TYPES.GITHUB_ANALYZE,
        payload: { userId: 'u-deleted', login: 'octocat' },
        status: 'processing',
        attempts: 1,
      };

      await handleGithubAnalyze(job);
      expect(prisma.githubProfile.upsert).not.toHaveBeenCalled();
    });

    it('skips persistence if candidate unlinks GitHub between initial validation and persistence', async () => {
      const mockFetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ total_count: 0, items: [] }),
      });

      // Validation 1: user has linked GitHub account
      mockGetUserById.mockResolvedValueOnce({
        data: {
          user: {
            id: 'supa-race-unlink',
            identities: [{ provider: 'github', identity_data: { user_name: 'octocat' } }],
          },
        },
        error: null,
      });

      // Validation 2 (post-analysis): user unlinked their account
      mockGetUserById.mockResolvedValueOnce({
        data: {
          user: {
            id: 'supa-race-unlink',
            identities: [],
          },
        },
        error: null,
      });

      const job: any = {
        id: 'job-race-unlink',
        type: JOB_TYPES.GITHUB_ANALYZE,
        payload: { userId: 'u-race-unlink', login: 'octocat' },
        status: 'processing',
        attempts: 1,
      };

      await handleGithubAnalyze(job, { fetchFn: mockFetch });
      expect(prisma.githubProfile.upsert).not.toHaveBeenCalled();
    });

    it('skips persistence if candidate login changes between initial validation and persistence', async () => {
      const mockFetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ total_count: 0, items: [] }),
      });

      // Validation 1: login is 'octocat'
      mockGetUserById.mockResolvedValueOnce({
        data: {
          user: {
            id: 'supa-race-change',
            identities: [{ provider: 'github', identity_data: { user_name: 'octocat' } }],
          },
        },
        error: null,
      });

      // Validation 2: login changed to 'switched-octocat'
      mockGetUserById.mockResolvedValueOnce({
        data: {
          user: {
            id: 'supa-race-change',
            identities: [{ provider: 'github', identity_data: { user_name: 'switched-octocat' } }],
          },
        },
        error: null,
      });

      const job: any = {
        id: 'job-race-change',
        type: JOB_TYPES.GITHUB_ANALYZE,
        payload: { userId: 'u-race-change', login: 'octocat' },
        status: 'processing',
        attempts: 1,
      };

      await handleGithubAnalyze(job, { fetchFn: mockFetch });
      expect(prisma.githubProfile.upsert).not.toHaveBeenCalled();
    });

    it('requeues job if Supabase transient failure occurs during second validation', async () => {
      const mockFetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ total_count: 0, items: [] }),
      });

      // Validation 1: succeeds
      mockGetUserById.mockResolvedValueOnce({
        data: {
          user: {
            id: 'supa-race-503',
            identities: [{ provider: 'github', identity_data: { user_name: 'octocat' } }],
          },
        },
        error: null,
      });

      // Validation 2: transient 503 outage
      mockGetUserById.mockResolvedValueOnce({
        data: null,
        error: { message: 'Supabase 503 outage on revalidation', status: 503 },
      });

      const job: any = {
        id: 'job-race-503',
        type: JOB_TYPES.GITHUB_ANALYZE,
        payload: { userId: 'u-race-503', login: 'octocat' },
        status: 'pending',
        attempts: 1,
      };

      vi.mocked(prisma.$transaction).mockImplementationOnce(async () => job);

      const res = await processNextJob(
        'worker-test',
        async (j) => {
          await handleGithubAnalyze(j, { fetchFn: mockFetch });
        },
        JOB_TYPES.GITHUB_ANALYZE
      );

      expect(res).toBeNull();
      expect(prisma.job.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: job.id },
          data: expect.objectContaining({
            status: 'pending',
            lastError: expect.stringContaining('Supabase 503 outage on revalidation'),
          }),
        })
      );
      expect(prisma.githubProfile.upsert).not.toHaveBeenCalled();
    });

    it('persists normally when candidate identity is verified both before and after analysis', async () => {
      const mockFetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ total_count: 0, items: [] }),
      });

      // Validation 1: succeeds
      mockGetUserById.mockResolvedValueOnce({
        data: {
          user: {
            id: 'supa-unchanged',
            identities: [{ provider: 'github', identity_data: { user_name: 'octocat' } }],
          },
        },
        error: null,
      });

      // Validation 2: succeeds with same login
      mockGetUserById.mockResolvedValueOnce({
        data: {
          user: {
            id: 'supa-unchanged',
            identities: [{ provider: 'github', identity_data: { user_name: 'octocat' } }],
          },
        },
        error: null,
      });

      const job: any = {
        id: 'job-unchanged',
        type: JOB_TYPES.GITHUB_ANALYZE,
        payload: { userId: 'u-unchanged', login: 'octocat' },
        status: 'processing',
        attempts: 1,
      };

      await handleGithubAnalyze(job, { fetchFn: mockFetch });
      expect(prisma.githubProfile.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'u-unchanged' },
          create: expect.objectContaining({
            userId: 'u-unchanged',
            login: 'octocat',
            contributions: [],
            fetchedAt: expect.any(Date),
          }),
        })
      );
    });

    it('skips persistence cleanly if application user was deleted from database before persistence', async () => {
      const mockFetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ total_count: 0, items: [] }),
      });

      // Validation 1 succeeds
      mockGetUserById.mockResolvedValueOnce({
        data: {
          user: {
            id: 'supa-del-before-persist',
            identities: [{ provider: 'github', identity_data: { user_name: 'octocat' } }],
          },
        },
        error: null,
      });

      // Validation 2 succeeds
      mockGetUserById.mockResolvedValueOnce({
        data: {
          user: {
            id: 'supa-del-before-persist',
            identities: [{ provider: 'github', identity_data: { user_name: 'octocat' } }],
          },
        },
        error: null,
      });

      // Transaction row-lock finds that the user was deleted in the local DB
      vi.mocked(prisma.$transaction).mockImplementationOnce(async (cb: any) => {
        const tx = {
          $queryRaw: vi.fn().mockResolvedValueOnce([]), // 0 rows returned
          githubProfile: {
            upsert: prisma.githubProfile.upsert,
          },
        };
        return cb(tx);
      });

      const job: any = {
        id: 'job-del-before-persist',
        type: JOB_TYPES.GITHUB_ANALYZE,
        payload: { userId: 'u-del-before-persist', login: 'octocat' },
        status: 'processing',
        attempts: 1,
      };

      await handleGithubAnalyze(job, { fetchFn: mockFetch });
      expect(prisma.githubProfile.upsert).not.toHaveBeenCalled();
    });

    it('handles concurrent deletion race condition if foreign key constraint error P2003 occurs during persistence and user is genuinely absent', async () => {
      const mockFetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ total_count: 0, items: [] }),
      });

      // Validation 1 succeeds
      mockGetUserById.mockResolvedValueOnce({
        data: {
          user: {
            id: 'supa-race-p2003',
            identities: [{ provider: 'github', identity_data: { user_name: 'octocat' } }],
          },
        },
        error: null,
      });

      // Validation 2 succeeds
      mockGetUserById.mockResolvedValueOnce({
        data: {
          user: {
            id: 'supa-race-p2003',
            identities: [{ provider: 'github', identity_data: { user_name: 'octocat' } }],
          },
        },
        error: null,
      });

      // Upsert throws P2003 foreign key constraint failure due to concurrent user deletion
      vi.mocked(prisma.$transaction).mockImplementationOnce(async (cb: any) => {
        const tx = {
          $queryRaw: vi.fn().mockResolvedValueOnce([{ id: 'u-race-p2003' }]),
          githubProfile: {
            upsert: vi.fn().mockRejectedValueOnce({
              code: 'P2003',
              message: 'Foreign key constraint failed on the field: `userId`',
            }),
          },
        };
        return cb(tx);
      });

      // User exists initially for worker resolution, but is absent during the post-error check
      vi.mocked(prisma.user.findUnique)
        .mockResolvedValueOnce({
          id: 'u-race-p2003',
          supabaseUserId: 'supa-race-p2003',
          email: 'race@example.com',
          name: 'Race Candidate',
        } as any)
        .mockResolvedValueOnce(null);

      const job: any = {
        id: 'job-race-p2003',
        type: JOB_TYPES.GITHUB_ANALYZE,
        payload: { userId: 'u-race-p2003', login: 'octocat' },
        status: 'processing',
        attempts: 1,
      };

      // Completes cleanly without re-throwing unhandled foreign key error
      await expect(handleGithubAnalyze(job, { fetchFn: mockFetch })).resolves.toBeUndefined();
    });

    it('propagates P2003 foreign key constraint error when application user still exists', async () => {
      const mockFetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ total_count: 0, items: [] }),
      });

      mockGetUserById.mockResolvedValueOnce({
        data: {
          user: {
            id: 'supa-p2003-exists',
            identities: [{ provider: 'github', identity_data: { user_name: 'octocat' } }],
          },
        },
        error: null,
      });

      mockGetUserById.mockResolvedValueOnce({
        data: {
          user: {
            id: 'supa-p2003-exists',
            identities: [{ provider: 'github', identity_data: { user_name: 'octocat' } }],
          },
        },
        error: null,
      });

      const p2003Err = {
        code: 'P2003',
        message: 'Foreign key constraint failed on unrelated field',
      };

      vi.mocked(prisma.$transaction).mockImplementationOnce(async (cb: any) => {
        const tx = {
          $queryRaw: vi.fn().mockResolvedValueOnce([{ id: 'u-p2003-exists' }]),
          githubProfile: {
            upsert: vi.fn().mockRejectedValueOnce(p2003Err),
          },
        };
        return cb(tx);
      });

      // User still exists in database
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        id: 'u-p2003-exists',
        supabaseUserId: 'supa-p2003-exists',
        email: 'p2003@example.com',
        name: 'Existing Candidate',
      } as any);

      const job: any = {
        id: 'job-p2003-exists',
        type: JOB_TYPES.GITHUB_ANALYZE,
        payload: { userId: 'u-p2003-exists', login: 'octocat' },
        status: 'processing',
        attempts: 1,
      };

      await expect(handleGithubAnalyze(job, { fetchFn: mockFetch })).rejects.toMatchObject({
        code: 'P2003',
      });
    });

    it('propagates P2025 record-not-found error when application user still exists', async () => {
      const mockFetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ total_count: 0, items: [] }),
      });

      mockGetUserById.mockResolvedValueOnce({
        data: {
          user: {
            id: 'supa-p2025-exists',
            identities: [{ provider: 'github', identity_data: { user_name: 'octocat' } }],
          },
        },
        error: null,
      });

      mockGetUserById.mockResolvedValueOnce({
        data: {
          user: {
            id: 'supa-p2025-exists',
            identities: [{ provider: 'github', identity_data: { user_name: 'octocat' } }],
          },
        },
        error: null,
      });

      const p2025Err = {
        code: 'P2025',
        message: 'An operation failed because it depends on one or more records that were required but not found',
      };

      vi.mocked(prisma.$transaction).mockImplementationOnce(async (cb: any) => {
        const tx = {
          $queryRaw: vi.fn().mockResolvedValueOnce([{ id: 'u-p2025-exists' }]),
          githubProfile: {
            upsert: vi.fn().mockRejectedValueOnce(p2025Err),
          },
        };
        return cb(tx);
      });

      // User still exists in database
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        id: 'u-p2025-exists',
        supabaseUserId: 'supa-p2025-exists',
        email: 'p2025@example.com',
        name: 'Existing Candidate',
      } as any);

      const job: any = {
        id: 'job-p2025-exists',
        type: JOB_TYPES.GITHUB_ANALYZE,
        payload: { userId: 'u-p2025-exists', login: 'octocat' },
        status: 'processing',
        attempts: 1,
      };

      await expect(handleGithubAnalyze(job, { fetchFn: mockFetch })).rejects.toMatchObject({
        code: 'P2025',
      });
    });

    it('skips persistence cleanly on P2025 error when application user is genuinely absent', async () => {
      const mockFetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ total_count: 0, items: [] }),
      });

      mockGetUserById.mockResolvedValueOnce({
        data: {
          user: {
            id: 'supa-p2025-absent',
            identities: [{ provider: 'github', identity_data: { user_name: 'octocat' } }],
          },
        },
        error: null,
      });

      mockGetUserById.mockResolvedValueOnce({
        data: {
          user: {
            id: 'supa-p2025-absent',
            identities: [{ provider: 'github', identity_data: { user_name: 'octocat' } }],
          },
        },
        error: null,
      });

      vi.mocked(prisma.$transaction).mockImplementationOnce(async (cb: any) => {
        const tx = {
          $queryRaw: vi.fn().mockResolvedValueOnce([{ id: 'u-p2025-absent' }]),
          githubProfile: {
            upsert: vi.fn().mockRejectedValueOnce({
              code: 'P2025',
              message: 'Record to update not found',
            }),
          },
        };
        return cb(tx);
      });

      // User was deleted concurrently: post-error check finds user absent
      vi.mocked(prisma.user.findUnique)
        .mockResolvedValueOnce({
          id: 'u-p2025-absent',
          supabaseUserId: 'supa-p2025-absent',
          email: 'absent@example.com',
          name: 'Absent Candidate',
        } as any)
        .mockResolvedValueOnce(null);

      const job: any = {
        id: 'job-p2025-absent',
        type: JOB_TYPES.GITHUB_ANALYZE,
        payload: { userId: 'u-p2025-absent', login: 'octocat' },
        status: 'processing',
        attempts: 1,
      };

      await expect(handleGithubAnalyze(job, { fetchFn: mockFetch })).resolves.toBeUndefined();
    });

    it('propagates genuine database errors during persistence so the worker queue can retry', async () => {
      const mockFetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ total_count: 0, items: [] }),
      });

      // Validation 1 succeeds
      mockGetUserById.mockResolvedValueOnce({
        data: {
          user: {
            id: 'supa-genuine-db-err',
            identities: [{ provider: 'github', identity_data: { user_name: 'octocat' } }],
          },
        },
        error: null,
      });

      // Validation 2 succeeds
      mockGetUserById.mockResolvedValueOnce({
        data: {
          user: {
            id: 'supa-genuine-db-err',
            identities: [{ provider: 'github', identity_data: { user_name: 'octocat' } }],
          },
        },
        error: null,
      });

      // Transaction queryRaw throws a genuine database connection error
      vi.mocked(prisma.$transaction).mockImplementationOnce(async (cb: any) => {
        const tx = {
          $queryRaw: vi.fn().mockRejectedValueOnce(new Error('Connection terminated unexpectedly')),
          githubProfile: {
            upsert: prisma.githubProfile.upsert,
          },
        };
        return cb(tx);
      });

      const job: any = {
        id: 'job-genuine-db-err',
        type: JOB_TYPES.GITHUB_ANALYZE,
        payload: { userId: 'u-genuine-db-err', login: 'octocat' },
        status: 'processing',
        attempts: 1,
      };

      await expect(handleGithubAnalyze(job, { fetchFn: mockFetch })).rejects.toThrow(
        'Connection terminated unexpectedly'
      );
    });

    it('identifies rate-limit errors as transient and requeues for retry when attempts < MAX_ATTEMPTS', async () => {
      const rateLimitErr = new GitHubRateLimitError('Rate limit exceeded');
      expect(isTransientError(rateLimitErr)).toBe(true);

      const job: any = {
        id: 'job-rate-limit-1',
        type: JOB_TYPES.GITHUB_ANALYZE,
        sessionId: null,
        payload: { userId: 'u-rt', login: 'dev' },
        status: 'pending',
        attempts: 1,
      };

      vi.mocked(prisma.$transaction).mockImplementationOnce(async (cb: any) => {
        return job;
      });

      // processNextJob requeues transient error when attempts < MAX_ATTEMPTS
      const res = await processNextJob(
        'worker-test',
        async () => {
          throw rateLimitErr;
        },
        JOB_TYPES.GITHUB_ANALYZE
      );

      expect(res).toBeNull();
      expect(prisma.job.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: job.id },
          data: expect.objectContaining({
            status: 'pending',
            lastError: 'Rate limit exceeded',
          }),
        })
      );
    });

    it('fails the job when attempts reach MAX_ATTEMPTS', async () => {
      const rateLimitErr = new GitHubRateLimitError('Rate limit exceeded');

      const job: any = {
        id: 'job-rate-limit-max',
        type: JOB_TYPES.GITHUB_ANALYZE,
        payload: { userId: 'u-rt', login: 'dev' },
        status: 'processing',
        attempts: MAX_ATTEMPTS,
      };

      vi.mocked(prisma.$transaction).mockImplementationOnce(async () => job);

      await expect(
        processNextJob(
          'worker-test',
          async () => {
            throw rateLimitErr;
          },
          JOB_TYPES.GITHUB_ANALYZE
        )
      ).rejects.toThrow();

      expect(prisma.job.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: job.id },
          data: expect.objectContaining({
            status: 'failed',
          }),
        })
      );
    });
  });

  describe('4. Daily Refresh Protection & Concurrency Safeguards', () => {
    it('isEligibleForDailyGithubRefresh correctly calculates 24-hour window', () => {
      const now = new Date('2026-11-21T12:00:00Z');

      // No profile fetched before
      expect(isEligibleForDailyGithubRefresh(null, now)).toBe(true);
      expect(isEligibleForDailyGithubRefresh(undefined, now)).toBe(true);

      // Fetched 5 hours ago (ineligible)
      const fiveHoursAgo = new Date(now.getTime() - 5 * 60 * 60 * 1000);
      expect(isEligibleForDailyGithubRefresh(fiveHoursAgo, now)).toBe(false);

      // Fetched 23 hours and 59 minutes ago (ineligible)
      const almostOneDayAgo = new Date(now.getTime() - 23.9 * 60 * 60 * 1000);
      expect(isEligibleForDailyGithubRefresh(almostOneDayAgo, now)).toBe(false);

      // Fetched 24 hours ago (eligible)
      const exactlyOneDayAgo = new Date(now.getTime() - DAILY_GITHUB_REFRESH_MS);
      expect(isEligibleForDailyGithubRefresh(exactlyOneDayAgo, now)).toBe(true);

      // Fetched 3 days ago (eligible)
      const threeDaysAgo = new Date(now.getTime() - 3 * DAILY_GITHUB_REFRESH_MS);
      expect(isEligibleForDailyGithubRefresh(threeDaysAgo, now)).toBe(true);
    });

    it('queues analysis for a user without an existing GithubProfile', async () => {
      vi.mocked(prisma.$transaction).mockImplementationOnce(async (cb: any) => {
        const tx = {
          $queryRaw: vi.fn().mockResolvedValue([{ locked: 1 }]),
          githubProfile: { findUnique: vi.fn().mockResolvedValue(null) },
          job: {
            findFirst: vi.fn().mockResolvedValue(null),
            create: vi.fn().mockResolvedValue({ id: 'new-job-1', type: JOB_TYPES.GITHUB_ANALYZE }),
          },
        };
        return cb(tx);
      });

      const res = await maybeEnqueueGithubAnalysis('u-new', 'octocat');
      expect(res.queued).toBe(true);
      expect(res.job?.id).toBe('new-job-1');
    });

    it('does not queue analysis if fetched less than 24 hours ago', async () => {
      const recent = new Date(Date.now() - 4 * 60 * 60 * 1000);

      vi.mocked(prisma.$transaction).mockImplementationOnce(async (cb: any) => {
        const tx = {
          $queryRaw: vi.fn().mockResolvedValue([{ locked: 1 }]),
          githubProfile: { findUnique: vi.fn().mockResolvedValue({ fetchedAt: recent, login: 'octocat' }) },
          job: {
            findFirst: vi.fn().mockResolvedValue(null),
            create: vi.fn(),
          },
        };
        return cb(tx);
      });

      const res = await maybeEnqueueGithubAnalysis('u-existing', 'octocat');
      expect(res.queued).toBe(false);
      expect(res.reason).toBe('recently_fetched');
    });

    it('allows immediate refresh if candidates linked GitHub login changed, even if fetched < 24 hours ago', async () => {
      const recent = new Date(Date.now() - 2 * 60 * 60 * 1000);

      vi.mocked(prisma.$transaction).mockImplementationOnce(async (cb: any) => {
        const tx = {
          $queryRaw: vi.fn().mockResolvedValue([{ locked: 1 }]),
          githubProfile: { findUnique: vi.fn().mockResolvedValue({ fetchedAt: recent, login: 'old-octocat' }) },
          job: {
            findFirst: vi.fn().mockResolvedValue(null),
            create: vi.fn().mockResolvedValue({ id: 'refresh-changed-job', type: JOB_TYPES.GITHUB_ANALYZE }),
          },
        };
        return cb(tx);
      });

      const res = await maybeEnqueueGithubAnalysis('u-existing', 'new-octocat');
      expect(res.queued).toBe(true);
      expect(res.job?.id).toBe('refresh-changed-job');
    });

    it('allows refresh when at least 24 hours have elapsed since last fetch', async () => {
      const past24h = new Date(Date.now() - 25 * 60 * 60 * 1000);

      vi.mocked(prisma.$transaction).mockImplementationOnce(async (cb: any) => {
        const tx = {
          $queryRaw: vi.fn().mockResolvedValue([{ locked: 1 }]),
          githubProfile: { findUnique: vi.fn().mockResolvedValue({ fetchedAt: past24h }) },
          job: {
            findFirst: vi.fn().mockResolvedValue(null),
            create: vi.fn().mockResolvedValue({ id: 'refresh-job-1', type: JOB_TYPES.GITHUB_ANALYZE }),
          },
        };
        return cb(tx);
      });

      const res = await maybeEnqueueGithubAnalysis('u-eligible', 'octocat');
      expect(res.queued).toBe(true);
      expect(res.job?.id).toBe('refresh-job-1');
    });

    it('prevents duplicate pending or processing jobs for the same user and same login', async () => {
      let findFirstQuery: any = null;
      vi.mocked(prisma.$transaction).mockImplementationOnce(async (cb: any) => {
        const tx = {
          $queryRaw: vi.fn().mockResolvedValue([{ locked: 1 }]),
          githubProfile: { findUnique: vi.fn().mockResolvedValue(null) },
          job: {
            findFirst: vi.fn().mockImplementation((args) => {
              findFirstQuery = args;
              return Promise.resolve({ id: 'pending-job-existing', status: 'pending' });
            }),
            create: vi.fn(),
          },
        };
        return cb(tx);
      });

      const res = await maybeEnqueueGithubAnalysis('u-pending', 'octocat');
      expect(res.queued).toBe(false);
      expect(res.reason).toBe('already_queued');
      expect(res.job?.id).toBe('pending-job-existing');
      expect(findFirstQuery?.where?.AND).toEqual([
        { payload: { path: ['userId'], equals: 'u-pending' } },
        { payload: { path: ['login'], equals: 'octocat' } },
      ]);
    });

    it('enqueues job for newly linked login even if a pending job exists for the old login', async () => {
      let createdPayload: any = null;
      vi.mocked(prisma.$transaction).mockImplementationOnce(async (cb: any) => {
        const tx = {
          $queryRaw: vi.fn().mockResolvedValue([{ locked: 1 }]),
          githubProfile: { findUnique: vi.fn().mockResolvedValue({ login: 'old-octocat', fetchedAt: new Date() }) },
          job: {
            findFirst: vi.fn().mockImplementation((args) => {
              // The query specifically checks for login === 'new-octocat'
              // The DB only has a pending job for 'old-octocat', so findFirst returns null
              const isLookingForNewLogin = args.where.AND.some(
                (cond: any) => cond.payload?.equals === 'new-octocat'
              );
              return Promise.resolve(isLookingForNewLogin ? null : { id: 'old-job-pending', status: 'pending' });
            }),
            create: vi.fn().mockImplementation((args) => {
              createdPayload = args.data.payload;
              return Promise.resolve({ id: 'new-job-created', type: JOB_TYPES.GITHUB_ANALYZE });
            }),
          },
        };
        return cb(tx);
      });

      const res = await maybeEnqueueGithubAnalysis('u-switch', 'new-octocat');
      expect(res.queued).toBe(true);
      expect(res.job?.id).toBe('new-job-created');
      expect(createdPayload).toEqual({ userId: 'u-switch', login: 'new-octocat' });
    });

    it('enqueues job for newly linked login even if a processing job exists for the old login', async () => {
      let createdPayload: any = null;
      vi.mocked(prisma.$transaction).mockImplementationOnce(async (cb: any) => {
        const tx = {
          $queryRaw: vi.fn().mockResolvedValue([{ locked: 1 }]),
          githubProfile: { findUnique: vi.fn().mockResolvedValue({ login: 'old-octocat', fetchedAt: new Date() }) },
          job: {
            findFirst: vi.fn().mockImplementation((args) => {
              // Searching for 'new-octocat' returns null
              const isLookingForNewLogin = args.where.AND.some(
                (cond: any) => cond.payload?.equals === 'new-octocat'
              );
              return Promise.resolve(isLookingForNewLogin ? null : { id: 'old-job-processing', status: 'processing' });
            }),
            create: vi.fn().mockImplementation((args) => {
              createdPayload = args.data.payload;
              return Promise.resolve({ id: 'new-job-created-2', type: JOB_TYPES.GITHUB_ANALYZE });
            }),
          },
        };
        return cb(tx);
      });

      const res = await maybeEnqueueGithubAnalysis('u-switch-2', 'new-octocat');
      expect(res.queued).toBe(true);
      expect(res.job?.id).toBe('new-job-created-2');
      expect(createdPayload).toEqual({ userId: 'u-switch-2', login: 'new-octocat' });
    });

    it('rejects trigger for users without a verified linked GitHub account', async () => {
      // Mock Supabase admin returning user with only google identity
      mockGetUserById.mockResolvedValueOnce({
        data: {
          user: {
            id: 'supa-user-1',
            identities: [{ provider: 'google', identity_data: { email: 'g@example.com' } }],
          },
        },
        error: null,
      });

      const res = await triggerGithubAnalysisIfLinked('user-1', 'supa-user-1');
      expect(res.queued).toBe(false);
      expect(res.reason).toBe('no_github_linked');
    });

    it('does not create duplicate job when existing pending job has mixed casing "Vismay24" and incoming request is "vismay24"', async () => {
      let created = false;
      vi.mocked(prisma.$transaction).mockImplementationOnce(async (cb: any) => {
        const tx = {
          $queryRaw: vi.fn().mockResolvedValue([{ locked: 1 }]),
          githubProfile: { findUnique: vi.fn().mockResolvedValue(null) },
          job: {
            findFirst: vi.fn().mockResolvedValue({
              id: 'pending-job-vismay',
              type: JOB_TYPES.GITHUB_ANALYZE,
              status: 'pending',
              payload: { userId: 'u-vismay', login: 'vismay24' },
            }),
            create: vi.fn().mockImplementation(() => {
              created = true;
              return Promise.resolve({ id: 'new-job', type: JOB_TYPES.GITHUB_ANALYZE });
            }),
          },
        };
        return cb(tx);
      });

      const res = await maybeEnqueueGithubAnalysis('u-vismay', 'vismay24');
      expect(res.queued).toBe(false);
      expect(res.reason).toBe('already_queued');
      expect(res.job?.id).toBe('pending-job-vismay');
      expect(created).toBe(false);
    });

    it('does not create duplicate job when existing processing job has uppercase "OCTOCAT" and incoming request is "octocat"', async () => {
      let created = false;
      vi.mocked(prisma.$transaction).mockImplementationOnce(async (cb: any) => {
        const tx = {
          $queryRaw: vi.fn().mockResolvedValue([{ locked: 1 }]),
          githubProfile: { findUnique: vi.fn().mockResolvedValue(null) },
          job: {
            findFirst: vi.fn().mockResolvedValue({
              id: 'processing-job-octocat',
              type: JOB_TYPES.GITHUB_ANALYZE,
              status: 'processing',
              payload: { userId: 'u-octo', login: 'octocat' },
            }),
            create: vi.fn().mockImplementation(() => {
              created = true;
              return Promise.resolve({ id: 'new-job', type: JOB_TYPES.GITHUB_ANALYZE });
            }),
          },
        };
        return cb(tx);
      });

      const res = await maybeEnqueueGithubAnalysis('u-octo', 'octocat');
      expect(res.queued).toBe(false);
      expect(res.reason).toBe('already_queued');
      expect(res.job?.id).toBe('processing-job-octocat');
      expect(created).toBe(false);
    });

    it('enqueues successfully for incoming "new-octocat" when an existing pending job exists for "old-octocat"', async () => {
      let createdPayload: any = null;
      vi.mocked(prisma.$transaction).mockImplementationOnce(async (cb: any) => {
        const tx = {
          $queryRaw: vi.fn().mockResolvedValue([{ locked: 1 }]),
          githubProfile: { findUnique: vi.fn().mockResolvedValue({ login: 'old-octocat', fetchedAt: new Date() }) },
          job: {
            findFirst: vi.fn().mockResolvedValue(null),
            create: vi.fn().mockImplementation((args) => {
              createdPayload = args.data.payload;
              return Promise.resolve({ id: 'new-job-created-distinct', type: JOB_TYPES.GITHUB_ANALYZE });
            }),
          },
        };
        return cb(tx);
      });

      const res = await maybeEnqueueGithubAnalysis('u-switch-distinct', 'new-octocat');
      expect(res.queued).toBe(true);
      expect(res.job?.id).toBe('new-job-created-distinct');
      expect(createdPayload).toEqual({ userId: 'u-switch-distinct', login: 'new-octocat' });
    });

    it('does not bypass 24-hour cooldown when same normalized login has different casing', async () => {
      const recent = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2 hours ago
      let created = false;

      vi.mocked(prisma.$transaction).mockImplementationOnce(async (cb: any) => {
        const tx = {
          $queryRaw: vi.fn().mockResolvedValue([{ locked: 1 }]),
          githubProfile: {
            findUnique: vi.fn().mockResolvedValue({
              login: 'Vismay24',
              fetchedAt: recent,
            }),
          },
          job: {
            findFirst: vi.fn().mockResolvedValue(null),
            create: vi.fn().mockImplementation(() => {
              created = true;
              return Promise.resolve({ id: 'job-unexpected', type: JOB_TYPES.GITHUB_ANALYZE });
            }),
          },
        };
        return cb(tx);
      });

      const res = await maybeEnqueueGithubAnalysis('u-cooldown-case', 'vismay24');
      expect(res.queued).toBe(false);
      expect(res.reason).toBe('recently_fetched');
      expect(created).toBe(false);
    });
  });

  describe('5. Application Endpoints & Identity Integration', () => {
    it('GET /api/auth/me enqueues a github.analyze job in background when user has verified GitHub identity', async () => {
      const mockUser = {
        id: 'u-auth-1',
        supabaseUserId: 'supa-gh-user',
        email: 'vismay@example.com',
        name: 'Vismay Solanki',
      };

      mockGetUser.mockResolvedValueOnce({
        data: {
          user: {
            id: 'supa-gh-user',
            email: 'vismay@example.com',
            app_metadata: { provider: 'github', providers: ['github'] },
            identities: [
              {
                provider: 'github',
                identity_data: { user_name: 'vismay-solanki' },
              },
            ],
          },
        },
        error: null,
      });

      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        ...mockUser,
        githubProfile: null,
      } as any);

      mockTxGithubProfileFindUnique.mockResolvedValue(null);
      mockTxJobFindFirst.mockResolvedValue(null);
      mockTxJobCreate.mockResolvedValue({ id: 'job-gh-queued', type: JOB_TYPES.GITHUB_ANALYZE });

      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', 'Bearer valid-supabase-token');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.githubUsername).toBe('vismay-solanki');

      // Wait a microtask turn for background un-awaited promise to complete
      await new Promise((resolve) => setImmediate(resolve));

      expect(mockTxJobCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: JOB_TYPES.GITHUB_ANALYZE,
            payload: { userId: mockUser.id, login: 'vismay-solanki' },
          }),
        })
      );
    });

    it('GET /api/auth/me remains non-blocking and responds promptly without awaiting analysis', async () => {
      const mockUser = {
        id: 'u-auth-nonblock',
        supabaseUserId: 'supa-gh-nonblock',
        email: 'nonblock@example.com',
        name: 'Nonblock User',
      };

      mockGetUser.mockResolvedValueOnce({
        data: {
          user: {
            id: 'supa-gh-nonblock',
            email: 'nonblock@example.com',
            app_metadata: { provider: 'github', providers: ['github'] },
            identities: [
              {
                provider: 'github',
                identity_data: { user_name: 'nonblock-login' },
              },
            ],
          },
        },
        error: null,
      });

      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        ...mockUser,
        githubProfile: null,
      } as any);

      // Simulate background job queue creation with a controlled deferred Promise
      let resolveJobCreate: (val?: unknown) => void = () => {};
      let jobCreationFinished = false;
      const jobCreatePromise = new Promise((resolve) => {
        resolveJobCreate = resolve;
      });

      mockTxJobCreate.mockImplementationOnce(async () => {
        await jobCreatePromise;
        jobCreationFinished = true;
        return { id: 'slow-job', type: JOB_TYPES.GITHUB_ANALYZE };
      });

      try {
        const res = await request(app)
          .get('/api/auth/me')
          .set('Authorization', 'Bearer valid-supabase-token');

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        // Endpoint responds immediately while background job creation is still pending
        expect(jobCreationFinished).toBe(false);
      } finally {
        resolveJobCreate();
        await new Promise((r) => setImmediate(r));
      }
    });

    it('GET /api/auth/me does not enqueue a github.analyze job for users without a verified linked GitHub identity', async () => {
      const mockUser = {
        id: 'u-auth-google-only',
        supabaseUserId: 'supa-google-only',
        email: 'googleonly@example.com',
        name: 'Google User',
      };

      // Supabase user only has Google identity
      mockGetUser.mockResolvedValueOnce({
        data: {
          user: {
            id: 'supa-google-only',
            email: 'googleonly@example.com',
            app_metadata: { provider: 'google', providers: ['google'] },
            identities: [
              {
                provider: 'google',
                identity_data: { email: 'googleonly@example.com' },
              },
            ],
          },
        },
        error: null,
      });

      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        ...mockUser,
        githubProfile: null,
      } as any);

      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', 'Bearer valid-supabase-token');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.githubUsername).toBeNull();
      expect(mockGetUserById).not.toHaveBeenCalled();

      await new Promise((resolve) => setImmediate(resolve));

      expect(mockTxJobCreate).not.toHaveBeenCalled();
    });

    it('GET /api/auth/me does not expose stale username or contributions from existing profile when user has unlinked GitHub', async () => {
      const mockUser = {
        id: 'u-auth-stale',
        supabaseUserId: 'supa-stale-user',
        email: 'stale@example.com',
        name: 'Stale User',
      };

      // Current Supabase session has only google identity (GitHub unlinked)
      mockGetUser.mockResolvedValueOnce({
        data: {
          user: {
            id: 'supa-stale-user',
            email: 'stale@example.com',
            app_metadata: { provider: 'google', providers: ['google'] },
            identities: [
              {
                provider: 'google',
                identity_data: { email: 'stale@example.com' },
              },
            ],
          },
        },
        error: null,
      });

      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        ...mockUser,
        githubProfile: {
          login: 'old-stale-octocat',
          contributions: [{ repoName: 'old/repo', stars: 10 }],
        },
      } as any);

      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', 'Bearer valid-supabase-token');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.githubUsername).toBeNull();
      expect(res.body.data.githubProfile).toBeUndefined();
      expect(mockGetUserById).not.toHaveBeenCalled();
    });

    it('GET /api/auth/me for Google signup followed by GitHub linking resolves verified GitHub login without Admin lookup', async () => {
      const mockUser = {
        id: 'u-auth-google-signup-gh-linked',
        supabaseUserId: 'supa-google-signup-gh-linked',
        email: 'google-first@example.com',
        name: 'Google First User',
      };

      // Initial signup was Google (provider: 'google'), later linked GitHub
      mockGetUser.mockResolvedValueOnce({
        data: {
          user: {
            id: 'supa-google-signup-gh-linked',
            email: 'google-first@example.com',
            app_metadata: { provider: 'google', providers: ['google', 'github'] },
            identities: [
              {
                provider: 'google',
                identity_data: { email: 'google-first@example.com' },
              },
              {
                provider: 'github',
                identity_data: { user_name: 'linked-gh-octocat' },
              },
            ],
          },
        },
        error: null,
      });

      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        ...mockUser,
        githubProfile: null,
      } as any);

      mockTxJobFindFirst.mockResolvedValue(null);
      mockTxJobCreate.mockResolvedValue({ id: 'job-google-gh', type: JOB_TYPES.GITHUB_ANALYZE });

      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', 'Bearer valid-supabase-token');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.githubUsername).toBe('linked-gh-octocat');
      // Must NOT perform Supabase Admin lookup because verified login is directly extracted from identities
      expect(mockGetUserById).not.toHaveBeenCalled();
      expect(mockTxJobCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: JOB_TYPES.GITHUB_ANALYZE,
            payload: { userId: mockUser.id, login: 'linked-gh-octocat' },
          }),
        })
      );
    });

    it('GET /api/auth/me for GitHub signup followed by Google linking resolves verified GitHub login without Admin lookup', async () => {
      const mockUser = {
        id: 'u-auth-gh-signup-google-linked',
        supabaseUserId: 'supa-gh-signup-google-linked',
        email: 'gh-first@example.com',
        name: 'GitHub First User',
      };

      // Initial signup was GitHub (provider: 'github'), later linked Google
      mockGetUser.mockResolvedValueOnce({
        data: {
          user: {
            id: 'supa-gh-signup-google-linked',
            email: 'gh-first@example.com',
            app_metadata: { provider: 'github', providers: ['github', 'google'] },
            identities: [
              {
                provider: 'github',
                identity_data: { user_name: 'signup-gh-octocat' },
              },
              {
                provider: 'google',
                identity_data: { email: 'gh-first@example.com' },
              },
            ],
          },
        },
        error: null,
      });

      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        ...mockUser,
        githubProfile: null,
      } as any);

      mockTxJobFindFirst.mockResolvedValue(null);
      mockTxJobCreate.mockResolvedValue({ id: 'job-gh-google', type: JOB_TYPES.GITHUB_ANALYZE });

      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', 'Bearer valid-supabase-token');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.githubUsername).toBe('signup-gh-octocat');
      // Must NOT perform Supabase Admin lookup
      expect(mockGetUserById).not.toHaveBeenCalled();
      expect(mockTxJobCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: JOB_TYPES.GITHUB_ANALYZE,
            payload: { userId: mockUser.id, login: 'signup-gh-octocat' },
          }),
        })
      );
    });

    it('GET /api/auth/me for GitHub sign-in after linking resolves verified GitHub login without Admin lookup', async () => {
      const mockUser = {
        id: 'u-auth-gh-after-linking',
        supabaseUserId: 'supa-gh-after-linking',
        email: 'gh-after-link@example.com',
        name: 'GitHub After Linking User',
      };

      // Multi-provider user signs in with GitHub
      mockGetUser.mockResolvedValueOnce({
        data: {
          user: {
            id: 'supa-gh-after-linking',
            email: 'gh-after-link@example.com',
            app_metadata: { provider: 'google', providers: ['google', 'github'] },
            identities: [
              {
                provider: 'google',
                identity_data: { email: 'gh-after-link@example.com' },
              },
              {
                provider: 'github',
                identity_data: { user_name: 'active-gh-octocat' },
              },
            ],
          },
        },
        error: null,
      });

      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        ...mockUser,
        githubProfile: null,
      } as any);

      mockTxJobFindFirst.mockResolvedValue(null);
      mockTxJobCreate.mockResolvedValue({ id: 'job-active-gh', type: JOB_TYPES.GITHUB_ANALYZE });

      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', 'Bearer valid-supabase-token');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.githubUsername).toBe('active-gh-octocat');
      expect(mockGetUserById).not.toHaveBeenCalled();
      expect(mockTxJobCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: JOB_TYPES.GITHUB_ANALYZE,
            payload: { userId: mockUser.id, login: 'active-gh-octocat' },
          }),
        })
      );
    });

    it('GET /api/auth/me for Google sign-in after linking resolves verified GitHub login without Admin lookup', async () => {
      const mockUser = {
        id: 'u-auth-google-after-linking',
        supabaseUserId: 'supa-google-after-linking',
        email: 'google-after-link@example.com',
        name: 'Google After Linking User',
      };

      // User signed in with Google, but has a linked GitHub OAuth identity in token
      mockGetUser.mockResolvedValueOnce({
        data: {
          user: {
            id: 'supa-google-after-linking',
            email: 'google-after-link@example.com',
            app_metadata: { provider: 'google', providers: ['google', 'github'] },
            identities: [
              {
                provider: 'google',
                identity_data: { email: 'google-after-link@example.com' },
              },
              {
                provider: 'github',
                identity_data: { user_name: 'linked-octocat' },
              },
            ],
          },
        },
        error: null,
      });

      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        ...mockUser,
        githubProfile: null,
      } as any);

      mockTxJobFindFirst.mockResolvedValue(null);
      mockTxJobCreate.mockResolvedValue({ id: 'job-gh-linked', type: JOB_TYPES.GITHUB_ANALYZE });

      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', 'Bearer valid-supabase-token');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.githubUsername).toBe('linked-octocat');
      // Must NOT perform Supabase Admin lookup because verified login was directly extracted from token
      expect(mockGetUserById).not.toHaveBeenCalled();
    });

    it('GET /api/auth/me for Google sign-in after linking without verifiedLogin in token does not perform Admin lookup', async () => {
      const mockUser = {
        id: 'u-auth-google-nologin-after-link',
        supabaseUserId: 'supa-google-nologin-after-link',
        email: 'google-nologin@example.com',
        name: 'Google No Login User',
      };

      // Multi-provider user signs in with Google, but token has empty identities
      mockGetUser.mockResolvedValueOnce({
        data: {
          user: {
            id: 'supa-google-nologin-after-link',
            email: 'google-nologin@example.com',
            app_metadata: { provider: 'google', providers: ['google', 'github'] },
            identities: [],
          },
        },
        error: null,
      });

      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        ...mockUser,
        githubProfile: null,
      } as any);

      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', 'Bearer valid-supabase-token');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.githubUsername).toBeNull();
      // Must NOT perform Supabase Admin lookup because user has multiple providers and did not sign in as GitHub-only
      expect(mockGetUserById).not.toHaveBeenCalled();
      expect(mockTxJobCreate).not.toHaveBeenCalled();
    });

    it('GET /api/auth/me for GitHub as the only provider without verifiedLogin in token permits Admin lookup fallback', async () => {
      const mockUser = {
        id: 'u-auth-gh-fallback',
        supabaseUserId: 'supa-gh-fallback',
        email: 'ghfallback@example.com',
        name: 'GitHub Fallback User',
      };

      // User signed in with GitHub as the sole provider, but token response has empty identities (no login in token)
      mockGetUser.mockResolvedValueOnce({
        data: {
          user: {
            id: 'supa-gh-fallback',
            email: 'ghfallback@example.com',
            app_metadata: { provider: 'github', providers: ['github'] },
            identities: [],
          },
        },
        error: null,
      });

      // Admin lookup retrieves full identities
      mockGetUserById.mockResolvedValueOnce({
        data: {
          user: {
            id: 'supa-gh-fallback',
            identities: [{ provider: 'github', identity_data: { user_name: 'admin-fetched-octocat' } }],
          },
        },
        error: null,
      });

      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        ...mockUser,
        githubProfile: null,
      } as any);

      mockTxJobFindFirst.mockResolvedValue(null);
      mockTxJobCreate.mockResolvedValue({ id: 'job-admin-fetched', type: JOB_TYPES.GITHUB_ANALYZE });

      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', 'Bearer valid-supabase-token');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Wait a microtask turn for background un-awaited promise to complete
      await new Promise((resolve) => setImmediate(resolve));

      // Admin lookup was permitted for deterministically GitHub-only user
      expect(mockGetUserById).toHaveBeenCalledWith('supa-gh-fallback');
      expect(mockTxJobCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: JOB_TYPES.GITHUB_ANALYZE,
            payload: { userId: mockUser.id, login: 'admin-fetched-octocat' },
          }),
        })
      );
    });

    it('GET /api/auth/me with GitHub signup provider but missing providers metadata prohibits Admin fallback', async () => {
      const mockUser = {
        id: 'u-auth-gh-missing-providers',
        supabaseUserId: 'supa-gh-missing-providers',
        email: 'gh-missing-providers@example.com',
        name: 'GitHub Missing Providers User',
      };

      // app_metadata has provider: 'github', but providers array is completely missing
      mockGetUser.mockResolvedValueOnce({
        data: {
          user: {
            id: 'supa-gh-missing-providers',
            email: 'gh-missing-providers@example.com',
            app_metadata: { provider: 'github' },
            identities: [],
          },
        },
        error: null,
      });

      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        ...mockUser,
        githubProfile: null,
      } as any);

      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', 'Bearer valid-supabase-token');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.githubUsername).toBeNull();
      // Admin lookup MUST be prohibited because missing providers cannot be assumed GitHub-only
      expect(mockGetUserById).not.toHaveBeenCalled();
      expect(mockTxJobCreate).not.toHaveBeenCalled();
    });

    it('GET /api/auth/me with GitHub signup provider but malformed providers metadata prohibits Admin fallback', async () => {
      const mockUser = {
        id: 'u-auth-gh-malformed-providers',
        supabaseUserId: 'supa-gh-malformed-providers',
        email: 'gh-malformed-providers@example.com',
        name: 'GitHub Malformed Providers User',
      };

      // app_metadata has provider: 'github', but providers is malformed (not an array)
      mockGetUser.mockResolvedValueOnce({
        data: {
          user: {
            id: 'supa-gh-malformed-providers',
            email: 'gh-malformed-providers@example.com',
            app_metadata: { provider: 'github', providers: 'not-an-array' },
            identities: [],
          },
        },
        error: null,
      });

      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        ...mockUser,
        githubProfile: null,
      } as any);

      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', 'Bearer valid-supabase-token');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.githubUsername).toBeNull();
      // Admin lookup MUST be prohibited for malformed providers metadata
      expect(mockGetUserById).not.toHaveBeenCalled();
      expect(mockTxJobCreate).not.toHaveBeenCalled();
    });

    it('GET /api/auth/me for GitHub + Google linked providers without verifiedLogin in token prohibits Admin fallback', async () => {
      const mockUser = {
        id: 'u-auth-gh-google-multi',
        supabaseUserId: 'supa-gh-google-multi',
        email: 'gh-google-multi@example.com',
        name: 'GitHub Google Multi User',
      };

      // Both GitHub and Google are linked providers, but token has empty identities
      mockGetUser.mockResolvedValueOnce({
        data: {
          user: {
            id: 'supa-gh-google-multi',
            email: 'gh-google-multi@example.com',
            app_metadata: { provider: 'github', providers: ['github', 'google'] },
            identities: [],
          },
        },
        error: null,
      });

      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        ...mockUser,
        githubProfile: null,
      } as any);

      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', 'Bearer valid-supabase-token');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.githubUsername).toBeNull();
      // Admin lookup MUST be prohibited because multiple providers are linked
      expect(mockGetUserById).not.toHaveBeenCalled();
      expect(mockTxJobCreate).not.toHaveBeenCalled();
    });

    it('sets isGitHubUser === false and rawProviders === [] when providers contains null (["github", null])', async () => {
      const authMiddleware = createAuthMiddleware();
      mockGetUser.mockResolvedValueOnce({
        data: {
          user: {
            id: 'supa-gh-null-user',
            email: 'ghnull@example.com',
            app_metadata: { provider: 'github', providers: ['github', null] },
            identities: [],
          },
        },
        error: null,
      });
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
        id: 'u-gh-null',
        supabaseUserId: 'supa-gh-null-user',
        email: 'ghnull@example.com',
        name: 'Null Provider',
      } as any);

      const req: any = { headers: { authorization: 'Bearer valid-token' } };
      const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      const next = vi.fn();

      await authMiddleware(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(req.user.isGitHubUser).toBe(false);
      expect(req.user.providers).toEqual([]);
    });

    it('sets isGitHubUser === false and rawProviders === [] when providers contains empty string (["github", ""])', async () => {
      const authMiddleware = createAuthMiddleware();
      mockGetUser.mockResolvedValueOnce({
        data: {
          user: {
            id: 'supa-gh-empty-user',
            email: 'ghempty@example.com',
            app_metadata: { provider: 'github', providers: ['github', ''] },
            identities: [],
          },
        },
        error: null,
      });
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
        id: 'u-gh-empty',
        supabaseUserId: 'supa-gh-empty-user',
        email: 'ghempty@example.com',
        name: 'Empty Provider',
      } as any);

      const req: any = { headers: { authorization: 'Bearer valid-token' } };
      const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      const next = vi.fn();

      await authMiddleware(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(req.user.isGitHubUser).toBe(false);
      expect(req.user.providers).toEqual([]);
    });

    it('GET /api/auth/me with providers containing ["github", null] does not silently filter invalid entries and prohibits Admin fallback', async () => {
      const mockUser = {
        id: 'u-auth-gh-null-provider',
        supabaseUserId: 'supa-gh-null-provider',
        email: 'gh-null@example.com',
        name: 'GitHub Null Provider User',
      };

      // providers contains an invalid null element
      mockGetUser.mockResolvedValueOnce({
        data: {
          user: {
            id: 'supa-gh-null-provider',
            email: 'gh-null@example.com',
            app_metadata: { provider: 'github', providers: ['github', null] },
            identities: [],
          },
        },
        error: null,
      });

      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        ...mockUser,
        githubProfile: null,
      } as any);

      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', 'Bearer valid-supabase-token');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.githubUsername).toBeNull();
      // Admin lookup MUST be prohibited because providers array contains invalid elements
      expect(mockGetUserById).not.toHaveBeenCalled();
      expect(mockTxJobCreate).not.toHaveBeenCalled();
    });

    it('GET /api/auth/me with providers containing ["github", ""] does not silently filter invalid entries and prohibits Admin fallback', async () => {
      const mockUser = {
        id: 'u-auth-gh-empty-str-provider',
        supabaseUserId: 'supa-gh-empty-str-provider',
        email: 'gh-empty-str@example.com',
        name: 'GitHub Empty String Provider User',
      };

      // providers contains an empty string element
      mockGetUser.mockResolvedValueOnce({
        data: {
          user: {
            id: 'supa-gh-empty-str-provider',
            email: 'gh-empty-str@example.com',
            app_metadata: { provider: 'github', providers: ['github', ''] },
            identities: [],
          },
        },
        error: null,
      });

      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        ...mockUser,
        githubProfile: null,
      } as any);

      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', 'Bearer valid-supabase-token');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.githubUsername).toBeNull();
      // Admin lookup MUST be prohibited because providers array contains empty string
      expect(mockGetUserById).not.toHaveBeenCalled();
      expect(mockTxJobCreate).not.toHaveBeenCalled();
    });

    it('GET /api/auth/me with missing or incomplete provider metadata fails safely without Admin lookup', async () => {
      const mockUser = {
        id: 'u-auth-no-provider',
        supabaseUserId: 'supa-no-provider',
        email: 'noprovider@example.com',
        name: 'No Provider User',
      };

      // Incomplete metadata: app_metadata has no provider, identities array is empty
      mockGetUser.mockResolvedValueOnce({
        data: {
          user: {
            id: 'supa-no-provider',
            email: 'noprovider@example.com',
            app_metadata: {},
            identities: [],
          },
        },
        error: null,
      });

      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        ...mockUser,
        githubProfile: null,
      } as any);

      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', 'Bearer valid-supabase-token');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.githubUsername).toBeNull();
      // Must NOT perform Supabase Admin lookup
      expect(mockGetUserById).not.toHaveBeenCalled();
      expect(mockTxJobCreate).not.toHaveBeenCalled();
    });

    it('GET /api/me/export includes githubProfile in data export (VM-9)', async () => {
      const mockUser = {
        id: 'u-export-1',
        name: 'Vismay Solanki',
        email: 'vismay@example.com',
        createdAt: new Date(),
        updatedAt: new Date(),
        resumes: [],
        improvementPlan: null,
        githubProfile: {
          login: 'vismay-solanki',
          contributions: [{ repoName: 'facebook/react', stars: 220000 }],
        },
        sessions: [],
      };

      mockGetUser.mockResolvedValueOnce({
        data: {
          user: {
            id: 'supa-1',
            email: 'vismay@example.com',
          },
        },
        error: null,
      });

      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser as any);

      const res = await request(app)
        .get('/api/me/export')
        .set('Authorization', 'Bearer valid-supabase-token');

      expect(res.status).toBe(200);
      expect(res.body.githubProfile).toEqual({
        login: 'vismay-solanki',
        contributions: [{ repoName: 'facebook/react', stars: 220000 }],
      });
    });
  });

  describe('7. Rate-Limit Backoff & Header Parsing', () => {
    describe('parseRateLimitHeaders', () => {
      it('correctly prefers a valid future X-RateLimit-Reset epoch seconds timestamp', () => {
        const nowMs = 1700000000000;
        const futureEpochSec = Math.floor(nowMs / 1000) + 120; // 2 minutes in future
        const result = parseRateLimitHeaders(String(futureEpochSec), '60', nowMs);

        expect(result).toBeInstanceOf(Date);
        expect(result?.getTime()).toBe(futureEpochSec * 1000);
      });

      it('falls back to Retry-After seconds if X-RateLimit-Reset is absent, non-numeric, or not in the future', () => {
        const nowMs = 1700000000000;

        // Absent reset header
        const res1 = parseRateLimitHeaders(null, '60', nowMs);
        expect(res1?.getTime()).toBe(nowMs + 60000);

        // Non-numeric reset header
        const res2 = parseRateLimitHeaders('invalid-epoch', '45', nowMs);
        expect(res2?.getTime()).toBe(nowMs + 45000);

        // Past reset header
        const pastEpochSec = Math.floor(nowMs / 1000) - 100;
        const res3 = parseRateLimitHeaders(String(pastEpochSec), '30', nowMs);
        expect(res3?.getTime()).toBe(nowMs + 30000);
      });

      it('supports Retry-After as an HTTP-date', () => {
        const nowMs = new Date('2026-11-22T10:00:00Z').getTime();
        const futureHttpDate = 'Sun, 22 Nov 2026 10:05:00 GMT';
        const result = parseRateLimitHeaders(null, futureHttpDate, nowMs);

        expect(result).toBeInstanceOf(Date);
        expect(result?.getTime()).toBe(new Date('2026-11-22T10:05:00Z').getTime());
      });

      it('returns undefined if headers are absent, non-future, negative, or invalid', () => {
        const nowMs = 1700000000000;
        expect(parseRateLimitHeaders(null, null, nowMs)).toBeUndefined();
        expect(parseRateLimitHeaders('', '', nowMs)).toBeUndefined();
        expect(parseRateLimitHeaders('-10', '-5', nowMs)).toBeUndefined();
        expect(parseRateLimitHeaders('0', '0', nowMs)).toBeUndefined();
        expect(parseRateLimitHeaders('invalid', 'not-a-date', nowMs)).toBeUndefined();
      });
    });

    describe('calculateRateLimitRetryAt', () => {
      it('uses valid future resetAt when provided', () => {
        const now = new Date('2026-11-22T12:00:00Z');
        const futureResetAt = new Date('2026-11-22T12:15:00Z');
        const retryAt = calculateRateLimitRetryAt(futureResetAt, 1, now);

        expect(retryAt.getTime()).toBe(futureResetAt.getTime());
      });

      it('falls back to bounded exponential backoff when resetAt is absent, invalid, or in the past', () => {
        const now = new Date('2026-11-22T12:00:00Z');
        const pastResetAt = new Date('2026-11-22T11:59:00Z');
        const invalidResetAt = new Date(NaN);

        // Attempt 1: 30s
        expect(calculateRateLimitRetryAt(undefined, 1, now).getTime()).toBe(now.getTime() + 30000);
        expect(calculateRateLimitRetryAt(pastResetAt, 1, now).getTime()).toBe(now.getTime() + 30000);
        expect(calculateRateLimitRetryAt(invalidResetAt, 1, now).getTime()).toBe(now.getTime() + 30000);

        // Attempt 2: 60s
        expect(calculateRateLimitRetryAt(undefined, 2, now).getTime()).toBe(now.getTime() + 60000);

        // Attempt 3: 120s
        expect(calculateRateLimitRetryAt(undefined, 3, now).getTime()).toBe(now.getTime() + 120000);

        // Attempt 4: 240s
        expect(calculateRateLimitRetryAt(undefined, 4, now).getTime()).toBe(now.getTime() + 240000);

        // Attempt 5: capped at 300s (5 minutes)
        expect(calculateRateLimitRetryAt(undefined, 5, now).getTime()).toBe(now.getTime() + 300000);

        // Attempt 10: capped at 300s
        expect(calculateRateLimitRetryAt(undefined, 10, now).getTime()).toBe(now.getTime() + 300000);
      });
    });

    describe('handleGitHubErrorResponse', () => {
      it('throws GitHubRateLimitError on 429 response with resetAt', async () => {
        const futureEpochSec = Math.floor(Date.now() / 1000) + 120;
        const res = new Response('Too Many Requests', {
          status: 429,
          headers: {
            'x-ratelimit-reset': String(futureEpochSec),
          },
        });

        await expect(handleGitHubErrorResponse(res, 'test call')).rejects.toThrow(GitHubRateLimitError);
        try {
          await handleGitHubErrorResponse(res, 'test call');
        } catch (err: any) {
          expect(err).toBeInstanceOf(GitHubRateLimitError);
          expect(err.status).toBe(429);
          expect(err.resetAt?.getTime()).toBe(futureEpochSec * 1000);
        }
      });

      it('throws GitHubRateLimitError on 403 response when remaining is 0 or body includes rate limit', async () => {
        const res1 = new Response('forbidden', {
          status: 403,
          headers: {
            'x-ratelimit-remaining': '0',
            'retry-after': '60',
          },
        });
        await expect(handleGitHubErrorResponse(res1, 'search PRs')).rejects.toThrow(GitHubRateLimitError);

        const res2 = new Response('API rate limit exceeded for IP', {
          status: 403,
        });
        await expect(handleGitHubErrorResponse(res2, 'search PRs')).rejects.toThrow(GitHubRateLimitError);
      });

      it('throws GitHubAuthError on 401 response', async () => {
        const res = new Response('Unauthorized', { status: 401 });
        await expect(handleGitHubErrorResponse(res, 'test call')).rejects.toThrow(GitHubAuthError);
      });

      it('throws GitHubUserNotFoundError on 404 response', async () => {
        const res = new Response('Not Found', { status: 404 });
        await expect(handleGitHubErrorResponse(res, 'test call')).rejects.toThrow(GitHubUserNotFoundError);
      });

      it('throws GitHubApiError on other error statuses (e.g. 500)', async () => {
        const res = new Response('Internal Server Error', { status: 500 });
        await expect(handleGitHubErrorResponse(res, 'test call')).rejects.toThrow(GitHubApiError);
      });
    });

    describe('processNextJob with rate limit errors', () => {
      it('correctly identifies rate limit error shapes with isRateLimitError', () => {
        expect(isRateLimitError(new GitHubRateLimitError('Rate limited'))).toBe(true);
        expect(isRateLimitError({ name: 'RateLimitError' })).toBe(true);
        expect(isRateLimitError({ status: 429 })).toBe(true);
        expect(isRateLimitError({ resetAt: new Date() })).toBe(true);
        expect(isRateLimitError({ resetAt: new Date(NaN) })).toBe(false);
        expect(isRateLimitError({ resetAt: new Date('invalid') })).toBe(false);
        expect(isRateLimitError({ name: 'GitHubRateLimitError', resetAt: new Date(NaN) })).toBe(true);
        expect(isRateLimitError({ status: 429, resetAt: new Date(NaN) })).toBe(true);
        expect(isRateLimitError(new Error('Generic failure'))).toBe(false);
        expect(isRateLimitError(null)).toBe(false);
      });

      const mockJob = {
        id: 'job-rl-mock',
        type: JOB_TYPES.GITHUB_ANALYZE,
        sessionId: null,
        payload: { userId: 'u1', login: 'octocat' },
        status: 'processing',
        attempts: 1,
        availableAt: new Date(),
        lockedBy: 'worker-1',
        lockedAt: new Date(),
        lastError: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      it('schedules delayed retry at resetAt when GitHubRateLimitError has future resetAt', async () => {
        vi.mocked(prisma.$transaction).mockImplementationOnce(async (cb: any) => {
          return cb({
            $executeRaw: vi.fn(),
            $queryRaw: vi.fn().mockResolvedValueOnce([{ ...mockJob, attempts: 1 }]),
          });
        });

        const futureResetAt = new Date(Date.now() + 180000);
        vi.mocked(prisma.job.update).mockResolvedValueOnce({ ...mockJob, status: 'pending' } as any);

        const result = await processNextJob('worker-test', async () => {
          throw new GitHubRateLimitError('Rate limit exceeded', futureResetAt);
        });

        expect(result).toBeNull();
        expect(prisma.job.update).toHaveBeenCalledWith({
          where: { id: mockJob.id },
          data: {
            status: 'pending',
            lastError: 'Rate limit exceeded',
            availableAt: futureResetAt,
            lockedBy: null,
            lockedAt: null,
          },
        });
      });

      it('uses bounded exponential backoff when GitHubRateLimitError has no resetAt', async () => {
        vi.mocked(prisma.$transaction).mockImplementationOnce(async (cb: any) => {
          return cb({
            $executeRaw: vi.fn(),
            $queryRaw: vi.fn().mockResolvedValueOnce([{ ...mockJob, attempts: 1 }]),
          });
        });

        vi.mocked(prisma.job.update).mockResolvedValueOnce({ ...mockJob, status: 'pending' } as any);

        const beforeMs = Date.now();
        const result = await processNextJob('worker-test', async () => {
          throw new GitHubRateLimitError('Rate limit exceeded without reset');
        });

        expect(result).toBeNull();
        expect(prisma.job.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: mockJob.id },
            data: expect.objectContaining({
              status: 'pending',
              lastError: 'Rate limit exceeded without reset',
              lockedBy: null,
              lockedAt: null,
              availableAt: expect.any(Date),
            }),
          })
        );

        const updateCall = vi.mocked(prisma.job.update).mock.calls[0]?.[0];
        const scheduledAt = (updateCall?.data as any)?.availableAt as Date;
        expect(scheduledAt.getTime() - beforeMs).toBeGreaterThanOrEqual(28000);
        expect(scheduledAt.getTime() - beforeMs).toBeLessThanOrEqual(35000);
      });

      it('marks job failed and rethrows on rate limit when attempts >= MAX_ATTEMPTS', async () => {
        vi.mocked(prisma.$transaction).mockImplementationOnce(async (cb: any) => {
          return cb({
            $executeRaw: vi.fn(),
            $queryRaw: vi.fn().mockResolvedValueOnce([{ ...mockJob, attempts: MAX_ATTEMPTS }]),
          });
        });

        vi.mocked(prisma.job.update).mockResolvedValueOnce({ ...mockJob, status: 'failed' } as any);

        await expect(
          processNextJob('worker-test', async () => {
            throw new GitHubRateLimitError('Rate limit exhausted attempts');
          })
        ).rejects.toThrow('Rate limit exhausted attempts');

        expect(prisma.job.update).toHaveBeenCalledWith({
          where: { id: mockJob.id },
          data: {
            status: 'failed',
            lastError: 'Rate limit exhausted attempts',
            lockedBy: null,
            lockedAt: null,
          },
        });
      });
    });
  });
});
