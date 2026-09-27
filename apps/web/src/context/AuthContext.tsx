import React, { createContext, useContext, useEffect, useState } from 'react';
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
  signOut: () => Promise<void>;
  deleteAccount: () => Promise<{ success: boolean; message?: string }>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  signIn: async () => ({ success: false }),
  signUp: async () => ({ success: false }),
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

  useEffect(() => {
    let mounted = true;

    const initialize = async () => {
      try {
        if (!isSupabaseConfigured) {
          throw new Error('Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in frontend/.env.');
        }

        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!mounted) return;

        if (session?.user) {
          setUser(mapSupabaseUser(session.user));
        } else {
          setUser(null);
          localStorage.removeItem('selectedRole');
        }
      } catch (error) {
        console.error('Failed to initialize Supabase session:', error);
        if (mounted) {
          setUser(null);
          localStorage.removeItem('selectedRole');
        }
      } finally {
        if (mounted) setLoading(false);
      }
    };

    initialize();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (session?.user) {
        setUser(mapSupabaseUser(session.user));
      } else {
        setUser(null);
        localStorage.removeItem('selectedRole');
      }

      if (event === 'SIGNED_OUT') {
        localStorage.removeItem('selectedRole');
      }
    });

    return () => {
      mounted = false;
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
          message: 'Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in frontend/.env.',
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

      try {
        const profile = await getMe();
        if (profile.success && profile.data) {
          applicationUser = {
            id: data.user.id,
            email: profile.data.email || data.user.email || '',
            name:
              profile.data.name ||
              data.user.user_metadata?.full_name ||
              'Candidate',
          };
        }
      } catch (profileError) {
        // Authentication itself succeeded. The backend profile sync can be
        // retried by the next authenticated API request.
        console.warn('Application profile sync failed:', profileError);
      }

      setUser(applicationUser);
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
          message: 'Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in frontend/.env.',
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
      try {
        const profile = await getMe();
        if (profile.success && profile.data) {
          applicationUser = {
            id: data.user.id,
            email: profile.data.email || normalizedEmail,
            name: profile.data.name || name.trim() || 'Candidate',
          };
        }
      } catch (profileError) {
        await supabase.auth.signOut();
        return {
          success: false,
          message:
            'Account was created, but the application profile could not be initialized. Please try signing in again.',
        };
      }

      setUser(applicationUser);
      return { success: true };
    } catch (err: any) {
      return {
        success: false,
        message: err.message || 'Registration failed',
      };
    }
  };

  const signOut = async () => {
    try {
      await supabase.auth.signOut();
    } catch (err) {
      console.error('Sign out failed:', err);
    } finally {
      localStorage.removeItem('selectedRole');
      setUser(null);
    }
  };

  const deleteAccount = async () => {
    try {
      const res = await deleteUserAccount();
      await supabase.auth.signOut();
      localStorage.removeItem('selectedRole');
      setUser(null);

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
        signOut,
        deleteAccount,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
