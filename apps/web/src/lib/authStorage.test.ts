import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  authStorage,
  AUTH_STORAGE_KEY,
  STAY_SIGNED_IN_KEY,
  getStaySignedIn,
  setStaySignedIn,
  clearAuthStorage,
  safeGetItem,
  safeSetItem,
  safeRemoveItem,
} from './authStorage';

describe('authStorage engine (FR-05: Stay signed in)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    clearAuthStorage();
  });

  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    clearAuthStorage();
    vi.restoreAllMocks();
  });

  describe('Preference tracking (getStaySignedIn / setStaySignedIn)', () => {
    it('defaults to false when no preference is set (FR-05 default)', () => {
      expect(getStaySignedIn()).toBe(false);
    });

    it('returns true when setStaySignedIn(true) is called', () => {
      setStaySignedIn(true);
      expect(getStaySignedIn()).toBe(true);
      expect(localStorage.getItem(STAY_SIGNED_IN_KEY)).toBe('true');
      expect(sessionStorage.getItem(STAY_SIGNED_IN_KEY)).toBe('true');
    });

    it('returns false when setStaySignedIn(false) is called and cleans up persistent storage', () => {
      // First enable it and set a dummy token in localStorage
      setStaySignedIn(true);
      localStorage.setItem(AUTH_STORAGE_KEY, 'stale-token');
      localStorage.setItem(`${AUTH_STORAGE_KEY}-code-verifier`, 'stale-verifier');

      // Now disable it
      setStaySignedIn(false);
      expect(getStaySignedIn()).toBe(false);
      expect(sessionStorage.getItem(STAY_SIGNED_IN_KEY)).toBe('false');
      expect(localStorage.getItem(STAY_SIGNED_IN_KEY)).toBe('false');

      // Stale tokens must be purged from localStorage immediately
      expect(localStorage.getItem(AUTH_STORAGE_KEY)).toBeNull();
      expect(localStorage.getItem(`${AUTH_STORAGE_KEY}-code-verifier`)).toBeNull();
    });
  });

  describe('Unchecked mode (staySignedIn = false): sessionStorage persistence', () => {
    beforeEach(() => {
      setStaySignedIn(false);
    });

    it('writes session tokens to sessionStorage and removes them from localStorage', () => {
      localStorage.setItem(AUTH_STORAGE_KEY, 'old-leak');

      authStorage.setItem(AUTH_STORAGE_KEY, '{"access_token":"session-jwt"}');

      expect(sessionStorage.getItem(AUTH_STORAGE_KEY)).toBe('{"access_token":"session-jwt"}');
      expect(localStorage.getItem(AUTH_STORAGE_KEY)).toBeNull();
    });

    it('reads session token exclusively from sessionStorage and NEVER from localStorage', () => {
      sessionStorage.setItem(AUTH_STORAGE_KEY, 'session-token');
      localStorage.setItem(AUTH_STORAGE_KEY, 'persistent-token');

      // Must read from sessionStorage
      expect(authStorage.getItem(AUTH_STORAGE_KEY)).toBe('session-token');

      // If sessionStorage is empty, must NOT fall back to localStorage when unchecked
      sessionStorage.removeItem(AUTH_STORAGE_KEY);
      expect(authStorage.getItem(AUTH_STORAGE_KEY)).toBeNull();
    });

    it('simulates browser close and reopen: session is ended because sessionStorage is cleared', () => {
      // User signs in with unchecked mode
      authStorage.setItem(AUTH_STORAGE_KEY, '{"access_token":"temp-jwt"}');
      expect(authStorage.getItem(AUTH_STORAGE_KEY)).toBe('{"access_token":"temp-jwt"}');

      // Simulate closing the browser: sessionStorage is completely wiped by the OS/browser
      sessionStorage.clear();

      // Upon reopening the browser, session is gone
      expect(authStorage.getItem(AUTH_STORAGE_KEY)).toBeNull();
    });

    it('simulates page reload (F5): session remains in sessionStorage within the same browsing session', () => {
      authStorage.setItem(AUTH_STORAGE_KEY, '{"access_token":"temp-jwt"}');

      // Page refresh retains sessionStorage
      expect(sessionStorage.getItem(AUTH_STORAGE_KEY)).toBe('{"access_token":"temp-jwt"}');
      expect(authStorage.getItem(AUTH_STORAGE_KEY)).toBe('{"access_token":"temp-jwt"}');
    });
  });

  describe('Checked mode (staySignedIn = true): localStorage persistence', () => {
    beforeEach(() => {
      setStaySignedIn(true);
    });

    it('writes session tokens to localStorage and removes them from sessionStorage', () => {
      sessionStorage.setItem(AUTH_STORAGE_KEY, 'duplicate-temp');

      authStorage.setItem(AUTH_STORAGE_KEY, '{"access_token":"persistent-jwt"}');

      expect(localStorage.getItem(AUTH_STORAGE_KEY)).toBe('{"access_token":"persistent-jwt"}');
      expect(sessionStorage.getItem(AUTH_STORAGE_KEY)).toBeNull();
    });

    it('reads session token from localStorage', () => {
      localStorage.setItem(AUTH_STORAGE_KEY, 'persistent-token');
      expect(authStorage.getItem(AUTH_STORAGE_KEY)).toBe('persistent-token');
    });

    it('simulates browser close and reopen: session is preserved in localStorage', () => {
      // User signs in with checked mode
      authStorage.setItem(AUTH_STORAGE_KEY, '{"access_token":"persistent-jwt"}');

      // Simulate closing the browser: sessionStorage is wiped
      sessionStorage.clear();

      // Upon reopening browser, localStorage still has session and staySignedIn preference is restored
      expect(getStaySignedIn()).toBe(true);
      expect(authStorage.getItem(AUTH_STORAGE_KEY)).toBe('{"access_token":"persistent-jwt"}');
    });
  });

  describe('Switching modes & storage cleanup', () => {
    it('cleans up persistent session when switching from checked to unchecked', () => {
      // Sign in with checked
      setStaySignedIn(true);
      authStorage.setItem(AUTH_STORAGE_KEY, 'user-session');
      expect(localStorage.getItem(AUTH_STORAGE_KEY)).toBe('user-session');

      // User disables stay signed in
      setStaySignedIn(false);
      expect(localStorage.getItem(AUTH_STORAGE_KEY)).toBeNull();
      expect(authStorage.getItem(AUTH_STORAGE_KEY)).toBeNull();
    });

    it('clearAuthStorage removes all auth keys from both localStorage and sessionStorage', () => {
      localStorage.setItem(AUTH_STORAGE_KEY, 'token1');
      localStorage.setItem(`${AUTH_STORAGE_KEY}-code-verifier`, 'verifier1');
      sessionStorage.setItem(AUTH_STORAGE_KEY, 'token2');
      sessionStorage.setItem(`${AUTH_STORAGE_KEY}-code-verifier`, 'verifier2');
      localStorage.setItem('selectedRole', 'frontend-engineer');
      sessionStorage.setItem('selectedRole', 'frontend-engineer');

      clearAuthStorage();

      expect(localStorage.getItem(AUTH_STORAGE_KEY)).toBeNull();
      expect(localStorage.getItem(`${AUTH_STORAGE_KEY}-code-verifier`)).toBeNull();
      expect(sessionStorage.getItem(AUTH_STORAGE_KEY)).toBeNull();
      expect(sessionStorage.getItem(`${AUTH_STORAGE_KEY}-code-verifier`)).toBeNull();
      expect(localStorage.getItem('selectedRole')).toBeNull();
      expect(sessionStorage.getItem('selectedRole')).toBeNull();
    });

    it('authStorage.removeItem clears key from both storages', () => {
      localStorage.setItem('test-key', 'val1');
      sessionStorage.setItem('test-key', 'val2');

      authStorage.removeItem('test-key');

      expect(localStorage.getItem('test-key')).toBeNull();
      expect(sessionStorage.getItem('test-key')).toBeNull();
    });
  });

  describe('Google OAuth and PKCE code verifier handling', () => {
    it('stores and retrieves code verifiers across redirects in both modes', () => {
      const verifierKey = `${AUTH_STORAGE_KEY}-code-verifier`;

      // In unchecked mode
      setStaySignedIn(false);
      authStorage.setItem(verifierKey, 'oauth-verifier-secret-123');
      expect(authStorage.getItem(verifierKey)).toBe('oauth-verifier-secret-123');

      // In checked mode
      setStaySignedIn(true);
      authStorage.setItem(verifierKey, 'oauth-verifier-secret-456');
      expect(authStorage.getItem(verifierKey)).toBe('oauth-verifier-secret-456');

      // Cleanup removes it
      authStorage.removeItem(verifierKey);
      expect(authStorage.getItem(verifierKey)).toBeNull();
    });
  });

  describe('Graceful error handling (storage restricted / quota exceeded)', () => {
    it('handles getItem errors gracefully without throwing', () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new DOMException('Access denied', 'SecurityError');
      });

      expect(safeGetItem(localStorage, 'any-key')).toBeNull();
      expect(authStorage.getItem('any-key')).toBeNull();
    });

    it('handles setItem errors gracefully and falls back to memory storage', () => {
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new DOMException('Quota exceeded', 'QuotaExceededError');
      });

      expect(() => {
        safeSetItem(localStorage, 'any-key', 'any-val');
      }).not.toThrow();

      expect(() => {
        authStorage.setItem('fallback-key', 'in-memory-val');
      }).not.toThrow();

      // Memory storage holds the value during runtime
      expect(authStorage.getItem('fallback-key')).toBe('in-memory-val');
    });

    it('handles removeItem errors gracefully without throwing', () => {
      vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
        throw new DOMException('Storage disabled', 'SecurityError');
      });

      expect(() => {
        safeRemoveItem(localStorage, 'any-key');
      }).not.toThrow();

      expect(() => {
        authStorage.removeItem('any-key');
      }).not.toThrow();
    });
  });
});
