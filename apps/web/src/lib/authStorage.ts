/**
 * Custom Supabase Auth storage engine for "Stay signed in" (FR-05).
 *
 * When "Stay signed in" is true:
 * - Session data is stored in window.localStorage so it persists across browser closes.
 *
 * When "Stay signed in" is false (default):
 * - Session data is stored in window.sessionStorage so it is cleared when the browser closes.
 *
 * Storage operations gracefully degrade to an in-memory map if browser storage is blocked
 * (e.g. in private browsing or high-security environments).
 */

export const AUTH_STORAGE_KEY = 'sb-ai-interviewer-auth-token';
export const STAY_SIGNED_IN_KEY = 'ai_interviewer_stay_signed_in';

// In-memory fallback
const memoryStorage = new Map<string, string>();

export function getLocalStorage(): Storage | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
  } catch {
    // Restricted or unavailable
  }
  return null;
}

export function getSessionStorage(): Storage | null {
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      return window.sessionStorage;
    }
  } catch {
    // Restricted or unavailable
  }
  return null;
}

export function safeGetItem(storage: Storage | null, key: string): string | null {
  try {
    return storage ? storage.getItem(key) : null;
  } catch {
    return null;
  }
}

export function safeSetItem(storage: Storage | null, key: string, value: string): boolean {
  try {
    if (storage) {
      storage.setItem(key, value);
      return true;
    }
  } catch {
    // Quota exceeded or storage blocked
  }
  return false;
}

export function safeRemoveItem(storage: Storage | null, key: string): void {
  try {
    storage?.removeItem(key);
  } catch {
    // Storage blocked
  }
}

/**
 * Returns whether the user has chosen to stay signed in.
 *
 * Priority:
 * 1. sessionStorage setting (active browsing context / OAuth return in same tab)
 * 2. localStorage setting (persisted user preference across browser restarts)
 * 3. Default: false (FR-05: session ends on browser close unless chosen)
 */
export function getStaySignedIn(): boolean {
  const sessionVal = safeGetItem(getSessionStorage(), STAY_SIGNED_IN_KEY);
  if (sessionVal !== null) {
    return sessionVal === 'true';
  }

  const localVal = safeGetItem(getLocalStorage(), STAY_SIGNED_IN_KEY);
  if (localVal !== null) {
    return localVal === 'true';
  }

  return false;
}

/**
 * Sets the "Stay signed in" preference and synchronizes storage:
 * - If persist is true: records preference in both localStorage and sessionStorage.
 * - If persist is false: records preference in both storages, and immediately
 *   purges any persistent session tokens from localStorage to prevent old
 *   persistent sessions from unintentionally restoring.
 */
export function setStaySignedIn(persist: boolean): void {
  const val = persist ? 'true' : 'false';
  safeSetItem(getSessionStorage(), STAY_SIGNED_IN_KEY, val);
  safeSetItem(getLocalStorage(), STAY_SIGNED_IN_KEY, val);

  if (!persist) {
    // Purge any persistent session keys from localStorage and memory fallback
    safeRemoveItem(getLocalStorage(), AUTH_STORAGE_KEY);
    safeRemoveItem(getLocalStorage(), `${AUTH_STORAGE_KEY}-code-verifier`);
    safeRemoveItem(getLocalStorage(), `${AUTH_STORAGE_KEY}-user`);
    memoryStorage.delete(AUTH_STORAGE_KEY);
  }
}

/**
 * Purge all auth-related items from both storage mechanisms.
 */
export function clearAuthStorage(): void {
  safeRemoveItem(getLocalStorage(), AUTH_STORAGE_KEY);
  safeRemoveItem(getLocalStorage(), `${AUTH_STORAGE_KEY}-code-verifier`);
  safeRemoveItem(getLocalStorage(), `${AUTH_STORAGE_KEY}-user`);
  safeRemoveItem(getSessionStorage(), AUTH_STORAGE_KEY);
  safeRemoveItem(getSessionStorage(), `${AUTH_STORAGE_KEY}-code-verifier`);
  safeRemoveItem(getSessionStorage(), `${AUTH_STORAGE_KEY}-user`);
  safeRemoveItem(getLocalStorage(), 'selectedRole');
  safeRemoveItem(getSessionStorage(), 'selectedRole');
  memoryStorage.clear();
}

/**
 * The SupportedStorage adapter interface required by Supabase Auth (GoTrue).
 */
export const authStorage = {
  getItem: (key: string): string | null => {
    // PKCE code verifiers for OAuth redirects should be checked in both sessionStorage and localStorage
    if (key.includes('-code-verifier')) {
      const sessionVerifier = safeGetItem(getSessionStorage(), key);
      if (sessionVerifier !== null) return sessionVerifier;
      const localVerifier = safeGetItem(getLocalStorage(), key);
      if (localVerifier !== null) return localVerifier;
      return memoryStorage.get(key) ?? null;
    }

    const persist = getStaySignedIn();

    if (persist) {
      // Persistent mode: read from localStorage, fallback to sessionStorage if during migration/transition
      const localVal = safeGetItem(getLocalStorage(), key);
      if (localVal !== null) return localVal;

      const sessionVal = safeGetItem(getSessionStorage(), key);
      if (sessionVal !== null) return sessionVal;
    } else {
      // Session-only mode (FR-05): ONLY read from sessionStorage
      // NEVER read from localStorage when staySignedIn is false!
      const sessionVal = safeGetItem(getSessionStorage(), key);
      if (sessionVal !== null) return sessionVal;
    }

    return memoryStorage.get(key) ?? null;
  },

  setItem: (key: string, value: string): void => {
    // PKCE code verifier is single-use and temporary: save to both so OAuth redirects in all browsers succeed
    if (key.includes('-code-verifier')) {
      const sOk = safeSetItem(getSessionStorage(), key, value);
      const lOk = safeSetItem(getLocalStorage(), key, value);
      if (!sOk && !lOk) {
        memoryStorage.set(key, value);
      } else {
        memoryStorage.delete(key);
      }
      return;
    }

    const persist = getStaySignedIn();
    let stored = false;

    if (persist) {
      stored = safeSetItem(getLocalStorage(), key, value);
      safeRemoveItem(getSessionStorage(), key);
    } else {
      stored = safeSetItem(getSessionStorage(), key, value);
      safeRemoveItem(getLocalStorage(), key);
    }

    // Only update memoryStorage if browser storage failed
    if (!stored) {
      memoryStorage.set(key, value);
    } else {
      memoryStorage.delete(key);
    }
  },

  removeItem: (key: string): void => {
    memoryStorage.delete(key);
    safeRemoveItem(getLocalStorage(), key);
    safeRemoveItem(getSessionStorage(), key);
  },
};
