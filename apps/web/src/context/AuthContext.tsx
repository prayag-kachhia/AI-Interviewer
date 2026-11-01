import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import { deleteUserAccount, getMe } from '../lib/api';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
}

export interface AuthContextType {
  user: AuthUser | null;
  loading: boolean;
  signIn: (
    email: string,
    password: string
  ) => Promise<{ success: boolean; message?: string }>;
  signUp: (
    name: string,
    email: string,
    password: string
  ) => Promise<{ success: boolean; message?: string; exists?: boolean }>;
  signInWithGoogle: () => Promise<{ success: boolean; message?: string }>;
  signOut: () => Promise<void>;
  deleteAccount: () => Promise<{ success: boolean; message?: string }>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  signIn: async () => ({ success: false }),
  signUp: async () => ({ success: false }),
  signInWithGoogle: async () => ({ success: false }),
  signOut: async () => {},
  deleteAccount: async () => ({ success: false }),
});

const mapSupabaseUser = (supabaseUser: any): AuthUser => ({
  id: supabaseUser.id,
  email: supabaseUser.email || '',
  name:
    supabaseUser.user_metadata?.full_name ||
    supabaseUser.user_metadata?.name ||
    'Candidate',
});

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const mountedRef = useRef(true);
  const syncedUserIdRef = useRef<string | null>(null);
  const lastSyncedUserRef = useRef<AuthUser | null>(null);
  const inFlightSyncRef = useRef<string | null>(null);
  const inFlightPromiseRef = useRef<Promise<AuthUser> | null>(null);

  const resetSyncState = () => {
    syncedUserIdRef.current = null;
    lastSyncedUserRef.current = null;
    inFlightSyncRef.current = null;
    inFlightPromiseRef.current = null;
  };

  const syncUserProfile = async (
    sessionUser: any,
    fallbackUser: AuthUser
  ): Promise<AuthUser> => {
    const userId = sessionUser.id;

    if (syncedUserIdRef.current === userId && lastSyncedUserRef.current) {
      return lastSyncedUserRef.current;
    }

    if (inFlightSyncRef.current === userId && inFlightPromiseRef.current) {
      return inFlightPromiseRef.current;
    }

    inFlightSyncRef.current = userId;

    const syncPromise = (async (): Promise<AuthUser> => {
      try {
        const profile = await getMe();
        if (!mountedRef.current || inFlightSyncRef.current !== userId) return fallbackUser;

        if (profile.success && profile.data) {
          syncedUserIdRef.current = userId;
          const updatedUser: AuthUser = {
            id: userId,
            email: profile.data.email || sessionUser.email || fallbackUser.email,
            name:
              profile.data.name ||
              sessionUser.user_metadata?.full_name ||
              sessionUser.user_metadata?.name ||
              fallbackUser.name,
          };
          lastSyncedUserRef.current = updatedUser;
          if (mountedRef.current && inFlightSyncRef.current === userId) {
            setUser(updatedUser);
          }
          return updatedUser;
        } else {
          if (syncedUserIdRef.current === userId) {
            syncedUserIdRef.current = null;
          }
        }
      } catch (profileError) {
        console.warn('Application profile sync failed:', profileError);
        if (syncedUserIdRef.current === userId) {
          syncedUserIdRef.current = null;
        }
      } finally {
        if (inFlightSyncRef.current === userId) {
          inFlightSyncRef.current = null;
          inFlightPromiseRef.current = null;
        }
      }
      return fallbackUser;
    })();

    inFlightPromiseRef.current = syncPromise;
    return syncPromise;
  };

  useEffect(() => {
    let isCurrent = true;
    mountedRef.current = true;

    const initialize = async () => {
      try {
        if (!isSupabaseConfigured) {
          throw new Error('Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in apps/web/.env.local.');
        }

        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!isCurrent) return;

        if (session?.user) {
          const authUser = mapSupabaseUser(session.user);
          if (isCurrent) {
            setUser(authUser);
          }
          await syncUserProfile(session.user, authUser);
        } else {
          resetSyncState();
          if (isCurrent) {
            setUser(null);
          }
          localStorage.removeItem('selectedRole');
        }
      } catch (error) {
        console.error('Failed to initialize Supabase session:', error);
        resetSyncState();
        if (isCurrent) {
          setUser(null);
          localStorage.removeItem('selectedRole');
        }
      } finally {
        if (isCurrent) {
          setLoading(false);
        }
      }
    };

    initialize();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!isCurrent) return;

      if (session?.user) {
        if (syncedUserIdRef.current && syncedUserIdRef.current !== session.user.id) {
          resetSyncState();
        }

        const authUser = mapSupabaseUser(session.user);
        if (isCurrent) {
          setUser(authUser);
        }

        if (event === 'SIGNED_IN') {
          void syncUserProfile(session.user, authUser);
        }
      } else {
        resetSyncState();
        if (isCurrent) {
          setUser(null);
        }
        localStorage.removeItem('selectedRole');
      }

      if (event === 'SIGNED_OUT') {
        resetSyncState();
        localStorage.removeItem('selectedRole');
      }
    });

    return () => {
      isCurrent = false;
      mountedRef.current = false;
      subscription.unsubscribe();
    };
  }, []);

  /**
   * Sign in directly with Supabase Auth. No password is sent to our backend.
   * The first authenticated API call (/auth/me) also ensures the matching
   * application user row exists and is linked by supabaseUserId.
   */
  const signIn = async (email: string, password: string) => {
    try {
      if (!isSupabaseConfigured) {
        return {
          success: false,
          message: 'Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in apps/web/.env.local.',
        };
      }

      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });

      if (error) {
        return { success: false, message: error.message };
      }

      if (!data.user || !data.session) {
        return {
          success: false,
          message: 'Login succeeded but no active session was returned.',
        };
      }

      let applicationUser = mapSupabaseUser(data.user);
      if (mountedRef.current) {
        setUser(applicationUser);
      }

      applicationUser = await syncUserProfile(data.user, applicationUser);
      if (mountedRef.current) {
        setUser(applicationUser);
      }
      return { success: true };
    } catch (err: any) {
      return {
        success: false,
        message: err.message || 'Login failed',
      };
    }
  };

  /**
   * Create the authentication identity in Supabase Auth.
   * The application user row is linked by the backend after a session exists.
   */
  const signUp = async (
    name: string,
    email: string,
    password: string
  ) => {
    try {
      if (!isSupabaseConfigured) {
        return {
          success: false,
          message: 'Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in apps/web/.env.local.',
        };
      }

      const normalizedEmail = email.trim().toLowerCase();

      const { data, error } = await supabase.auth.signUp({
        email: normalizedEmail,
        password,
        options: {
          data: {
            full_name: name.trim(),
          },
          // The confirmation link returns to this web app, not Supabase's default Site URL.
          emailRedirectTo: window.location.origin,
        },
      });

      if (error) {
        return {
          success: false,
          message: error.message,
          exists: error.message.toLowerCase().includes('already'),
        };
      }

      // Supabase can return an otherwise-empty user when the email already
      // belongs to an existing account. Treat that as an existing account.
      if (data.user && data.user.identities?.length === 0) {
        return {
          success: false,
          message: 'An account with this email already exists. Please sign in.',
          exists: true,
        };
      }

      if (!data.user) {
        return {
          success: false,
          message: 'Registration failed.',
        };
      }

      // When email confirmation is enabled, Supabase intentionally returns no
      // session. Do not let a signed-out user reach the protected role picker.
      if (!data.session) {
        return {
          success: true,
          message:
            'Account created. Please confirm your email, then sign in to continue.',
        };
      }

      // Session exists, so create/link the application user row through the
      // authenticated backend endpoint before allowing access to the app.
      let applicationUser = mapSupabaseUser(data.user);
      if (name.trim()) {
        applicationUser.name = name.trim();
      }

      applicationUser = await syncUserProfile(data.user, applicationUser);
      if (!syncedUserIdRef.current) {
        await supabase.auth.signOut();
        resetSyncState();
        return {
          success: false,
          message:
            'Account was created, but the application profile could not be initialized. Please try signing in again.',
        };
      }

      if (mountedRef.current) {
        setUser(applicationUser);
      }
      return { success: true };
    } catch (err: any) {
      return {
        success: false,
        message: err.message || 'Registration failed',
      };
    }
  };

  /**
   * Initiate Google OAuth sign-in flow via Supabase.
   * Redirects user to Google OAuth consent screen, then back to /dashboard.
   */
  const signInWithGoogle = async () => {
    try {
      if (!isSupabaseConfigured) {
        return {
          success: false,
          message:
            'Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in apps/web/.env.local.',
        };
      }

      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/dashboard`,
        },
      });

      if (error) {
        return { success: false, message: error.message };
      }

      return { success: true };
    } catch (err: any) {
      return {
        success: false,
        message: err.message || 'Google sign-in failed',
      };
    }
  };

  const signOut = async () => {
    resetSyncState();
    try {
      await supabase.auth.signOut();
    } catch (err) {
      console.error('Sign out failed:', err);
    } finally {
      localStorage.removeItem('selectedRole');
      if (mountedRef.current) {
        setUser(null);
      }
    }
  };

  const deleteAccount = async () => {
    try {
      const res = await deleteUserAccount();
      resetSyncState();
      await supabase.auth.signOut();
      localStorage.removeItem('selectedRole');
      if (mountedRef.current) {
        setUser(null);
      }

      return {
        success: true,
        message: res.message,
      };
    } catch (err: any) {
      return {
        success: false,
        message:
          err.response?.data?.message || 'Failed to delete account',
      };
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        signIn,
        signUp,
        signInWithGoogle,
        signOut,
        deleteAccount,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
