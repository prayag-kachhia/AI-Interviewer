import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import { deleteUserAccount, getMe } from '../lib/api';
import { getStaySignedIn, setStaySignedIn, clearAuthStorage } from '../lib/authStorage';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  isAdmin?: boolean;
}

export interface AuthContextType {
  user: AuthUser | null;
  loading: boolean;
  staySignedIn: boolean;
  setStaySignedIn: (persist: boolean) => void;
  signIn: (
    email: string,
    password: string,
    staySignedIn?: boolean
  ) => Promise<{ success: boolean; message?: string; needsVerification?: boolean; email?: string }>;
  signUp: (
    name: string,
    email: string,
    password: string
  ) => Promise<{
    success: boolean;
    message?: string;
    exists?: boolean;
    needsVerification?: boolean;
    email?: string;
  }>;
  signInWithGoogle: (staySignedIn?: boolean) => Promise<{ success: boolean; message?: string }>;
  signOut: () => Promise<void>;
  deleteAccount: () => Promise<{ success: boolean; message?: string }>;
  resetPasswordForEmail: (
    email: string
  ) => Promise<{ success: boolean; message?: string }>;
  updatePassword: (
    newPassword: string
  ) => Promise<{ success: boolean; message?: string }>;
  verifyOtp: (
    email: string,
    token: string
  ) => Promise<{ success: boolean; message?: string }>;
  resendOtp: (
    email: string
  ) => Promise<{ success: boolean; message?: string }>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  staySignedIn: false,
  setStaySignedIn: () => { },
  signIn: async () => ({ success: false }),
  signUp: async () => ({ success: false }),
  signInWithGoogle: async () => ({ success: false }),
  signOut: async () => { },
  deleteAccount: async () => ({ success: false }),
  resetPasswordForEmail: async () => ({ success: false }),
  updatePassword: async () => ({ success: false }),
  verifyOtp: async () => ({ success: false }),
  resendOtp: async () => ({ success: false }),
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
  const [staySignedIn, setStaySignedInState] = useState<boolean>(() => getStaySignedIn());

