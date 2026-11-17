import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router';
import { useAuth } from '../../context/AuthContext';
import { supabase, isSupabaseConfigured } from '../../lib/supabase';
import { checkPasswordStrength } from '../../lib/passwordStrength';
import { PasswordStrengthMeter } from '../../components/PasswordStrengthMeter';
import {
  Lock,
  Loader2,
  AlertCircle,
  CheckCircle2,
  ArrowRight,
  KeyRound,
} from 'lucide-react';
import { AuthHeading, AuthLayout } from '../../components/AuthLayout';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field } from '../../components/Field';

export const ResetPassword: React.FC = () => {
  const navigate = useNavigate();
  const { user, updatePassword } = useAuth();

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

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
    <AuthLayout>
      <AuthHeading icon={<KeyRound />} title="Create New Password">
        Set a strong password to secure your account.
      </AuthHeading>

      {sessionChecking ? (
        <div className="flex flex-col items-center gap-3 py-6 text-sm text-muted-foreground" role="status">
          <Loader2 className="size-8 animate-spin text-brand motion-reduce:animate-none" aria-hidden />
          <p>Verifying your reset link...</p>
        </div>
      ) : !hasValidSession && !user ? (
        <div className="flex flex-col gap-5">
          <Alert variant="error">
            <AlertCircle />
            <AlertDescription>
              This password reset link is invalid or has expired. Please request a new password reset.
            </AlertDescription>
          </Alert>
          <Button type="button" onClick={() => navigate('/login', { state: { mode: 'signin' } })}>
            <span>Back to Sign In</span>
            <ArrowRight />
          </Button>
        </div>
      ) : (
        <>
          {error && (
            <Alert variant="error">
              <AlertCircle />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {success && (
            <Alert variant="success">
              <CheckCircle2 />
              <AlertDescription>{success}</AlertDescription>
            </Alert>
          )}

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <Field
              id="new-password"
              label="New Password"
              icon={<Lock />}
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={loading || !!success}
              autoComplete="new-password"
            />

            {password.length > 0 && <PasswordStrengthMeter result={strengthResult} />}

            <div className="flex flex-col gap-2">
              <Field
                id="confirm-password"
                label="Confirm New Password"
                icon={<Lock />}
                type="password"
                placeholder="••••••••"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                disabled={loading || !!success}
                autoComplete="new-password"
              />
              {confirmPassword.length > 0 && !passwordsMatch && (
                <span className="text-xs text-destructive">Passwords do not match.</span>
              )}
            </div>

            <Button type="submit" disabled={isSubmitDisabled} className="mt-2">
              {loading ? (
                <>
                  <Loader2 className="animate-spin motion-reduce:animate-none" />
                  <span>Updating password...</span>
                </>
              ) : (
                <>
                  <span>Update Password</span>
                  <ArrowRight />
                </>
              )}
            </Button>
          </form>
        </>
      )}

      <div className="text-center">
        <Button asChild variant="ghost" size="sm" className="text-muted-foreground">
          <Link to="/login">← Return to Sign In</Link>
        </Button>
      </div>
    </AuthLayout>
  );
};
