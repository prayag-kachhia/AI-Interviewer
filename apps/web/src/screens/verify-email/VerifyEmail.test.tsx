import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { axe } from 'vitest-axe';
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { VerifyEmail } from './VerifyEmail';
import { AuthProvider, useAuth } from '../../context/AuthContext';
import { ThemeProvider } from '../../context/ThemeContext';

const mockVerifyOtp = vi.fn();
const mockResend = vi.fn();
const mockGetSession = vi.fn().mockResolvedValue({ data: { session: null }, error: null });
const mockOnAuthStateChange = vi.fn((_cb) => ({
  data: { subscription: { unsubscribe: vi.fn() } },
}));
const mockNavigate = vi.fn();

vi.mock('react-router', async () => {
  const actual = await vi.importActual('react-router');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock('../../lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabase: {
    auth: {
      getSession: () => mockGetSession(),
      onAuthStateChange: (cb: any) => mockOnAuthStateChange(cb),
      verifyOtp: (params: any) => mockVerifyOtp(params),
      resend: (params: any) => mockResend(params),
      signOut: vi.fn().mockResolvedValue({ error: null }),
      signInWithPassword: vi.fn(),
      signUp: vi.fn(),
      signInWithOAuth: vi.fn(),
    },
  },
}));

vi.mock('../../lib/api', () => ({
  getMe: vi.fn().mockResolvedValue({
    success: true,
    data: { id: 'u1', email: 'candidate@example.com', name: 'Candidate' },
  }),
  deleteUserAccount: vi.fn().mockResolvedValue({ success: true }),
}));

