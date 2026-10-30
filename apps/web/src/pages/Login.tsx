import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation, Link } from 'react-router';
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
  const { signIn, signUp, user } = useAuth();
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
  const [loading, setLoading] = useState(false);

  // Redirect if already authenticated
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

  const handleSwitchMode = (newMode: 'signin' | 'signup') => {
    if (newMode === mode) return;
    setMode(newMode);
    setError('');
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
          if (res.message) {
            setSuccessMsg(res.message);
          } else {
            navigate('/new-interview');
          }
        } else {
          setError(res.message || 'Registration failed');
        }
      } else {
        // Sign In
        const res = await signIn(email, password);
        if (res.success) {
          const selectedRole = localStorage.getItem('selectedRole');
          if (selectedRole) {
            navigate('/dashboard');
          } else {
            navigate('/new-interview');
          }
        } else {
          setError(res.message || 'Invalid credentials');
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
                                      }}
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
                                      }}
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