  const handleSetStaySignedIn = (persist: boolean) => {
    setStaySignedIn(persist);
    setStaySignedInState(persist);
  };

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
            isAdmin: Boolean(profile.data.isAdmin),
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
        clearAuthStorage();
        localStorage.removeItem('selectedRole');
        sessionStorage.removeItem('selectedRole');
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
  const signIn = async (email: string, password: string, staySignedInParam?: boolean) => {
    try {
      if (typeof staySignedInParam === 'boolean') {
        handleSetStaySignedIn(staySignedInParam);
      }

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
        const isUnconfirmed =
          error.message.toLowerCase().includes('email not confirmed') ||
          error.message.toLowerCase().includes('not confirmed');
        return {
          success: false,
          message: isUnconfirmed
            ? 'Your email address has not been verified yet. Please enter the verification code sent to your email.'
            : error.message,
          needsVerification: isUnconfirmed,
          email: email.trim().toLowerCase(),
        };
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
        // If the error reveals that an account is already registered,
        // normalize to a secure anti-enumeration response.
        if (error.message.toLowerCase().includes('already')) {
          return {
            success: true,
            needsVerification: true,
            email: normalizedEmail,
            message:
              'Please enter the 6-digit verification code sent to your email. If you already have an account, you can return to sign in.',
          };
        }
        return {
          success: false,
          message: error.message,
        };
      }

      // Supabase returns an empty identities array when the email already
      // belongs to an existing account (anti-enumeration mode).
      // Return a uniform verification response to protect user privacy.
      if (data.user && data.user.identities?.length === 0) {
        return {
          success: true,
          needsVerification: true,
          email: normalizedEmail,
          message:
            'Please enter the 6-digit verification code sent to your email. If you already have an account, you can return to sign in.',
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
          needsVerification: true,
          email: normalizedEmail,
          message:
            'Please enter the 6-digit verification code sent to your email. If you already have an account, you can return to sign in.',
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
  const signInWithGoogle = async (staySignedInParam?: boolean) => {
    try {
      if (typeof staySignedInParam === 'boolean') {
        handleSetStaySignedIn(staySignedInParam);
      }

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
      clearAuthStorage();
      localStorage.removeItem('selectedRole');
      sessionStorage.removeItem('selectedRole');
      if (mountedRef.current) {
        setUser(null);
      }
    }
  };
  const deleteAccount = async () => {
    try {
      const res = await deleteUserAccount();

      resetSyncState();

      try {
        await supabase.auth.signOut();
      } catch (err) {
        console.error('Sign out after account deletion failed:', err);
      } finally {
        clearAuthStorage();
        localStorage.removeItem('selectedRole');
        sessionStorage.removeItem('selectedRole');

        if (mountedRef.current) {
          setUser(null);
        }
      }

      return {
        success: true,
        message: res.message,
      };
    } catch (err: any) {
      return {
        success: false,
        message:
          err.response?.data?.message || err.message || 'Failed to delete account',
      };
    }
  };

  /**
   * Request a password reset link for the given email address.
   * Supabase Auth sends an email containing a recovery token pointing to /reset-password.
   */
  const resetPasswordForEmail = async (email: string) => {
    try {
      if (!isSupabaseConfigured) {
        return {
          success: false,
          message:
            'Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in apps/web/.env.local.',
        };
      }

      const redirectTo = `${window.location.origin}/reset-password`;
      const { error } = await supabase.auth.resetPasswordForEmail(
        email.trim().toLowerCase(),
        {
          redirectTo,
        }
      );

      if (error) {
        return {
          success: false,
          message: error.message,
        };
      }

      return {
        success: true,
        message: 'If an account exists for that email, a password reset link has been sent.',
      };
    } catch (err: any) {
      return {
        success: false,
        message: err.message || 'Failed to send password reset email',
      };
    }
  };

  /**
   * Update the user's password using the active session / recovery session.
   */
  const updatePassword = async (newPassword: string) => {
    try {
      if (!isSupabaseConfigured) {
        return {
          success: false,
          message:
            'Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in apps/web/.env.local.',
        };
      }

      const { data, error } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (error) {
        return {
          success: false,
          message: error.message,
        };
      }

      if (!data.user) {
        return {
          success: false,
          message: 'Failed to update password.',
        };
      }

      return {
        success: true,
        message: 'Your password has been reset successfully.',
      };
    } catch (err: any) {
      return {
        success: false,
        message: err.message || 'Failed to update password',
      };
    }
  };

  /**
   * Verify a 6-digit email signup confirmation OTP code.
   * On success, Supabase creates a verified session, and the user profile is synced.
   */
  const verifyOtp = async (email: string, token: string) => {
    try {
      if (!isSupabaseConfigured) {
        return {
          success: false,
          message:
            'Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in apps/web/.env.local.',
        };
      }

      const normalizedEmail = email.trim().toLowerCase();
      const cleanToken = token.trim();

      const { data, error } = await supabase.auth.verifyOtp({
        email: normalizedEmail,
        token: cleanToken,
        type: 'email',
      });

      if (error) {
        return {
          success: false,
          message: error.message || 'Invalid or expired verification code.',
        };
      }

      if (!data.user || !data.session) {
        return {
          success: false,
          message: 'Verification succeeded but no active session was established.',
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
        message: err.message || 'Verification failed. Please try again.',
      };
    }
  };

  /**
   * Resend the 6-digit email signup confirmation OTP code.
   */
  const resendOtp = async (email: string) => {
    try {
      if (!isSupabaseConfigured) {
        return {
          success: false,
          message:
            'Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in apps/web/.env.local.',
        };
      }

      const normalizedEmail = email.trim().toLowerCase();

      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: normalizedEmail,
      });

      if (error) {
        // If the email is already confirmed or registered, do not leak enumeration details
        const isAlreadyConfirmed =
          error.message.toLowerCase().includes('already') ||
          error.message.toLowerCase().includes('confirmed');
        if (isAlreadyConfirmed) {
          return {
            success: true,
            message:
              'If this email is unverified, a new code has been sent. If you already have an account, please sign in.',
          };
        }

        return {
          success: false,
          message: error.message || 'Failed to resend verification code.',
        };
      }

      return {
        success: true,
        message: 'A new 6-digit verification code has been sent to your email.',
      };
    } catch (err: any) {
      return {
        success: false,
        message: err.message || 'Failed to resend verification code.',
      };
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        staySignedIn,
        setStaySignedIn: handleSetStaySignedIn,
        signIn,
        signUp,
        signInWithGoogle,
        signOut,
        deleteAccount,
        resetPasswordForEmail,
        updatePassword,
        verifyOtp,
        resendOtp,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
