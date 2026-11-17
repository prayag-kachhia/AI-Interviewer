import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation, Link } from 'react-router';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { validateEmail } from '../../lib/emailValidation';
import {
  Mail,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ArrowRight,
  Sun,
  Moon,
  ShieldCheck,
  RefreshCw,
  Edit2,
} from 'lucide-react';
import { Logo } from '../../components/Logo';

export const VerifyEmail: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { verifyOtp, resendOtp, user } = useAuth();
  const { theme, setTheme } = useTheme();

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

      <div style={{ maxWidth: '460px', width: '100%', margin: '0 auto', zIndex: 1 }}>
        <div className="card" style={{ padding: '2.5rem 2rem', background: 'var(--surface-color)' }}>
          {/* Header */}
          <div style={{ textAlign: 'center', marginBottom: '1.75rem' }}>
            <div
              style={{
                width: '52px',
                height: '52px',
                borderRadius: '50%',
                backgroundColor: 'rgba(99, 102, 241, 0.1)',
                color: 'var(--primary-color)',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: '1rem',
              }}
            >
              <Mail size={26} />
            </div>
            <h2 style={{ fontSize: '1.5rem', fontWeight: 700, margin: '0 0 0.5rem 0', color: 'var(--text-main)' }}>
              Verify Your Email
            </h2>
            <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>
              We sent a 6-digit verification code to confirm ownership of your email address.
            </p>
          </div>

          {/* Email badge / edit toggle */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.5rem',
              marginBottom: '1.5rem',
              padding: '0.6rem 0.85rem',
              backgroundColor: 'var(--bg-elevated, rgba(255, 255, 255, 0.04))',
              border: '1px solid var(--border-color)',
              borderRadius: '8px',
              fontSize: '0.85rem',
            }}
          >
            {isEditingEmail ? (
              <div style={{ display: 'flex', width: '100%', gap: '0.5rem', alignItems: 'center' }}>
                <input
                  type="email"
                  className="form-input-aesthetic"
                  style={{ fontSize: '0.85rem', padding: '0.35rem 0.65rem' }}
                  placeholder="name@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoFocus
                />
                <button
                  type="button"
                  className="theme-segmented-btn active"
                  style={{ whiteSpace: 'nowrap', padding: '0.35rem 0.65rem', fontSize: '0.8rem' }}
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
                </button>
              </div>
            ) : (
              <>
                <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>{email || 'No email specified'}</span>
                <button
                  type="button"
                  onClick={() => setIsEditingEmail(true)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--primary-color)',
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.25rem',
                    fontSize: '0.78rem',
                    padding: 0,
                  }}
                  title="Change email"
                >
                  <Edit2 size={13} />
                  <span>Change</span>
                </button>
              </>
            )}
          </div>

          {/* Status feedback alerts */}
          {error && (
            <div className="alert alert-error" style={{ marginBottom: '1.25rem' }}>
              <AlertCircle size={18} />
              <span style={{ fontSize: '0.875rem' }}>{error}</span>
            </div>
          )}

          {successMsg && (
            <div className="alert alert-info" style={{ marginBottom: '1.25rem' }}>
              <CheckCircle2 size={18} color="var(--primary-color)" />
              <span style={{ fontSize: '0.875rem' }}>{successMsg}</span>
            </div>
          )}

          {/* Verification Form */}
          <form onSubmit={handleVerify} style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            <div className="form-group" style={{ margin: 0 }}>
              <label
                className="form-label"
                style={{ textAlign: 'center', display: 'block', marginBottom: '0.75rem', fontSize: '0.85rem' }}
              >
                Enter 6-digit confirmation code
              </label>

              {/* 6 OTP Inputs */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: '0.5rem',
                  maxWidth: '360px',
                  margin: '0 auto',
                  width: '100%',
                }}
              >
                {otp.map((digit, idx) => (
                  <input
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
                    style={{
                      width: '46px',
                      height: '52px',
                      textAlign: 'center',
                      fontSize: '1.35rem',
                      fontWeight: 700,
                      borderRadius: '8px',
                      border: digit
                        ? '2px solid var(--primary-color)'
                        : '1px solid var(--border-color)',
                      backgroundColor: 'var(--bg-elevated, var(--surface-color))',
                      color: 'var(--text-main)',
                      outline: 'none',
                      transition: 'border-color 0.15s ease',
                    }}
                  />
                ))}
              </div>
            </div>

            {/* Submit Verification Button */}
            <button
              type="submit"
              className="btn-auth-submit"
              disabled={loading || !isCodeComplete || isEditingEmail}
            >
              {loading ? (
                <>
                  <Loader2 size={18} className="spin" style={{ animation: 'spin 1s linear infinite' }} />
                  <span>Verifying code...</span>
                </>
              ) : (
                <>
                  <span>Verify Email</span>
                  <ArrowRight size={16} />
                </>
              )}
            </button>
          </form>

          {/* Resend OTP Section */}
          <div
            style={{
              marginTop: '1.5rem',
              textAlign: 'center',
              fontSize: '0.875rem',
              color: 'var(--text-muted)',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.65rem',
              alignItems: 'center',
            }}
          >
            <p
              style={{
                margin: 0,
                lineHeight: 1.5,
                color: 'var(--text-muted)',
                fontSize: '0.85rem',
                maxWidth: '380px',
              }}
            >
              Didn't receive the email? Please check your Spam or Junk folder as well.
            </p>
            <button
              type="button"
              onClick={handleResend}
              disabled={cooldown > 0 || resending || isEditingEmail}
              style={{
                background: 'none',
                border: 'none',
                color: cooldown > 0 ? 'var(--text-muted)' : 'var(--primary-color)',
                fontWeight: 600,
                cursor: cooldown > 0 ? 'not-allowed' : 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.4rem',
                fontSize: '0.85rem',
                padding: 0,
              }}
            >
              {resending ? (
                <>
                  <Loader2 size={14} className="spin" style={{ animation: 'spin 1s linear infinite' }} />
                  <span>Sending code...</span>
                </>
              ) : cooldown > 0 ? (
                <>
                  <RefreshCw size={14} style={{ opacity: 0.6 }} />
                  <span>Resend code in {cooldown}s</span>
                </>
              ) : (
                <>
                  <RefreshCw size={14} />
                  <span>Resend verification code</span>
                </>
              )}
            </button>
          </div>

          {/* Back to sign in */}
          <div style={{ marginTop: '1.5rem', textAlign: 'center', fontSize: '0.875rem' }}>
            <Link to="/login" style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>
              ← Return to Sign In
            </Link>
          </div>

          {/* Privacy & Security note */}
          <div
            style={{
              marginTop: '1.25rem',
              paddingTop: '0.9rem',
              borderTop: '1px solid var(--border-color)',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              fontSize: '0.78rem',
              color: 'var(--text-light)',
              justifyContent: 'center',
            }}
          >
            <ShieldCheck size={15} color="var(--success-color)" />
            <span>Email verification prevents unauthorized and fake account creation.</span>
          </div>
        </div>
      </div>
    </div>
  );
};
