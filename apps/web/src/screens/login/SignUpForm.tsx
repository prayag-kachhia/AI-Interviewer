import React from 'react';
import { ArrowRight, Loader2, Lock, Mail, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field } from '../../components/Field';
import { PasswordStrengthMeter } from '../../components/PasswordStrengthMeter';
import { GoogleButton } from './GoogleButton';
import type { AuthForm } from './useAuthForm';

export const SignUpForm: React.FC<{ form: AuthForm }> = ({ form }) => (
  <>
    <GoogleButton loading={form.googleLoading} disabled={form.loading || form.googleLoading} onClick={form.continueWithGoogle} caption="or create account with email" />
    <form onSubmit={form.submit} className="flex flex-col gap-4">
      <Field id="signup-name" label="Full Name" icon={<User />} type="text" placeholder="Jane Doe" required value={form.name} onChange={(e) => form.setName(e.target.value)} />
      <Field id="signup-email" label="Email address" icon={<Mail />} type="email" placeholder="name@company.com" required value={form.email} onChange={(e) => form.setEmail(e.target.value)} />
      <Field id="signup-password" label="Password" icon={<Lock />} type="password" placeholder="Create a strong password" required value={form.password} onChange={(e) => form.setPassword(e.target.value)} />

      {form.password.length > 0 && <PasswordStrengthMeter result={form.strengthResult} />}

      <div className="flex flex-col gap-2">
        <Field id="signup-confirm" label="Confirm Password" icon={<Lock />} type="password" placeholder="Re-enter password" required value={form.confirmPassword} onChange={(e) => form.setConfirmPassword(e.target.value)} />
        {form.confirmPassword.length > 0 && !form.passwordsMatch && <span className="text-xs text-destructive">Passwords do not match.</span>}
      </div>

      <Button type="submit" disabled={form.loading || form.googleLoading || !form.isSignUpValid}>
        {form.loading ? (
          <>
            <Loader2 className="animate-spin motion-reduce:animate-none" />
            <span>Creating account...</span>
          </>
        ) : (
          <>
            <span>Create Free Account</span>
            <ArrowRight />
          </>
        )}
      </Button>
    </form>
  </>
);
