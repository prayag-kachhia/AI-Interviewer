import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { supabase, isSupabaseConfigured } from '../../lib/supabase';
import { checkPasswordStrength } from '../../lib/passwordStrength';
import { PasswordStrengthMeter } from '../../components/PasswordStrengthMeter';
import {
  Lock,
  Eye,
  EyeOff,
  Loader2,
  AlertCircle,
  CheckCircle2,
  ArrowRight,
  Sun,
  Moon,
  KeyRound,
} from 'lucide-react';
import { Logo } from '../../components/Logo';

export const ResetPassword: React.FC = () => {
  const navigate = useNavigate();
  const { user, updatePassword } = useAuth();
  const { theme, setTheme } = useTheme();

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [loading, setLoading] = useState(false);
  const [sessionChecking, setSessionChecking] = useState(true);
  const [hasValidSession, setHasValidSession] = useState(false);

  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Password evaluation
  const strengthResult = checkPasswordStrength(password, user?.email || '');
  const passwordsMatch = password.length > 0 && password === confirmPassword;
  const isSubmitDisabled =
    loading ||
    strengthResult.strength !== 'strong' ||
    !passwordsMatch;

  // Check if a recovery session exists or arrives via token
  useEffect(() => {
    let isCurrent = true;

    const checkSession = async () => {
      try {
        if (!isSupabaseConfigured) {
          if (isCurrent) {
            setError('Supabase is not configured.');
            setSessionChecking(false);
          }
          return;
        }

        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          if (isCurrent) {
            setHasValidSession(true);
            setSessionChecking(false);
          }
          return;
        }

        // Listen for PASSWORD_RECOVERY event if token exchange is asynchronous
        const { data: { subscription } } = supabase.auth.onAuthStateChange(
          (event, session) => {
            if (!isCurrent) return;
            if (session || event === 'PASSWORD_RECOVERY') {
              setHasValidSession(true);
              setSessionChecking(false);
            }
          }
        );

        // Fallback timeout: if after 1.5s no session is found, link is likely expired
        const timer = setTimeout(() => {
          if (isCurrent && !hasValidSession) {
            setSessionChecking(false);
          }
        }, 1500);

        return () => {
          subscription.unsubscribe();
          clearTimeout(timer);
        };
      } catch (err: any) {
        if (isCurrent) {
          setError(err.message || 'Failed to verify reset link');
          setSessionChecking(false);
        }
      }
    };

    checkSession();

    return () => {
      isCurrent = false;
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (strengthResult.strength !== 'strong') {
      setError('Please choose a password that meets all security requirements.');
      return;
    }

    if (!passwordsMatch) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);

    try {
      const res = await updatePassword(password);
      if (res.success) {
        setSuccess('Your password has been reset successfully! Redirecting to login...');
        setTimeout(() => {
          navigate('/login', {
            state: {
              message: 'Your password has been updated. Please sign in with your new password.',
              mode: 'signin',
            },
          });
        }, 1800);
      } else {
        setError(res.message || 'Failed to reset password. Please try again.');
      }
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page-container">
      {/* Ambient background glow spheres */}
      <div className="auth-ambient-blobs" aria-hidden="true">
        <div className="auth-blob auth-blob-1" />
        <div className="auth-blob auth-blob-2" />
        <div className="auth-blob auth-blob-3" />
      </div>

      {/* Top Bar with Brand and Dark / Light Mode Switcher */}
      <header className="auth-top-nav">
        <Link to="/" className="auth-logo-badge" aria-label="AI Interviewer Home">
          <div className="auth-logo-icon-box">
            <Logo className="size-6 text-foreground" />
          </div>
          <span>
            AI <span className="text-gradient">Interviewer</span>
          </span>
        </Link>

        <div className="theme-segmented-control" role="group" aria-label="Theme Selector">
          <button
            type="button"
            className={`theme-segmented-btn ${theme === 'light' ? 'active' : ''}`}
            onClick={() => setTheme('light')}
            title="Switch to Light Theme"
            aria-pressed={theme === 'light'}
          >
            <Sun size={15} />
            <span>Light</span>
          </button>
          <button
            type="button"
            className={`theme-segmented-btn ${theme === 'dark' ? 'active' : ''}`}
            onClick={() => setTheme('dark')}
            title="Switch to Dark Theme"
            aria-pressed={theme === 'dark'}
          >
            <Moon size={15} />
            <span>Dark</span>
          </button>
        </div>
      </header>

      <div style={{ maxWidth: '440px', width: '100%', margin: '0 auto', zIndex: 1 }}>
        <div className="card" style={{ padding: '2.5rem 2rem', background: 'var(--surface-color)' }}>
          {/* Header */}
          <div style={{ textAlign: 'center', marginBottom: '1.75rem' }}>
            <div
              style={{
                width: '48px',
                height: '48px',
                borderRadius: '50%',
                backgroundColor: 'rgba(99, 102, 241, 0.1)',
                color: 'var(--primary-color)',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: '1rem',
              }}
            >
              <KeyRound size={24} />
            </div>
            <h2 style={{ fontSize: '1.5rem', fontWeight: 700, margin: '0 0 0.5rem 0', color: 'var(--text-main)' }}>
              Create New Password
            </h2>
            <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', margin: 0 }}>
              Set a strong password to secure your account.
            </p>
          </div>

          {sessionChecking ? (
            <div style={{ textAlign: 'center', padding: '2rem 0' }}>
              <Loader2 size={32} className="spin" style={{ animation: 'spin 1s linear infinite', color: 'var(--primary-color)' }} />
              <p style={{ marginTop: '0.75rem', fontSize: '0.875rem', color: 'var(--text-muted)' }}>
                Verifying your reset link...
              </p>
            </div>
          ) : !hasValidSession && !user ? (
            <div>
              <div className="alert alert-error" style={{ marginBottom: '1.5rem' }}>
                <AlertCircle size={20} />
                <span style={{ fontSize: '0.875rem' }}>
                  This password reset link is invalid or has expired. Please request a new password reset.
                </span>
              </div>
              <button
                type="button"
                className="btn-auth-submit"
                onClick={() => navigate('/login', { state: { mode: 'signin' } })}
              >
                <span>Back to Sign In</span>
                <ArrowRight size={16} />
              </button>
            </div>
          ) : (
            <>
              {error && (
                <div className="alert alert-error" style={{ marginBottom: '1rem' }}>
                  <AlertCircle size={18} />
                  <span style={{ fontSize: '0.875rem' }}>{error}</span>
                </div>
              )}

              {success && (
                <div className="alert alert-info" style={{ marginBottom: '1rem' }}>
                  <CheckCircle2 size={18} color="var(--primary-color)" />
                  <span style={{ fontSize: '0.875rem' }}>{success}</span>
                </div>
              )}

              <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label">New Password</label>
                  <div className="input-with-icon-wrapper">
                    <div className="input-icon-left">
                      <Lock size={18} />
                    </div>
                    <input
                      type={showPassword ? 'text' : 'password'}
                      className="form-input-aesthetic has-right-icon"
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      disabled={loading || !!success}
                      autoComplete="new-password"
                    />
                    <button
                      type="button"
                      className="input-action-btn"
                      onClick={() => setShowPassword(!showPassword)}
                      title={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </div>

                {/* Password Strength Meter */}
                {password.length > 0 && (
                  <PasswordStrengthMeter result={strengthResult} />
                )}

                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label">Confirm New Password</label>
                  <div className="input-with-icon-wrapper">
                    <div className="input-icon-left">
                      <Lock size={18} />
                    </div>
                    <input
                      type={showConfirmPassword ? 'text' : 'password'}
                      className="form-input-aesthetic has-right-icon"
                      placeholder="••••••••"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      required
                      disabled={loading || !!success}
                      autoComplete="new-password"
                    />
                    <button
                      type="button"
                      className="input-action-btn"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      title={showConfirmPassword ? 'Hide password' : 'Show password'}
                    >
                      {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                  {confirmPassword.length > 0 && !passwordsMatch && (
                    <span style={{ fontSize: '0.75rem', color: 'var(--error-color, #ef4444)', marginTop: '0.25rem', display: 'block' }}>
                      Passwords do not match.
                    </span>
                  )}
                </div>

                <button
                  type="submit"
                  className="btn-auth-submit"
                  disabled={isSubmitDisabled}
                  style={{ marginTop: '0.5rem' }}
                >
                  {loading ? (
                    <>
                      <Loader2 size={18} className="spin" style={{ animation: 'spin 1s linear infinite' }} />
                      <span>Updating password...</span>
                    </>
                  ) : (
                    <>
                      <span>Update Password</span>
                      <ArrowRight size={16} />
                    </>
                  )}
                </button>
              </form>
            </>
          )}

          <div style={{ marginTop: '1.5rem', textAlign: 'center', fontSize: '0.875rem' }}>
            <Link to="/login" style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>
              ← Return to Sign In
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};
