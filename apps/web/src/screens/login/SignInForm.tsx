import React from 'react';
import { ArrowRight, Loader2, Lock, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field } from '../../components/Field';
import { GoogleButton } from './GoogleButton';
import type { AuthForm } from './useAuthForm';

const ForgotPasswordForm: React.FC<{ form: AuthForm }> = ({ form }) => (
  <form onSubmit={form.sendResetLink} className="flex flex-col gap-4">
    <div className="text-center">
      <h2 className="heading text-lg">Reset Password</h2>
      <p className="text-sm text-muted-foreground">Enter your email and we'll send you a link to reset your password.</p>
    </div>
    <Field id="reset-email" label="Email address" icon={<Mail />} type="email" placeholder="name@company.com" required value={form.email} onChange={(e) => form.setEmail(e.target.value)} />
    <Button type="submit" disabled={form.forgotLoading || !form.email.trim()}>
      {form.forgotLoading ? (
        <>
          <Loader2 className="animate-spin motion-reduce:animate-none" />
          <span>Sending reset link...</span>
        </>
      ) : (
        <>
          <span>Send Reset Link</span>
          <ArrowRight />
        </>
      )}
    </Button>
    <Button type="button" variant="ghost" size="sm" className="text-muted-foreground" onClick={() => form.showForgot(false)}>
      ← Back to Sign In
    </Button>
  </form>
);

export const SignInForm: React.FC<{ form: AuthForm }> = ({ form }) => {
  if (form.forgot) return <ForgotPasswordForm form={form} />;
  return (
    <>
      <GoogleButton loading={form.googleLoading} disabled={form.loading || form.googleLoading} onClick={form.continueWithGoogle} caption="or continue with email" />
      <form onSubmit={form.submit} className="flex flex-col gap-4">
        <Field id="signin-email" label="Email address" icon={<Mail />} type="email" placeholder="name@company.com" required value={form.email} onChange={(e) => form.setEmail(e.target.value)} />
        <Field
          id="signin-password"
          label="Password"
          icon={<Lock />}
          type="password"
          placeholder="••••••••"
          required
          value={form.password}
          onChange={(e) => form.setPassword(e.target.value)}
          labelAction={
            <Button type="button" variant="ghost" size="sm" className="h-auto p-0 text-xs" onClick={() => form.showForgot(true)}>
              Forgot password?
            </Button>
          }
        />
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="stay-signed-in"
            name="staySignedIn"
            checked={form.staySignedIn}
            onChange={(e) => form.handleStaySignedInChange(e.target.checked)}
            aria-label="Stay signed in"
            className="h-4 w-4 cursor-pointer rounded border-border accent-primary text-primary focus:ring-primary"
          />
          <label htmlFor="stay-signed-in" className="cursor-pointer text-sm text-muted-foreground select-none">
            Stay signed in
          </label>
        </div>
        <Button type="submit" disabled={form.loading || form.googleLoading}>
          {form.loading ? (
            <>
              <Loader2 className="animate-spin motion-reduce:animate-none" />
              <span>Signing in...</span>
            </>
          ) : (
            <>
              <span>Sign In to Dashboard</span>
              <ArrowRight />
            </>
          )}
        </Button>
      </form>
    </>
  );
};
