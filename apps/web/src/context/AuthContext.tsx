import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { loginUser, registerUser, checkUserExists, logoutUser, deleteUserAccount, getMe } from '../lib/api';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
}

export interface AuthContextType {
  user: AuthUser | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ success: boolean; message?: string; isNewUser?: boolean }>;
  signUp: (name: string, email: string, password: string) => Promise<{ success: boolean; message?: string; exists?: boolean }>;
  checkUser: (email: string) => Promise<{ exists: boolean; name?: string }>;
  signOut: () => Promise<void>;
  deleteAccount: () => Promise<{ success: boolean; message?: string }>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  signIn: async () => ({ success: false }),
  signUp: async () => ({ success: false }),
  checkUser: async () => ({ exists: false }),
  signOut: async () => {},
  deleteAccount: async () => ({ success: false }),
});

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const initialize = async () => {
      // 1. Check local storage for persistent user and token
      const savedUserStr = localStorage.getItem('user');
      const savedToken = localStorage.getItem('auth_token');

      if (savedUserStr && savedToken) {
        try {
          const parsed = JSON.parse(savedUserStr);
          setUser(parsed);
          
          // Verify with backend in the background
          getMe()
            .then(res => {
              if (res.success && res.data) {
                setUser(res.data);
                localStorage.setItem('user', JSON.stringify(res.data));
              }
            })
            .catch(() => {
              // If token expired, clear user
              localStorage.removeItem('auth_token');
              localStorage.removeItem('user');
              setUser(null);
            });
        } catch {
          localStorage.removeItem('user');
        }
      } else {
        // 2. Fallback check for Supabase session if configured
        try {
          const { data: { session } } = await supabase.auth.getSession();
          if (session?.user) {
            const mappedUser: AuthUser = {
              id: session.user.id,
              email: session.user.email || '',
              name: session.user.user_metadata?.full_name || 'Candidate',
            };
            setUser(mappedUser);
            localStorage.setItem('user', JSON.stringify(mappedUser));
          }
        } catch {
          // Ignore Supabase connection errors when using local mode
        }
      }

      setLoading(false);
    };

    initialize();

    // Listen to Supabase auth changes if active
    let subscription: any = null;
    try {
      const { data } = supabase.auth.onAuthStateChange((_event, session) => {
        if (session?.user) {
          const mappedUser: AuthUser = {
            id: session.user.id,
            email: session.user.email || '',
            name: session.user.user_metadata?.full_name || 'Candidate',
          };
          setUser(mappedUser);
          localStorage.setItem('user', JSON.stringify(mappedUser));
        }
      });
      subscription = data?.subscription;
    } catch {
      // Ignore
    }

    return () => {
      if (subscription) {
        subscription.unsubscribe();
      }
    };
  }, []);

  const checkUser = async (email: string) => {
    try {
      const res = await checkUserExists(email);
      return { exists: res.exists, name: res.name };
    } catch {
      return { exists: false };
    }
  };

  const signIn = async (email: string, password: string) => {
    try {
      const res = await loginUser(email, password);
      if (res.success && res.data) {
        localStorage.setItem('auth_token', res.data.token);
        localStorage.setItem('user', JSON.stringify(res.data.user));
        setUser(res.data.user);
        return { success: true };
      }
      return { success: false, message: res.message || 'Login failed' };
    } catch (err: any) {
      const msg = err.response?.data?.message || err.message || 'Login failed';
      const isNewUser = !!err.response?.data?.isNewUser;
      return { success: false, message: msg, isNewUser };
    }
  };

  const signUp = async (name: string, email: string, password: string) => {
    try {
      const res = await registerUser(name, email, password);
      if (res.success && res.data) {
        localStorage.setItem('auth_token', res.data.token);
        localStorage.setItem('user', JSON.stringify(res.data.user));
        setUser(res.data.user);
        return { success: true };
      }
      return { success: false, message: res.message || 'Registration failed' };
    } catch (err: any) {
      const msg = err.response?.data?.message || err.message || 'Registration failed';
      const exists = !!err.response?.data?.exists;
      return { success: false, message: msg, exists };
    }
  };

  /**
   * Safe Sign Out:
   * Keeps ALL user resumes, extracted text, and AI analysis safely preserved in the database.
   * Only destroys the current client session and local tokens.
   */
  const signOut = async () => {
    try {
      await logoutUser();
    } catch {
      // Silently ignore if offline
    }
    try {
      await supabase.auth.signOut();
    } catch {
      // Silently ignore
    }
    localStorage.removeItem('auth_token');
    localStorage.removeItem('user');
    localStorage.removeItem('selectedRole');
    setUser(null);
  };

  /**
   * Delete Account:
   * Permanently deletes that particular user and all their associated resume data.
   */
  const deleteAccount = async () => {
    try {
      const res = await deleteUserAccount();
      // Clear client session
      localStorage.removeItem('auth_token');
      localStorage.removeItem('user');
      localStorage.removeItem('selectedRole');
      try {
        await supabase.auth.signOut();
      } catch {
        // Ignore
      }
      setUser(null);
      return { success: true, message: res.message };
    } catch (err: any) {
      return { 
        success: false, 
        message: err.response?.data?.message || 'Failed to delete account' 
      };
    }
  };

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signUp, checkUser, signOut, deleteAccount }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