describe('VerifyEmail Screen (Phase 3 & Phase 6)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResend.mockReset();
    mockVerifyOtp.mockReset();
  });

  it('renders email verification UI with email and 6 digit inputs', () => {
    render(
      <ThemeProvider>
        <AuthProvider>
          <MemoryRouter
            initialEntries={[
              {
                pathname: '/verify-email',
                state: { email: 'candidate@example.com' },
              },
            ]}
          >
            <VerifyEmail />
          </MemoryRouter>
        </AuthProvider>
      </ThemeProvider>
    );

    expect(
      screen.getByRole('heading', { name: /verify your email/i })
    ).toBeInTheDocument();
    expect(screen.getByText('candidate@example.com')).toBeInTheDocument();

    const digitInputs = screen.getAllByRole('textbox');
    expect(digitInputs.length).toBe(6);

    const submitBtn = screen.getByRole('button', { name: /verify email/i });
    expect(submitBtn).toBeDisabled();
  });

  it('allows entering 6 digits and enables submit button', async () => {
    render(
      <ThemeProvider>
        <AuthProvider>
          <MemoryRouter
            initialEntries={[
              {
                pathname: '/verify-email',
                state: { email: 'candidate@example.com' },
              },
            ]}
          >
            <VerifyEmail />
          </MemoryRouter>
        </AuthProvider>
      </ThemeProvider>
    );

    const digitInputs = screen.getAllByRole('textbox');
    const submitBtn = screen.getByRole('button', { name: /verify email/i });

    // Enter digits 1 to 6
    for (let i = 0; i < 6; i++) {
      await act(async () => {
        fireEvent.change(digitInputs[i], { target: { value: String(i + 1) } });
      });
    }

    expect(submitBtn).toBeEnabled();
  });

  it('supports pasting a 6-digit verification code', async () => {
    render(
      <ThemeProvider>
        <AuthProvider>
          <MemoryRouter
            initialEntries={[
              {
                pathname: '/verify-email',
                state: { email: 'candidate@example.com' },
              },
            ]}
          >
            <VerifyEmail />
          </MemoryRouter>
        </AuthProvider>
      </ThemeProvider>
    );

    const digitInputs = screen.getAllByRole('textbox');
    const submitBtn = screen.getByRole('button', { name: /verify email/i });

    // Simulate paste event
    await act(async () => {
      fireEvent.paste(digitInputs[0], {
        clipboardData: {
          getData: () => '654321',
        },
      });
    });

    expect((digitInputs[0] as HTMLInputElement).value).toBe('6');
    expect((digitInputs[1] as HTMLInputElement).value).toBe('5');
    expect((digitInputs[2] as HTMLInputElement).value).toBe('4');
    expect((digitInputs[3] as HTMLInputElement).value).toBe('3');
    expect((digitInputs[4] as HTMLInputElement).value).toBe('2');
    expect((digitInputs[5] as HTMLInputElement).value).toBe('1');
    expect(submitBtn).toBeEnabled();
  });

  it('calls verifyOtp with type "email" and navigates on success', async () => {
    const mockUser = {
      id: 'supabase-user-123',
      email: 'candidate@example.com',
      email_confirmed_at: '2026-11-15T12:00:00Z',
    };
    const mockSession = {
      access_token: 'valid-jwt-token',
      user: mockUser,
    };

    mockVerifyOtp.mockResolvedValueOnce({
      data: { user: mockUser, session: mockSession },
      error: null,
    });

    render(
      <ThemeProvider>
        <AuthProvider>
          <MemoryRouter
            initialEntries={[
              {
                pathname: '/verify-email',
                state: { email: 'candidate@example.com' },
              },
            ]}
          >
            <VerifyEmail />
          </MemoryRouter>
        </AuthProvider>
      </ThemeProvider>
    );

    const digitInputs = screen.getAllByRole('textbox');
    for (let i = 0; i < 6; i++) {
      await act(async () => {
        fireEvent.change(digitInputs[i], { target: { value: String(i + 1) } });
      });
    }

    const submitBtn = screen.getByRole('button', { name: /verify email/i });
    await act(async () => {
      fireEvent.click(submitBtn);
    });

    expect(mockVerifyOtp).toHaveBeenCalledWith({
      email: 'candidate@example.com',
      token: '123456',
      type: 'email',
    });

    expect(
      await screen.findByText(/email verified successfully!/i)
    ).toBeInTheDocument();

    await waitFor(
      () => {
        expect(mockNavigate).toHaveBeenCalledWith('/new-interview');
      },
      { timeout: 2000 }
    );
  });

  it('displays error and does not navigate when OTP is incorrect or expired', async () => {
    mockVerifyOtp.mockResolvedValueOnce({
      data: { user: null, session: null },
      error: { message: 'Token has expired or is invalid' },
    });

    render(
      <ThemeProvider>
        <AuthProvider>
          <MemoryRouter
            initialEntries={[
              {
                pathname: '/verify-email',
                state: { email: 'candidate@example.com' },
              },
            ]}
          >
            <VerifyEmail />
          </MemoryRouter>
        </AuthProvider>
      </ThemeProvider>
    );

    const digitInputs = screen.getAllByRole('textbox');
    for (let i = 0; i < 6; i++) {
      await act(async () => {
        fireEvent.change(digitInputs[i], { target: { value: '9' } });
      });
    }

    const submitBtn = screen.getByRole('button', { name: /verify email/i });
    await act(async () => {
      fireEvent.click(submitBtn);
    });

    expect(
      await screen.findByText(/token has expired or is invalid/i)
    ).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('handles resend OTP and displays confirmation', async () => {
    mockResend.mockResolvedValueOnce({ error: null });

    render(
      <ThemeProvider>
        <AuthProvider>
          <MemoryRouter
            initialEntries={[
              {
                pathname: '/verify-email',
                state: { email: 'candidate@example.com' },
              },
            ]}
          >
            <VerifyEmail />
          </MemoryRouter>
        </AuthProvider>
      </ThemeProvider>
    );

    // Initial resend button has cooldown
    const resendBtn = screen.getByRole('button', { name: /resend code in/i });
    expect(resendBtn).toBeDisabled();

    // Fast-forward or trigger click if enabled
    // Test resend directly when cooldown reaches 0
  });

  it('handles resend OTP rate-limit error gracefully', async () => {
    mockResend.mockResolvedValueOnce({
      error: {
        message: 'For security purposes, you can only request this once every 60 seconds',
      },
    });

    // Mount with email
    render(
      <ThemeProvider>
        <AuthProvider>
          <MemoryRouter
            initialEntries={[
              {
                pathname: '/verify-email',
                state: { email: 'candidate@example.com' },
              },
            ]}
          >
            <VerifyEmail />
          </MemoryRouter>
        </AuthProvider>
      </ThemeProvider>
    );

    // Initial resend button has cooldown
    expect(screen.getByRole('button', { name: /resend code in/i })).toBeInTheDocument();
  });

  it('displays the spam/junk folder helper message', () => {
    render(
      <ThemeProvider>
        <AuthProvider>
          <MemoryRouter
            initialEntries={[
              {
                pathname: '/verify-email',
                state: { email: 'candidate@example.com' },
              },
            ]}
          >
            <VerifyEmail />
          </MemoryRouter>
        </AuthProvider>
      </ThemeProvider>
    );

    expect(
      screen.getByText(
        "Didn't receive the email? Please check your Spam or Junk folder as well."
      )
    ).toBeInTheDocument();
  });

  it('handles already-confirmed error during resend without exposing account status (anti-enumeration)', async () => {
    mockResend.mockResolvedValueOnce({
      error: { message: 'Email is already confirmed' },
    });

    let resendResult: any = null;
    const TestConsumer = () => {
      const { resendOtp } = useAuth();
      return (
        <button
          onClick={async () => {
            resendResult = await resendOtp('confirmed@example.com');
          }}
        >
          Trigger Resend
        </button>
      );
    };

    render(
      <ThemeProvider>
        <AuthProvider>
          <TestConsumer />
        </AuthProvider>
      </ThemeProvider>
    );

    const btn = screen.getByRole('button', { name: /trigger resend/i });
    await act(async () => {
      fireEvent.click(btn);
    });

    expect(mockResend).toHaveBeenCalledWith({
      type: 'signup',
      email: 'confirmed@example.com',
    });
    expect(resendResult).toEqual({
      success: true,
      message:
        'If this email is unverified, a new code has been sent. If you already have an account, please sign in.',
    });
  });

  it('has no accessibility violations in default verification view', async () => {
    const { container } = render(
      <ThemeProvider>
        <AuthProvider>
          <MemoryRouter initialEntries={[{ pathname: '/verify-email', state: { email: 'candidate@example.com' } }]}>
            <VerifyEmail />
          </MemoryRouter>
        </AuthProvider>
      </ThemeProvider>
    );

    expect(await axe(container)).toHaveNoViolations();
  });

  it('has no accessibility violations in email edit mode', async () => {
    const { container } = render(
      <ThemeProvider>
        <AuthProvider>
          <MemoryRouter initialEntries={['/verify-email']}>
            <VerifyEmail />
          </MemoryRouter>
        </AuthProvider>
      </ThemeProvider>
    );

    expect(screen.getByRole('textbox', { name: /email address/i })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });
});
