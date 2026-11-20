import '@testing-library/jest-dom/vitest';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { AuthProvider, useAuth } from './AuthContext';
import { getStaySignedIn, clearAuthStorage, STAY_SIGNED_IN_KEY } from '../lib/authStorage';

const mockGetSession = vi.fn();
const mockOnAuthStateChange = vi.fn();
const mockSignInWithOAuth = vi.fn();
const mockLinkIdentity = vi.fn();
const mockGetUserIdentities = vi.fn();
const mockGetUser = vi.fn();
const mockSignOut = vi.fn();

let mockIsSupabaseConfigured = true;

vi.mock('../lib/supabase', () => ({
  get isSupabaseConfigured() {
    return mockIsSupabaseConfigured;
  },
  supabase: {
    auth: {
      getSession: () => mockGetSession(),
      onAuthStateChange: (cb: any) => mockOnAuthStateChange(cb),
      signInWithOAuth: (params: any) => mockSignInWithOAuth(params),
      linkIdentity: (params: any) => mockLinkIdentity(params),
      getUserIdentities: () => mockGetUserIdentities(),
      getUser: () => mockGetUser(),
      signOut: () => mockSignOut(),
    },
  },
}));

vi.mock('../lib/api', () => ({
  getMe: vi.fn().mockResolvedValue({
    success: true,
    data: { id: 'u1', email: 'test@example.com', name: 'Test User' },
  }),
  deleteUserAccount: vi.fn().mockResolvedValue({ success: true }),
}));

const wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <AuthProvider>{children}</AuthProvider>
);

describe('AuthContext - GitHub OAuth and Identity Linking', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsSupabaseConfigured = true;
    localStorage.clear();
    sessionStorage.clear();
    clearAuthStorage();

    mockGetSession.mockResolvedValue({
      data: { session: null },
      error: null,
    });
    mockOnAuthStateChange.mockReturnValue({
      data: { subscription: { unsubscribe: vi.fn() } },
    });
    mockSignInWithOAuth.mockResolvedValue({ error: null });
    mockLinkIdentity.mockResolvedValue({ data: { url: 'https://github.com/login/oauth/authorize' }, error: null });
    mockGetUserIdentities.mockResolvedValue({
      data: { identities: [] },
      error: null,
    });
  });

  describe('signInWithGitHub', () => {
    it('initiates OAuth flow with provider "github" and dashboard redirect', async () => {
      const { result } = renderHook(() => useAuth(), { wrapper });

      let response: any;
      await act(async () => {
        response = await result.current.signInWithGitHub(false);
      });

      expect(response).toEqual({ success: true });
      expect(mockSignInWithOAuth).toHaveBeenCalledWith({
        provider: 'github',
        options: {
          redirectTo: expect.stringContaining('/dashboard'),
        },
      });
      expect(getStaySignedIn()).toBe(false);
    });

    it('preserves staySignedIn: true when requested', async () => {
      const { result } = renderHook(() => useAuth(), { wrapper });

      let response: any;
      await act(async () => {
        response = await result.current.signInWithGitHub(true);
      });

      expect(response).toEqual({ success: true });
      expect(getStaySignedIn()).toBe(true);
      expect(localStorage.getItem(STAY_SIGNED_IN_KEY)).toBe('true');
    });

    it('returns error when Supabase is not configured', async () => {
      mockIsSupabaseConfigured = false;
      const { result } = renderHook(() => useAuth(), { wrapper });

      let response: any;
      await act(async () => {
        response = await result.current.signInWithGitHub();
      });

      expect(response.success).toBe(false);
      expect(response.message).toContain('Supabase is not configured');
      expect(mockSignInWithOAuth).not.toHaveBeenCalled();
    });

    it('returns error when signInWithOAuth fails', async () => {
      mockSignInWithOAuth.mockResolvedValueOnce({
        error: { message: 'Provider disabled in dashboard' },
      });

      const { result } = renderHook(() => useAuth(), { wrapper });

      let response: any;
      await act(async () => {
        response = await result.current.signInWithGitHub();
      });

      expect(response).toEqual({
        success: false,
        message: 'Provider disabled in dashboard',
      });
    });
  });

  describe('linkGitHubIdentity', () => {
    it('calls linkIdentity with provider "github" and profile redirect when user is authenticated', async () => {
      mockGetSession.mockResolvedValue({
        data: {
          session: {
            user: { id: 'u1', email: 'user@example.com' },
          },
        },
        error: null,
      });

      const { result } = renderHook(() => useAuth(), { wrapper });

      let response: any;
      await act(async () => {
        response = await result.current.linkGitHubIdentity();
      });

      expect(response.success).toBe(true);
      expect(mockLinkIdentity).toHaveBeenCalledWith({
        provider: 'github',
        options: {
          redirectTo: expect.stringContaining('/profile'),
        },
      });
    });

    it('fails when user is not authenticated', async () => {
      mockGetSession.mockResolvedValue({
        data: { session: null },
        error: null,
      });

      const { result } = renderHook(() => useAuth(), { wrapper });

      let response: any;
      await act(async () => {
        response = await result.current.linkGitHubIdentity();
      });

      expect(response.success).toBe(false);
      expect(response.message).toContain('must be signed in');
      expect(mockLinkIdentity).not.toHaveBeenCalled();
    });

    it('handles linkIdentity errors, including identity already linked', async () => {
      mockGetSession.mockResolvedValue({
        data: {
          session: {
            user: { id: 'u1', email: 'user@example.com' },
          },
        },
        error: null,
      });
      mockLinkIdentity.mockResolvedValueOnce({
        error: { message: 'Identity is already linked to another user' },
      });

      const { result } = renderHook(() => useAuth(), { wrapper });

      let response: any;
      await act(async () => {
        response = await result.current.linkGitHubIdentity();
      });

      expect(response).toEqual({
        success: false,
        message: 'Identity is already linked to another user',
      });
    });
  });

  describe('refreshIdentities', () => {
    it('fetches fresh identities and populates user.githubUsername from verified identity', async () => {
      const mockSessionUser = {
        id: 'u1',
        email: 'user@example.com',
        user_metadata: { full_name: 'Test Candidate' },
      };

      mockGetSession.mockResolvedValue({
        data: {
          session: { user: mockSessionUser },
        },
        error: null,
      });

      mockGetUserIdentities.mockResolvedValue({
        data: {
          identities: [
            {
              id: 'id-gh',
              identity_id: 'gh-123',
              provider: 'github',
              identity_data: { user_name: 'octocat-verified' },
            },
          ],
        },
        error: null,
      });

      const { result } = renderHook(() => useAuth(), { wrapper });

      await act(async () => {
        await result.current.refreshIdentities();
      });

      expect(result.current.user?.githubUsername).toBe('octocat-verified');
      expect(result.current.user?.identities?.length).toBe(1);
      expect(result.current.user?.identities?.[0].provider).toBe('github');
    });

    it('maintains a stable function reference across re-renders', async () => {
      const { result, rerender } = renderHook(() => useAuth(), { wrapper });

      const firstRef = result.current.refreshIdentities;
      rerender();
      const secondRef = result.current.refreshIdentities;

      expect(firstRef).toBe(secondRef);
    });
  });
});
