import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { 
  BrainCircuit, 
  AlertCircle, 
  CheckCircle2, 
  UserPlus, 
  LogIn, 
  ArrowRight, 
  ShieldCheck, 
  Sparkles,
  Sun,
  Moon,
  Mail,
  Lock,
  User as UserIcon,
  Eye,
  EyeOff,
  Loader2,
  FileText,
  Target
} from 'lucide-react';

export const Login: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { signIn, signUp, checkUser, user } = useAuth();
  const { theme, setTheme } = useTheme();

  // Mode: 'signin' | 'signup'
  const [mode, setMode] = useState<'signin' | 'signup'>(() => location.state?.mode || 'signin');
  
  // Form fields
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  
  // Password reveal toggles
  const [showSignInPassword, setShowSignInPassword] = useState(false);
  const [showSignUpPassword, setShowSignUpPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // Status feedback
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState(() => location.state?.message || '');
  const [suggestMode, setSuggestMode] = useState<'signin' | 'signup' | null>(null);
  const [loading, setLoading] = useState(false);

  // Redirect if already authenticated
  useEffect(() => {
    if (user) {
      navigate('/dashboard');
    }
  }, [user, navigate]);

  // Check email on blur for smart suggestion
  const handleEmailBlur = async () => {
    if (!email || !email.includes('@')) return;
    try {
      const result = await checkUser(email);
      if (mode === 'signin' && !result.exists) {
        setSuggestMode('signup');
      } else if (mode === 'signup' && result.exists) {
        setSuggestMode('signin');
      } else {
        setSuggestMode(null);
      }
    } catch {
      // Ignore network noise on blur
    }
  };

  const handleSwitchMode = (newMode: 'signin' | 'signup') => {
    if (newMode === mode) return;
    setMode(newMode);
    setError('');
    setSuggestMode(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');
    setLoading(true);

    try {
      if (mode === 'signup') {
        if (!name.trim()) {
          setError('Please provide your full name.');
          setLoading(false);
          return;
        }
        if (password.length < 6) {
          setError('Password must be at least 6 characters.');
          setLoading(false);
          return;
        }
        if (password !== confirmPassword) {
          setError('Passwords do not match.');
          setLoading(false);
          return;
        }

        const res = await signUp(name, email, password);
        if (res.success) {
          navigate('/dashboard');
        } else {
          setError(res.message || 'Registration failed');
          if (res.exists) {
            setSuggestMode('signin');
          }
        }
      } else {
        // Sign In
        const res = await signIn(email, password);
        if (res.success) {
          navigate('/dashboard');
        } else {
          setError(res.message || 'Invalid credentials');
          if (res.isNewUser) {
            setSuggestMode('signup');
          }
        }
      }
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  };

  const isFlipped = mode === 'signup';

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
            <BrainCircuit size={22} color="var(--primary-color)" />
          </div>
          <span>
            AI <span className="text-gradient">Interviewer</span>
          </span>
        </Link>

        {/* Dark & Light Mode Option */}
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

      {/* 3D Flip Container: Flips horizontally when mode changes */}
      <div className="auth-flip-perspective">
        <div className={`auth-flip-card ${isFlipped ? 'is-flipped' : ''}`}>
          
          {/* =========================================================
              FRONT FACE: SIGN IN
              ========================================================= */}
          <div className="auth-card-face auth-card-front" aria-hidden={isFlipped}>
            {/* Header */}
            <div className="auth-face-header">
              <div className="auth-ai-pill">
                <Sparkles size={13} />
                <span>Next-Gen Career AI</span>
              </div>
              <h2 className="auth-face-title">Welcome Back</h2>
              <p className="auth-face-subtitle">
                Sign in to analyze your resumes and prepare for interviews.
              </p>
            </div>

            {/* Flip Switcher Tabs */}
            <div className="auth-tab-group" role="tablist">
              <button
                type="button"
                className={`auth-tab-btn ${mode === 'signin' ? 'active' : ''}`}
                onClick={() => handleSwitchMode('signin')}
                role="tab"
                aria-selected={mode === 'signin'}
              >
                <LogIn size={16} /> Sign In
              </button>
              <button
                type="button"
                className={`auth-tab-btn ${mode === 'signup' ? 'active' : ''}`}
                onClick={() => handleSwitchMode('signup')}
                role="tab"
                aria-selected={mode === 'signup'}
              >
                <UserPlus size={16} /> Sign Up
              </button>
            </div>

            {/* Flash / Status Alerts */}
            {successMsg && (
              <div className="alert alert-info" style={{ marginBottom: '1rem' }}>
                <CheckCircle2 size={18} color="var(--primary-color)" />
                <span style={{ fontSize: '0.875rem' }}>{successMsg}</span>
              </div>
            )}

            {error && mode === 'signin' && (
              <div className="alert alert-error" style={{ marginBottom: '1rem' }}>
                <AlertCircle size={18} />
                <span style={{ fontSize: '0.875rem' }}>{error}</span>
              </div>
            )}

            {/* Smart Suggestion: New User on Sign In */}
            {suggestMode === 'signup' && mode === 'signin' && (
              <div className="auth-suggestion-card">
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 600, color: 'var(--text-main)', fontSize: '0.88rem' }}>
                  <Sparkles size={16} color="var(--primary-color)" />
                  New account required
                </div>
                <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: 0 }}>
                  We couldn't find an account for <strong>{email}</strong>. Flip over to create one!
                </p>
                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ padding: '0.4rem 0.85rem', fontSize: '0.82rem', alignSelf: 'flex-start', marginTop: '0.35rem' }}
                  onClick={() => handleSwitchMode('signup')}
                >
                  Flip to Sign Up <ArrowRight size={14} />
                </button>
              </div>
            )}

            {/* Sign In Form */}
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">Email address</label>
                <div className="input-with-icon-wrapper">
                  <div className="input-icon-left">
                    <Mail size={18} />
                  </div>
                  <input
                    type="email"
                    className="form-input-aesthetic"
                    placeholder="name@company.com"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      setSuggestMode(null);
                    }}
                    onBlur={handleEmailBlur}
                    required
                    tabIndex={isFlipped ? -1 : 0}
                  />
                </div>
              </div>

              <div className="form-group" style={{ margin: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                  <label className="form-label" style={{ margin: 0 }}>Password</label>
                </div>
                <div className="input-with-icon-wrapper">
                  <div className="input-icon-left">
                    <Lock size={18} />
                  </div>
                  <input
                    type={showSignInPassword ? 'text' : 'password'}
                    className="form-input-aesthetic has-right-icon"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    tabIndex={isFlipped ? -1 : 0}
                  />
                  <button
                    type="button"
                    className="input-action-btn"
                    onClick={() => setShowSignInPassword(!showSignInPassword)}
                    title={showSignInPassword ? 'Hide password' : 'Show password'}
                    tabIndex={isFlipped ? -1 : 0}
                  >
                    {showSignInPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                className="btn-auth-submit"
                disabled={loading}
                tabIndex={isFlipped ? -1 : 0}
              >
                {loading && mode === 'signin' ? (
                  <>
                    <Loader2 size={18} className="spin" style={{ animation: 'spin 1s linear infinite' }} />
                    <span>Signing in...</span>
                  </>
                ) : (
                  <>
                    <span>Sign In to Dashboard</span>
                    <ArrowRight size={16} />
                  </>
                )}
              </button>
            </form>

            {/* Flip toggle prompt footer */}
            <div style={{ marginTop: '1.4rem', textAlign: 'center', fontSize: '0.875rem', color: 'var(--text-muted)' }}>
              <span>Don't have an account? </span>
              <button
                type="button"
                onClick={() => handleSwitchMode('signup')}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--primary-color)',
                  fontWeight: 600,
                  cursor: 'pointer',
                  padding: 0,
                  textDecoration: 'underline'
                }}
                tabIndex={isFlipped ? -1 : 0}
              >
                Sign up now ↻
              </button>
            </div>

            {/* Aesthetic feature badges */}
            <div className="auth-feature-preview">
              <div className="auth-feature-pill">
                <FileText size={12} color="var(--primary-color)" />
                <span>Resume Heuristics</span>
              </div>
              <div className="auth-feature-pill">
                <Target size={12} color="var(--primary-color)" />
                <span>Smart Roles</span>
              </div>
              <div className="auth-feature-pill">
                <ShieldCheck size={12} color="var(--success-color)" />
                <span>Secure Storage</span>
              </div>
            </div>
          </div>

          {/* =========================================================
              BACK FACE: SIGN UP (Flipped 180deg horizontally)
              ========================================================= */}
          <div className="auth-card-face auth-card-back" aria-hidden={!isFlipped}>
            {/* Header */}
            <div className="auth-face-header">
              <div className="auth-ai-pill">
                <Sparkles size={13} />
                <span>Join AI Interviewer</span>
              </div>
              <h2 className="auth-face-title">Create Account</h2>
              <p className="auth-face-subtitle">
                Get started with automated resume analysis and interview prep.
              </p>
            </div>

            {/* Flip Switcher Tabs */}
            <div className="auth-tab-group" role="tablist">
              <button
                type="button"
                className={`auth-tab-btn ${mode === 'signin' ? 'active' : ''}`}
                onClick={() => handleSwitchMode('signin')}
                role="tab"
                aria-selected={mode === 'signin'}
              >
                <LogIn size={16} /> Sign In
              </button>
              <button
                type="button"
                className={`auth-tab-btn ${mode === 'signup' ? 'active' : ''}`}
                onClick={() => handleSwitchMode('signup')}
                role="tab"
                aria-selected={mode === 'signup'}
              >
                <UserPlus size={16} /> Sign Up
              </button>
            </div>

            {/* Error banner for sign up */}
            {error && mode === 'signup' && (
              <div className="alert alert-error" style={{ marginBottom: '1rem' }}>
                <AlertCircle size={18} />
                <span style={{ fontSize: '0.875rem' }}>{error}</span>
              </div>
            )}

            {/* Smart Suggestion: Account Already Exists on Sign Up */}
            {suggestMode === 'signin' && mode === 'signup' && (
              <div className="auth-suggestion-card">
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 600, color: 'var(--text-main)', fontSize: '0.88rem' }}>
                  <CheckCircle2 size={16} color="var(--primary-color)" />
                  Account already exists
                </div>
                <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: 0 }}>
                  An account for <strong>{email}</strong> already exists. Flip back to sign in!
                </p>
                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ padding: '0.4rem 0.85rem', fontSize: '0.82rem', alignSelf: 'flex-start', marginTop: '0.35rem' }}
                  onClick={() => handleSwitchMode('signin')}
                >
                  Flip to Sign In <ArrowRight size={14} />
                </button>
              </div>
            )}

            {/* Sign Up Form */}
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">Full Name</label>
                <div className="input-with-icon-wrapper">
                  <div className="input-icon-left">
                    <UserIcon size={18} />
                  </div>
                  <input
                    type="text"
                    className="form-input-aesthetic"
                    placeholder="Jane Doe"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    tabIndex={!isFlipped ? -1 : 0}
                  />
                </div>
              </div>

              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">Email address</label>
                <div className="input-with-icon-wrapper">
                  <div className="input-icon-left">
                    <Mail size={18} />
                  </div>
                  <input
                    type="email"
                    className="form-input-aesthetic"
                    placeholder="name@company.com"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      setSuggestMode(null);
                    }}
                    onBlur={handleEmailBlur}
                    required
                    tabIndex={!isFlipped ? -1 : 0}
                  />
                </div>
              </div>

              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">Password</label>
                <div className="input-with-icon-wrapper">
                  <div className="input-icon-left">
                    <Lock size={18} />
                  </div>
                  <input
                    type={showSignUpPassword ? 'text' : 'password'}
                    className="form-input-aesthetic has-right-icon"
                    placeholder="At least 6 characters"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    tabIndex={!isFlipped ? -1 : 0}
                  />
                  <button
                    type="button"
                    className="input-action-btn"
                    onClick={() => setShowSignUpPassword(!showSignUpPassword)}
                    title={showSignUpPassword ? 'Hide password' : 'Show password'}
                    tabIndex={!isFlipped ? -1 : 0}
                  >
                    {showSignUpPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">Confirm Password</label>
                <div className="input-with-icon-wrapper">
                  <div className="input-icon-left">
                    <Lock size={18} />
                  </div>
                  <input
                    type={showConfirmPassword ? 'text' : 'password'}
                    className="form-input-aesthetic has-right-icon"
                    placeholder="Re-enter password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                    tabIndex={!isFlipped ? -1 : 0}
                  />
                  <button
                    type="button"
                    className="input-action-btn"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    title={showConfirmPassword ? 'Hide password' : 'Show password'}
                    tabIndex={!isFlipped ? -1 : 0}
                  >
                    {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                className="btn-auth-submit"
                disabled={loading}
                tabIndex={!isFlipped ? -1 : 0}
              >
                {loading && mode === 'signup' ? (
                  <>
                    <Loader2 size={18} className="spin" style={{ animation: 'spin 1s linear infinite' }} />
                    <span>Creating account...</span>
                  </>
                ) : (
                  <>
                    <span>Create Free Account</span>
                    <ArrowRight size={16} />
                  </>
                )}
              </button>
            </form>

            {/* Flip toggle prompt footer */}
            <div style={{ marginTop: '1.4rem', textAlign: 'center', fontSize: '0.875rem', color: 'var(--text-muted)' }}>
              <span>Already registered? </span>
              <button
                type="button"
                onClick={() => handleSwitchMode('signin')}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--primary-color)',
                  fontWeight: 600,
                  cursor: 'pointer',
                  padding: 0,
                  textDecoration: 'underline'
                }}
                tabIndex={!isFlipped ? -1 : 0}
              >
                Sign In ↻
              </button>
            </div>

            {/* Privacy note */}
            <div style={{
              marginTop: '1.2rem',
              paddingTop: '0.9rem',
              borderTop: '1px solid var(--border-color)',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              fontSize: '0.78rem',
              color: 'var(--text-light)',
              justifyContent: 'center'
            }}>
              <ShieldCheck size={15} color="var(--success-color)" />
              <span>Your profile data and uploaded resumes are private & encrypted.</span>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
};
