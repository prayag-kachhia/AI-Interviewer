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
} from '../services/github.service';
import {
  JOB_TYPES,
  DAILY_GITHUB_REFRESH_MS,
  isEligibleForDailyGithubRefresh,
  maybeEnqueueGithubAnalysis,
  triggerGithubAnalysisIfLinked,
  processNextJob,
  isTransientError,
  MAX_ATTEMPTS,
} from '../services/job-queue.service';
import { handleJob } from '../worker';
import request from 'supertest';
import app from '../server';

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
            findFirst: vi.fn().mockResolvedValue(null),
            findMany: vi.fn().mockResolvedValue([
              {
                id: 'pending-job-vismay',
                type: JOB_TYPES.GITHUB_ANALYZE,
                status: 'pending',
                payload: { userId: 'u-vismay', login: 'Vismay24' },
              },
            ]),
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
            findFirst: vi.fn().mockResolvedValue(null),
            findMany: vi.fn().mockResolvedValue([
              {
                id: 'processing-job-octocat',
                type: JOB_TYPES.GITHUB_ANALYZE,
                status: 'processing',
                payload: { userId: 'u-octo', login: 'OCTOCAT' },
              },
            ]),
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
            findMany: vi.fn().mockResolvedValue([
              {
                id: 'old-job-pending-distinct',
                type: JOB_TYPES.GITHUB_ANALYZE,
                status: 'pending',
                payload: { userId: 'u-switch-distinct', login: 'old-octocat' },
              },
            ]),
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
            findMany: vi.fn().mockResolvedValue([]),
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

      mockGetUserById.mockResolvedValueOnce({
        data: {
          user: {
            id: 'supa-google-only',
            identities: [{ provider: 'google', identity_data: { email: 'googleonly@example.com' } }],
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

      mockGetUserById.mockResolvedValueOnce({
        data: {
          user: {
            id: 'supa-stale-user',
            identities: [{ provider: 'google', identity_data: { email: 'stale@example.com' } }],
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
});
