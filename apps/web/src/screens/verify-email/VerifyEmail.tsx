import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation, Link } from 'react-router';
import { useAuth } from '../../context/AuthContext';
import { validateEmail } from '../../lib/emailValidation';
import {
  Mail,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ArrowRight,
  ShieldCheck,
  RefreshCw,
  Edit2,
} from 'lucide-react';
import { AuthHeading, AuthLayout } from '../../components/AuthLayout';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export const VerifyEmail: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { verifyOtp, resendOtp, user } = useAuth();

  // Email state from navigation state or search query param
  const queryParams = new URLSearchParams(location.search);
  const initialEmail = location.state?.email || queryParams.get('email') || '';
  const [email, setEmail] = useState<string>(initialEmail);
  const [isEditingEmail, setIsEditingEmail] = useState<boolean>(!initialEmail);

  // 6-digit OTP boxes
  const [otp, setOtp] = useState<string[]>(['', '', '', '', '', '']);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Status feedback
  const [loading, setLoading] = useState<boolean>(false);
  const [resending, setResending] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [successMsg, setSuccessMsg] = useState<string>(
    location.state?.message || ''
  );

  // 60-second cooldown timer for resend
  const [cooldown, setCooldown] = useState<number>(60);

  // Focus the first empty box on mount
  useEffect(() => {
    if (!isEditingEmail && inputRefs.current[0]) {
      inputRefs.current[0]?.focus();
    }
  }, [isEditingEmail]);

  // If user is already authenticated and verified, redirect to dashboard or new-interview
  useEffect(() => {
    if (user) {
      const selectedRole = localStorage.getItem('selectedRole');
      if (selectedRole) {
        navigate('/dashboard');
      } else {
        navigate('/new-interview');
      }
    }
  }, [user, navigate]);

  // Cooldown countdown timer
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => {
      setCooldown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  const handleOtpChange = (index: number, value: string) => {
    // Only accept numeric input
    const cleanDigit = value.replace(/\D/g, '').slice(-1);
    const newOtp = [...otp];
    newOtp[index] = cleanDigit;
    setOtp(newOtp);
    setError('');

    if (cleanDigit && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (
    index: number,
    e: React.KeyboardEvent<HTMLInputElement>
  ) => {
    if (e.key === 'Backspace') {
      if (!otp[index] && index > 0) {
        // Current box empty, backspace moves to and clears previous box
        const newOtp = [...otp];
        newOtp[index - 1] = '';
        setOtp(newOtp);
        inputRefs.current[index - 1]?.focus();
      } else if (otp[index]) {
        // Clear current box
        const newOtp = [...otp];
        newOtp[index] = '';
        setOtp(newOtp);
      }
    } else if (e.key === 'ArrowLeft' && index > 0) {
      inputRefs.current[index - 1]?.focus();
    } else if (e.key === 'ArrowRight' && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pasteData = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (!pasteData) return;

    const newOtp = [...otp];
    for (let i = 0; i < 6; i++) {
      newOtp[i] = pasteData[i] || '';
    }
    setOtp(newOtp);
    setError('');

    // Focus either the next empty box or the last box
    const focusIndex = Math.min(pasteData.length, 5);
    inputRefs.current[focusIndex]?.focus();
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');

    const emailValidation = validateEmail(email);
    if (!emailValidation.isValid) {
      setError(emailValidation.error || 'Please provide a valid email address.');
      return;
    }

    const fullCode = otp.join('');
    if (fullCode.length !== 6) {
      setError('Please enter all 6 digits of your verification code.');
      return;
    }

    setLoading(true);

    try {
      const res = await verifyOtp(emailValidation.normalizedEmail, fullCode);
      if (res.success) {
        setSuccessMsg('Email verified successfully! Setting up your workspace...');
        setTimeout(() => {
          const selectedRole = localStorage.getItem('selectedRole');
          if (selectedRole) {
            navigate('/dashboard');
          } else {
            navigate('/new-interview');
          }
        }, 1200);
      } else {
        setError(res.message || 'Invalid or expired verification code.');
      }
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred during verification.');
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (cooldown > 0 || resending) return;

    const emailValidation = validateEmail(email);
    if (!emailValidation.isValid) {
      setError(emailValidation.error || 'Please provide a valid email address.');
      return;
    }

    setError('');
    setSuccessMsg('');
    setResending(true);

    try {
      const res = await resendOtp(emailValidation.normalizedEmail);
      if (res.success) {
        setSuccessMsg(res.message || 'A new verification code has been sent.');
        setCooldown(60);
      } else {
        setError(res.message || 'Failed to resend verification code.');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to resend verification code.');
    } finally {
      setResending(false);
    }
  };

  const isCodeComplete = otp.every((d) => d.length === 1);

  return (
    <AuthLayout>
      <AuthHeading icon={<Mail />} title="Verify Your Email">
        We sent a 6-digit verification code to confirm ownership of your email address.
      </AuthHeading>

      {/* Email badge / edit toggle */}
      <div className="flex items-center justify-center gap-2 rounded-md border border-border bg-secondary px-3 py-2 text-sm">
        {isEditingEmail ? (
          <div className="flex w-full items-center gap-2">
            <Input
              type="email"
              aria-label="Email address"
              placeholder="name@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus
            />
            <Button
              type="button"
              size="sm"
              onClick={() => {
                if (validateEmail(email).isValid) {
                  setIsEditingEmail(false);
                  setError('');
                } else {
                  setError('Please enter a valid email format.');
                }
              }}
            >
              Save
            </Button>
          </div>
        ) : (
          <>
            <span className="font-semibold">{email || 'No email specified'}</span>
            <Button type="button" variant="ghost" size="sm" onClick={() => setIsEditingEmail(true)} title="Change email">
              <Edit2 />
              <span>Change</span>
            </Button>
          </>
        )}
      </div>

      {/* Status feedback alerts */}
      {error && (
        <Alert variant="error">
          <AlertCircle />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {successMsg && (
        <Alert variant="success">
          <CheckCircle2 />
          <AlertDescription>{successMsg}</AlertDescription>
        </Alert>
      )}

      {/* Verification Form */}
      <form onSubmit={handleVerify} className="flex flex-col gap-5">
        <fieldset className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0">
          <legend className="mb-3 w-full text-center text-sm font-medium">Enter 6-digit confirmation code</legend>

          {/* 6 OTP Inputs */}
          <div className="mx-auto flex w-full max-w-sm justify-between gap-2">
            {otp.map((digit, idx) => (
              <Input
                key={idx}
                ref={(el) => {
                  inputRefs.current[idx] = el;
                }}
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={1}
                value={digit}
                onChange={(e) => handleOtpChange(idx, e.target.value)}
                onKeyDown={(e) => handleKeyDown(idx, e)}
                onPaste={handlePaste}
                disabled={loading || resending}
                aria-label={`Digit ${idx + 1}`}
                className={cn('h-12 w-11 px-0 text-center text-xl font-semibold', digit && 'border-primary')}
              />
            ))}
          </div>
        </fieldset>

        {/* Submit Verification Button */}
        <Button type="submit" disabled={loading || !isCodeComplete || isEditingEmail}>
          {loading ? (
            <>
              <Loader2 className="animate-spin motion-reduce:animate-none" />
              <span>Verifying code...</span>
            </>
          ) : (
            <>
              <span>Verify Email</span>
              <ArrowRight />
            </>
          )}
        </Button>
      </form>

      {/* Resend OTP Section */}
      <div className="flex flex-col items-center gap-2 text-center text-sm text-muted-foreground">
        <p>Didn't receive the email? Please check your Spam or Junk folder as well.</p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleResend}
          disabled={cooldown > 0 || resending || isEditingEmail}
          className={cooldown > 0 ? 'text-muted-foreground' : 'text-foreground'}
        >
          {resending ? (
            <>
              <Loader2 className="animate-spin motion-reduce:animate-none" />
              <span>Sending code...</span>
            </>
          ) : cooldown > 0 ? (
            <>
              <RefreshCw />
              <span>Resend code in {cooldown}s</span>
            </>
          ) : (
            <>
              <RefreshCw />
              <span>Resend verification code</span>
            </>
          )}
        </Button>
      </div>

      {/* Back to sign in */}
      <div className="text-center">
        <Button asChild variant="ghost" size="sm" className="text-muted-foreground">
          <Link to="/login">← Return to Sign In</Link>
        </Button>
      </div>

      {/* Privacy & Security note */}
      <div className="flex items-center justify-center gap-2 border-t border-border pt-4 text-center text-xs text-muted-foreground">
        <ShieldCheck className="size-4 shrink-0 text-success" aria-hidden />
        <span>Email verification prevents unauthorized and fake account creation.</span>
      </div>
    </AuthLayout>
  );
};
