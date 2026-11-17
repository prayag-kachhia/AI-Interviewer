import { act, renderHook } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';
import { useAuthForm } from './useAuthForm';

const auth = { signIn: vi.fn(), signUp: vi.fn(), signInWithGoogle: vi.fn(), resetPasswordForEmail: vi.fn(), user: null, staySignedIn: false, setStaySignedIn: vi.fn() };
vi.mock('../../context/AuthContext', () => ({ useAuth: () => auth }));

const wrapper = ({ children }: { children: React.ReactNode }) => <MemoryRouter>{children}</MemoryRouter>;
const STRONG = 'Str0ng!P@ss2026#';

beforeEach(() => {
  auth.signIn.mockReset();
  auth.signUp.mockReset();
  auth.signInWithGoogle.mockReset();
  auth.setStaySignedIn.mockReset();
});

/** Fills the sign-up form, then submits it. */
async function submitSignUp(fields: { email?: string; password?: string; confirm?: string }) {
  const { result } = renderHook(() => useAuthForm(), { wrapper });
  act(() => {
    result.current.switchMode('signup');
    result.current.setName('Jane Doe');
    result.current.setEmail(fields.email ?? 'jane@example.com');
    result.current.setPassword(fields.password ?? STRONG);
    result.current.setConfirmPassword(fields.confirm ?? STRONG);
  });
  await act(async () => {
    await result.current.submit({ preventDefault() {} } as React.FormEvent);
  });
  return result.current;
}

it('blocks an empty email and never calls the API', async () => {
  const { result } = renderHook(() => useAuthForm(), { wrapper });
  await act(async () => {
    await result.current.submit({ preventDefault() {} } as React.FormEvent);
  });
  expect(result.current.error).not.toBe('');
  expect(auth.signIn).not.toHaveBeenCalled();
});

it('blocks sign-up when the passwords do not match', async () => {
  const form = await submitSignUp({ confirm: 'Different1!Pass' });
  expect(form.passwordsMatch).toBe(false);
  expect(form.isSignUpValid).toBe(false);
  expect(form.error).toBe('Passwords do not match.');
  expect(auth.signUp).not.toHaveBeenCalled();
});

it('blocks sign-up with a weak password', async () => {
  const form = await submitSignUp({ password: 'abc', confirm: 'abc' });
  expect(form.error).toBe('Password does not meet all security requirements.');
  expect(auth.signUp).not.toHaveBeenCalled();
});

it('signs up with a strong, matching password', async () => {
  auth.signUp.mockResolvedValue({ success: true, needsVerification: false, message: 'Check your inbox.' });
  const form = await submitSignUp({});
  expect(form.isSignUpValid).toBe(true);
  expect(auth.signUp).toHaveBeenCalledWith('Jane Doe', 'jane@example.com', STRONG);
  expect(form.successMsg).toBe('Check your inbox.');
});

it('defaults staySignedIn to false and toggles via handleStaySignedInChange', () => {
  const { result } = renderHook(() => useAuthForm(), { wrapper });
  expect(result.current.staySignedIn).toBe(false);

  act(() => {
    result.current.handleStaySignedInChange(true);
  });
  expect(result.current.staySignedIn).toBe(true);
  expect(auth.setStaySignedIn).toHaveBeenCalledWith(true);

  act(() => {
    result.current.handleStaySignedInChange(false);
  });
  expect(result.current.staySignedIn).toBe(false);
  expect(auth.setStaySignedIn).toHaveBeenCalledWith(false);
});

it('passes staySignedIn to signIn during logIn', async () => {
  auth.signIn.mockResolvedValue({ success: true });
  const { result } = renderHook(() => useAuthForm(), { wrapper });

  act(() => {
    result.current.setEmail('candidate@example.com');
    result.current.setPassword('Password123!');
    result.current.handleStaySignedInChange(true);
  });

  await act(async () => {
    await result.current.submit({ preventDefault() {} } as React.FormEvent);
  });

  expect(auth.signIn).toHaveBeenCalledWith('candidate@example.com', 'Password123!', true);
});

it('passes staySignedIn to signInWithGoogle during continueWithGoogle', async () => {
  auth.signInWithGoogle.mockResolvedValue({ success: true });
  const { result } = renderHook(() => useAuthForm(), { wrapper });

  act(() => {
    result.current.handleStaySignedInChange(true);
  });

  await act(async () => {
    await result.current.continueWithGoogle();
  });

  expect(auth.signInWithGoogle).toHaveBeenCalledWith(true);
});
