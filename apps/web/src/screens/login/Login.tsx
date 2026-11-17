import React from 'react';
import { AlertCircle, ArrowRight, CheckCircle2, LogIn, ShieldCheck, UserPlus } from 'lucide-react';
import { useNavigate } from 'react-router';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { AuthHeading, AuthLayout } from '../../components/AuthLayout';
import { SignInForm } from './SignInForm';
import { SignUpForm } from './SignUpForm';
import { useAuthForm, type Mode } from './useAuthForm';

const TABS: { mode: Mode; label: string; icon: React.ReactNode }[] = [
  { mode: 'signin', label: 'Sign In', icon: <LogIn /> },
  { mode: 'signup', label: 'Sign Up', icon: <UserPlus /> },
];

export const Login: React.FC = () => {
  const navigate = useNavigate();
  const form = useAuthForm();
  const signingIn = form.mode === 'signin';

  return (
    <AuthLayout>
      <AuthHeading icon={signingIn ? <LogIn /> : <UserPlus />} title={signingIn ? 'Welcome Back' : 'Create Account'}>
        {signingIn
          ? 'Sign in to analyze your resumes and prepare for interviews.'
          : 'Get started with automated resume analysis and interview prep.'}
      </AuthHeading>

      <div role="tablist" className="grid grid-cols-2 gap-1 rounded-md bg-secondary p-1">
        {TABS.map(({ mode, label, icon }) => (
          <Button
            key={mode}
            type="button"
            role="tab"
            size="sm"
            variant={form.mode === mode ? 'default' : 'ghost'}
            aria-selected={form.mode === mode}
            onClick={() => form.switchMode(mode)}
          >
            {icon} {label}
          </Button>
        ))}
      </div>

      {form.successMsg && (
        <Alert variant="success">
          <CheckCircle2 />
          <AlertDescription>
            <p>{form.successMsg}</p>
            {form.forgot && <p className="text-muted-foreground">Didn't receive the email? Please check your Spam or Junk folder as well.</p>}
          </AlertDescription>
        </Alert>
      )}

      {form.error && (
        <Alert variant="error">
          <AlertCircle />
          <AlertDescription className="flex flex-col gap-3">
            <p>{form.error}</p>
            {signingIn && form.unverifiedEmail && (
              <Button type="button" size="sm" onClick={() => navigate('/verify-email', { state: { email: form.unverifiedEmail } })}>
                <span>Enter Verification Code</span>
                <ArrowRight />
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}

      {signingIn ? <SignInForm form={form} /> : <SignUpForm form={form} />}

      <p className="text-center text-sm text-muted-foreground">
        {signingIn ? "Don't have an account? " : 'Already registered? '}
        <Button type="button" variant="ghost" size="sm" className="ml-1 h-auto p-0 font-semibold text-foreground underline" onClick={() => form.switchMode(signingIn ? 'signup' : 'signin')}>
          {signingIn ? 'Sign up now' : 'Sign In'}
        </Button>
      </p>

      {!signingIn && (
        <div className="flex items-center justify-center gap-2 border-t border-border pt-4 text-center text-xs text-muted-foreground">
          <ShieldCheck className="size-4 shrink-0 text-success" aria-hidden />
          <span>Your profile data and uploaded resumes are private &amp; encrypted.</span>
        </div>
      )}
    </AuthLayout>
  );
};
