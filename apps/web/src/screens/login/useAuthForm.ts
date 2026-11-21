import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useAuth } from '../../context/AuthContext';
import { checkPasswordStrength } from '../../lib/passwordStrength';
import { validateEmail } from '../../lib/emailValidation';
import { getStaySignedIn, setStaySignedIn as setStorageStaySignedIn } from '../../lib/authStorage';

export type Mode = 'signin' | 'signup';

/** Where a signed-in user goes: the dashboard if they have picked a role before, else interview setup. */
const homeAfterSignIn = () => (localStorage.getItem('selectedRole') ? '/dashboard' : '/new-interview');

/** An OAuth redirect puts its error in the query string or in the hash fragment. */
function oauthError(search: string, hash: string): string {
  const query = new URLSearchParams(search);
  const fragment = new URLSearchParams(hash.startsWith('#') ? hash.substring(1) : '');
  const description = query.get('error_description') || fragment.get('error_description');
  const code = query.get('error') || fragment.get('error');
  if (description) return decodeURIComponent(description.replace(/\+/g, ' '));
  return code ? `Authentication error: ${code}` : '';
}

/** Everything the sign-in and sign-up forms share: the fields, their checks, and what submitting does. */
export function useAuthForm() {
  const location = useLocation();
  const navigate = useNavigate();
  const { signIn, signUp, signInWithGoogle, signInWithGitHub, resetPasswordForEmail, user, staySignedIn: authStaySignedIn, setStaySignedIn: authSetStaySignedIn } = useAuth();

  const [mode, setMode] = useState<Mode>(() => location.state?.mode || 'signin');
  const [staySignedIn, setStaySignedIn] = useState<boolean>(() => authStaySignedIn ?? getStaySignedIn());

  const handleStaySignedInChange = (checked: boolean) => {
    setStaySignedIn(checked);
    authSetStaySignedIn?.(checked);
    setStorageStaySignedIn(checked);
  };
  const [forgot, setForgot] = useState(false);
  const [unverifiedEmail, setUnverifiedEmail] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState(() => location.state?.message || '');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [githubLoading, setGithubLoading] = useState(false);
  const [forgotLoading, setForgotLoading] = useState(false);

  const strengthResult = checkPasswordStrength(password, email);
  const passwordsMatch = password.length > 0 && password === confirmPassword;
  const isSignUpValid = Boolean(
    name.trim() && validateEmail(email).isValid && strengthResult.strength === 'strong' && passwordsMatch,
  );

  useEffect(() => {
    const message = oauthError(location.search, location.hash);
    if (message) setError(message);
  }, [location.search, location.hash]);

  useEffect(() => {
    if (user) navigate(homeAfterSignIn());
  }, [user, navigate]);

  const switchMode = (next: Mode) => {
    if (next === mode) return;
    setMode(next);
    setForgot(false);
    setUnverifiedEmail('');
    setError('');
  };

  const showForgot = (on: boolean) => {
    setForgot(on);
    setError('');
  };

  const sendResetLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');
    const checked = validateEmail(email);
    if (!checked.isValid) return setError(checked.error || 'Please enter a valid email address.');
    setForgotLoading(true);
    try {
      const res = await resetPasswordForEmail(checked.normalizedEmail);
      if (res.success) {
        setSuccessMsg(res.message || 'If an account exists for that email, a password reset link has been sent.');
      } else {
        setError(res.message || 'Failed to send password reset email');
      }
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred');
    } finally {
      setForgotLoading(false);
    }
  };

  const continueWithGoogle = async () => {
    setError('');
    setSuccessMsg('');
    setGoogleLoading(true);
    try {
      const res = await signInWithGoogle(staySignedIn);
      if (!res.success) {
        setError(res.message || 'Failed to start Google sign-in');
        setGoogleLoading(false);
      }
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred during Google sign-in');
      setGoogleLoading(false);
    }
  };

  const continueWithGitHub = async () => {
    setError('');
    setSuccessMsg('');
    setGithubLoading(true);
    try {
      const res = await signInWithGitHub(staySignedIn);
      if (!res.success) {
        setError(res.message || 'Failed to start GitHub sign-in');
        setGithubLoading(false);
      }
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred during GitHub sign-in');
      setGithubLoading(false);
    }
  };

  const createAccount = async (normalizedEmail: string) => {
    if (!name.trim()) return setError('Please provide your full name.');
    if (strengthResult.strength !== 'strong') return setError('Password does not meet all security requirements.');
    if (password !== confirmPassword) return setError('Passwords do not match.');
    const res = await signUp(name, normalizedEmail, password);
    if (!res.success) return setError(res.message || 'Registration failed');
    if (res.needsVerification) navigate('/verify-email', { state: { email: normalizedEmail, message: res.message } });
    else if (res.message) setSuccessMsg(res.message);
    else navigate('/new-interview');
  };

  const logIn = async (normalizedEmail: string) => {
    const res = await signIn(normalizedEmail, password, staySignedIn);
    if (res.success) return navigate(homeAfterSignIn());
    if (res.needsVerification) setUnverifiedEmail(normalizedEmail);
    setError(res.message || 'Invalid credentials');
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');
    setUnverifiedEmail('');
    setLoading(true);
    try {
      const checked = validateEmail(email);
      if (!checked.isValid) return setError(checked.error || 'Please provide a valid email address.');
      await (mode === 'signup' ? createAccount(checked.normalizedEmail) : logIn(checked.normalizedEmail));
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  };

  return {
    mode, switchMode, forgot, showForgot, unverifiedEmail,
    name, setName, email, setEmail, password, setPassword, confirmPassword, setConfirmPassword,
    strengthResult, passwordsMatch, isSignUpValid,
    error, successMsg, loading, googleLoading, githubLoading, forgotLoading,
    submit, sendResetLink, continueWithGoogle, continueWithGitHub,
    staySignedIn, handleStaySignedInChange,
  };
}

export type AuthForm = ReturnType<typeof useAuthForm>;
