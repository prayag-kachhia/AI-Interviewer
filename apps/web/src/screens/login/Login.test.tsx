import "@testing-library/jest-dom/vitest";
import { useState } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router";
import { Login } from "./Login";
import { AuthProvider, useAuth } from "../../context/AuthContext";
import { ThemeProvider } from "../../context/ThemeContext";
import { getStaySignedIn, clearAuthStorage, STAY_SIGNED_IN_KEY } from "../../lib/authStorage";

// Mock Supabase client
const mockGetSession = vi.fn().mockResolvedValue({ data: { session: null }, error: null });
const mockOnAuthStateChange = vi.fn((_callback?: any) => {
  return { data: { subscription: { unsubscribe: vi.fn() } } };
});
const mockSignOut = vi.fn().mockResolvedValue({ error: null });
const mockSignInWithOAuth = vi.fn().mockResolvedValue({ error: null });
const mockResetPasswordForEmail = vi.fn().mockResolvedValue({ error: null });
const mockSignInWithPassword = vi.fn();
const mockSignUp = vi.fn();

vi.mock("../../lib/supabase", () => ({
  isSupabaseConfigured: true,
  supabase: {
    auth: {
      getSession: () => mockGetSession(),
      onAuthStateChange: (callback: any) => mockOnAuthStateChange(callback),
      signOut: () => mockSignOut(),
      signInWithOAuth: (params: any) => mockSignInWithOAuth(params),
      signInWithPassword: (params: any) => mockSignInWithPassword(params),
      signUp: (params: any) => mockSignUp(params),
      resetPasswordForEmail: (email: any, opts: any) => mockResetPasswordForEmail(email, opts),
    },
  },
}));

vi.mock("../../lib/api", () => ({
  getMe: vi.fn().mockResolvedValue({ success: true, data: { id: "u1", email: "test@example.com", name: "Test User" } }),
  deleteUserAccount: vi.fn().mockResolvedValue({ success: true }),
}));

describe("Login Screen - Google Sign In Button Visibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders Continue with Google button on initial load", async () => {
    render(
      <ThemeProvider>
        <AuthProvider>
          <MemoryRouter initialEntries={["/login"]}>
            <Routes>
              <Route path="/login" element={<Login />} />
            </Routes>
          </MemoryRouter>
        </AuthProvider>
      </ThemeProvider>
    );

    const googleButtons = await screen.findAllByRole("button", { name: /continue with google/i });
    expect(googleButtons.length).toBeGreaterThanOrEqual(1);
    expect(googleButtons[0]).toBeInTheDocument();
  });

  it("renders Continue with Google button when arriving at login with signed-out state", async () => {
    render(
      <ThemeProvider>
        <AuthProvider>
          <MemoryRouter
            initialEntries={[
              {
                pathname: "/login",
                state: {
                  message: "You have been signed out. All your profile data and resumes remain safely stored in the database.",
                  mode: "signin",
                },
              },
            ]}
          >
            <Routes>
              <Route path="/login" element={<Login />} />
            </Routes>
          </MemoryRouter>
        </AuthProvider>
      </ThemeProvider>
    );

    const googleButtons = await screen.findAllByRole("button", { name: /continue with google/i });
    expect(googleButtons.length).toBeGreaterThanOrEqual(1);
    expect(googleButtons[0]).toBeInTheDocument();
    expect(screen.getByText(/you have been signed out/i)).toBeInTheDocument();
  });

  it("remains visible after signing in and then signing out via AuthContext / Navbar", async () => {
    let authCallback: ((event: string, session: any) => void) | null = null;
    mockOnAuthStateChange.mockImplementation((callback) => {
      authCallback = callback;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    });

    // Mock initial session as authenticated
    const mockUser = {
      id: "google-user-123",
      email: "googleuser@example.com",
      user_metadata: { full_name: "Google User" },
    };
    mockGetSession.mockResolvedValueOnce({
      data: { session: { user: mockUser, access_token: "mock-token" } },
      error: null,
    });
    vi.mocked(await import("../../lib/api")).getMe.mockResolvedValueOnce({
      success: true,
      data: { id: "google-user-123", email: "googleuser@example.com", name: "Google User" },
    });

    const TestAuthConsumer = () => {
      const { user, signOut } = useAuth();
      return (
        <div>
          {user ? (
            <div>
              <span data-testid="user-email">{user.email}</span>
              <button data-testid="logout-btn" onClick={() => signOut()}>
                Logout
              </button>
            </div>
          ) : (
            <Login />
          )}
        </div>
      );
    };

    render(
      <ThemeProvider>
        <AuthProvider>
          <MemoryRouter initialEntries={["/login"]}>
            <TestAuthConsumer />
          </MemoryRouter>
        </AuthProvider>
      </ThemeProvider>
    );

    // Should initially show the logged-in state
    expect(await screen.findByTestId("user-email")).toHaveTextContent("googleuser@example.com");

    // Click logout
    const logoutBtn = screen.getByTestId("logout-btn");
    await act(async () => {
      logoutBtn.click();
    });

    // Fire SIGNED_OUT from Supabase listener as real Supabase would
    if (authCallback) {
      await act(async () => {
        (authCallback as any)("SIGNED_OUT", null);
      });
    }

    // Now Login should be rendered, and Google sign in button must be visible!
    const googleButtons = await screen.findAllByRole("button", { name: /continue with google/i });
    expect(googleButtons.length).toBeGreaterThanOrEqual(1);
    expect(googleButtons[0]).toBeInTheDocument();
  });

  it("remains visible when switching between Sign In and Sign Up tabs", async () => {
    render(
      <ThemeProvider>
        <AuthProvider>
          <MemoryRouter initialEntries={["/login"]}>
            <Routes>
              <Route path="/login" element={<Login />} />
            </Routes>
          </MemoryRouter>
        </AuthProvider>
      </ThemeProvider>
    );

    // Initial sign in tab has Google button
    let googleButtons = await screen.findAllByRole("button", { name: /continue with google/i });
    expect(googleButtons.length).toBeGreaterThanOrEqual(1);

    // Switch to Sign Up tab
    const signUpTabs = screen.getAllByRole("tab", { name: /sign up/i });
    await act(async () => {
      signUpTabs[0].click();
    });

    // On Sign Up tab, Google button must still be in the document
    googleButtons = await screen.findAllByRole("button", { name: /continue with google/i });
    expect(googleButtons.length).toBeGreaterThanOrEqual(1);

    // Switch back to Sign In tab
    const signInTabs = screen.getAllByRole("tab", { name: /sign in/i });
    await act(async () => {
      signInTabs[0].click();
    });

    // Still present
    googleButtons = await screen.findAllByRole("button", { name: /continue with google/i });
    expect(googleButtons.length).toBeGreaterThanOrEqual(1);
  });

  it("remains visible after email/password sign-in and subsequent sign-out", async () => {
    let authCallback: ((event: string, session: any) => void) | null = null;
    mockOnAuthStateChange.mockImplementation((callback) => {
      authCallback = callback;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    });

    const mockEmailUser = {
      id: "email-user-456",
      email: "passworduser@example.com",
      user_metadata: { name: "Email User" },
    };
    mockGetSession.mockResolvedValueOnce({
      data: { session: { user: mockEmailUser, access_token: "mock-pw-token" } },
      error: null,
    });
    vi.mocked(await import("../../lib/api")).getMe.mockResolvedValueOnce({
      success: true,
      data: { id: "email-user-456", email: "passworduser@example.com", name: "Email User" },
    });

    const TestFlow = () => {
      const { user, signOut } = useAuth();
      return (
        <div>
          {user ? (
            <div>
              <span data-testid="user-email">{user.email}</span>
              <button data-testid="logout-btn" onClick={() => signOut()}>
                Logout
              </button>
            </div>
          ) : (
            <Login />
          )}
        </div>
      );
    };

    render(
      <ThemeProvider>
        <AuthProvider>
          <MemoryRouter initialEntries={["/login"]}>
            <TestFlow />
          </MemoryRouter>
        </AuthProvider>
      </ThemeProvider>
    );

    expect(await screen.findByTestId("user-email")).toHaveTextContent("passworduser@example.com");

    // Click logout
    const logoutBtn = screen.getByTestId("logout-btn");
    await act(async () => {
      logoutBtn.click();
    });

    if (authCallback) {
      await act(async () => {
        (authCallback as any)("SIGNED_OUT", null);
      });
    }

    const googleButtons = await screen.findAllByRole("button", { name: /continue with google/i });
    expect(googleButtons.length).toBeGreaterThanOrEqual(1);
    expect(googleButtons[0]).toBeInTheDocument();
  });

  it("remains visible on page refresh with persistent route location", async () => {
    const { unmount } = render(
      <ThemeProvider>
        <AuthProvider>
          <MemoryRouter initialEntries={["/login"]}>
            <Routes>
              <Route path="/login" element={<Login />} />
            </Routes>
          </MemoryRouter>
        </AuthProvider>
      </ThemeProvider>
    );

    let googleButtons = await screen.findAllByRole("button", { name: /continue with google/i });
    expect(googleButtons[0]).toBeInTheDocument();

    // Simulate page unmount and remount (page refresh)
    unmount();

    render(
      <ThemeProvider>
        <AuthProvider>
          <MemoryRouter initialEntries={["/login"]}>
            <Routes>
              <Route path="/login" element={<Login />} />
            </Routes>
          </MemoryRouter>
        </AuthProvider>
      </ThemeProvider>
    );

    googleButtons = await screen.findAllByRole("button", { name: /continue with google/i });
    expect(googleButtons.length).toBeGreaterThanOrEqual(1);
    expect(googleButtons[0]).toBeInTheDocument();
  });
});

describe("Login Screen - Forgot Password Flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders Forgot password? button and toggles reset form", async () => {
    render(
      <ThemeProvider>
        <AuthProvider>
          <MemoryRouter initialEntries={["/login"]}>
            <Routes>
              <Route path="/login" element={<Login />} />
            </Routes>
          </MemoryRouter>
        </AuthProvider>
      </ThemeProvider>
    );

    const forgotBtn = screen.getByRole("button", { name: /forgot password\?/i });
    expect(forgotBtn).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(forgotBtn);
    });

    expect(screen.getByRole("heading", { name: /reset password/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /send reset link/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /← back to sign in/i })).toBeInTheDocument();

    // Toggle back to sign in
    const backBtn = screen.getByRole("button", { name: /← back to sign in/i });
    await act(async () => {
      fireEvent.click(backBtn);
    });

    expect(screen.queryByRole("button", { name: /send reset link/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign in to dashboard/i })).toBeInTheDocument();
  });

  it("calls resetPasswordForEmail and shows confirmation message", async () => {
    mockResetPasswordForEmail.mockResolvedValueOnce({ error: null });

    render(
      <ThemeProvider>
        <AuthProvider>
          <MemoryRouter initialEntries={["/login"]}>
            <Routes>
              <Route path="/login" element={<Login />} />
            </Routes>
          </MemoryRouter>
        </AuthProvider>
      </ThemeProvider>
    );

    const forgotBtn = screen.getByRole("button", { name: /forgot password\?/i });
    await act(async () => {
      fireEvent.click(forgotBtn);
    });

    const emailInputs = screen.getAllByPlaceholderText(/name@company.com/i);
    await act(async () => {
      fireEvent.change(emailInputs[0], { target: { value: "candidate@example.com" } });
    });

    const sendBtn = screen.getByRole("button", { name: /send reset link/i });
    await act(async () => {
      fireEvent.click(sendBtn);
    });

    expect(mockResetPasswordForEmail).toHaveBeenCalledWith(
      "candidate@example.com",
      expect.objectContaining({
        redirectTo: expect.stringContaining("/reset-password"),
      })
    );

    expect(await screen.findByText(/if an account exists for that email, a password reset link has been sent/i)).toBeInTheDocument();
    expect(screen.getByText(/didn't receive the email\? please check your spam or junk folder as well\./i)).toBeInTheDocument();
  });
});

describe("Login Screen - Sign Up Password Strength Meter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("displays password strength checklist and blocks submission until strong", async () => {
    render(
      <ThemeProvider>
        <AuthProvider>
          <MemoryRouter initialEntries={[{ pathname: "/login", state: { mode: "signup" } }]}>
            <Routes>
              <Route path="/login" element={<Login />} />
            </Routes>
          </MemoryRouter>
        </AuthProvider>
      </ThemeProvider>
    );

    const nameInput = screen.getByPlaceholderText(/jane doe/i);
    const emailInputs = screen.getAllByPlaceholderText(/name@company.com/i);
    const emailInput = emailInputs[0];
    const passwordInput = screen.getByPlaceholderText(/create a strong password/i);
    const confirmInput = screen.getByPlaceholderText(/re-enter password/i);
    const submitBtn = screen.getByRole("button", { name: /create free account/i });

    // Initially disabled
    expect(submitBtn).toBeDisabled();

    // Fill valid name and email
    await act(async () => {
      fireEvent.change(nameInput, { target: { value: "Jane Candidate" } });
      fireEvent.change(emailInput, { target: { value: "jane@company.com" } });
    });
    expect(submitBtn).toBeDisabled();

    // Type a weak password
    await act(async () => {
      fireEvent.change(passwordInput, { target: { value: "weakpass" } });
      fireEvent.change(confirmInput, { target: { value: "weakpass" } });
    });

    // Password strength meter should appear with Weak badge
    expect(screen.getByText(/strength:/i)).toBeInTheDocument();
    expect(screen.getByText(/weak/i)).toBeInTheDocument();
    expect(submitBtn).toBeDisabled();

    // Type a password that passes all 7 rules
    await act(async () => {
      fireEvent.change(passwordInput, { target: { value: "Tr0ng!P@ss2026#" } });
      fireEvent.change(confirmInput, { target: { value: "Tr0ng!P@ss2026#" } });
    });

    expect(screen.getByText(/strong/i)).toBeInTheDocument();
    expect(submitBtn).toBeEnabled();
  });
});

describe("Login Screen - Email Format Validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects invalid email syntax on Sign In and blocks submission", async () => {
    render(
      <ThemeProvider>
        <AuthProvider>
          <MemoryRouter initialEntries={["/login"]}>
            <Routes>
              <Route path="/login" element={<Login />} />
            </Routes>
          </MemoryRouter>
        </AuthProvider>
      </ThemeProvider>
    );

    const emailInputs = screen.getAllByPlaceholderText(/name@company.com/i);
    const passwordInputs = screen.getAllByPlaceholderText(/••••••••/i);
    const signInBtn = screen.getByRole("button", { name: /sign in to dashboard/i });

    await act(async () => {
      fireEvent.change(emailInputs[0], { target: { value: "invalid-email" } });
      fireEvent.change(passwordInputs[0], { target: { value: "SomePassword123!" } });
      fireEvent.submit(signInBtn.closest("form")!);
    });

    expect(mockSignInWithPassword).not.toHaveBeenCalled();
    expect(await screen.findByText(/please enter a valid email address/i)).toBeInTheDocument();
  });

  it("rejects invalid email syntax on Forgot Password flow", async () => {
    render(
      <ThemeProvider>
        <AuthProvider>
          <MemoryRouter initialEntries={["/login"]}>
            <Routes>
              <Route path="/login" element={<Login />} />
            </Routes>
          </MemoryRouter>
        </AuthProvider>
      </ThemeProvider>
    );

    const forgotBtn = screen.getByRole("button", { name: /forgot password\?/i });
    await act(async () => {
      fireEvent.click(forgotBtn);
    });

    const emailInputs = screen.getAllByPlaceholderText(/name@company.com/i);
    const sendBtn = screen.getByRole("button", { name: /send reset link/i });

    await act(async () => {
      fireEvent.change(emailInputs[0], { target: { value: "candidate@nodomain" } });
      fireEvent.click(sendBtn);
    });

    expect(mockResetPasswordForEmail).not.toHaveBeenCalled();
    expect(await screen.findByText(/email domain must include a top-level domain/i)).toBeInTheDocument();
  });
});

describe("Login Screen - Email OTP Signup & Unverified Sign In", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("navigates to /verify-email when signup requires email confirmation (no immediate session)", async () => {
    mockSignUp.mockResolvedValueOnce({
      data: {
        user: { id: "new-user-123", email: "candidate@example.com" },
        session: null,
      },
      error: null,
    });

    render(
      <ThemeProvider>
        <AuthProvider>
          <MemoryRouter initialEntries={[{ pathname: "/login", state: { mode: "signup" } }]}>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route
                path="/verify-email"
                element={<div data-testid="verify-screen">Verify Screen</div>}
              />
            </Routes>
          </MemoryRouter>
        </AuthProvider>
      </ThemeProvider>
    );

    const nameInput = screen.getByPlaceholderText(/jane doe/i);
    const emailInputs = screen.getAllByPlaceholderText(/name@company.com/i);
    const passwordInput = screen.getByPlaceholderText(/create a strong password/i);
    const confirmInput = screen.getByPlaceholderText(/re-enter password/i);
    const submitBtn = screen.getByRole("button", { name: /create free account/i });

    await act(async () => {
      fireEvent.change(nameInput, { target: { value: "Candidate Name" } });
      fireEvent.change(emailInputs[0], { target: { value: "candidate@example.com" } });
      fireEvent.change(passwordInput, { target: { value: "Str0ng!P@ss2026#" } });
      fireEvent.change(confirmInput, { target: { value: "Str0ng!P@ss2026#" } });
    });

    await act(async () => {
      fireEvent.click(submitBtn);
    });

    expect(mockSignUp).toHaveBeenCalledWith({
      email: "candidate@example.com",
      password: "Str0ng!P@ss2026#",
      options: expect.objectContaining({
        data: { full_name: "Candidate Name" },
      }),
    });

    expect(await screen.findByTestId("verify-screen")).toBeInTheDocument();
  });

  it("navigates to /verify-email without revealing account existence when email has empty identities (anti-enumeration)", async () => {
    mockSignUp.mockResolvedValueOnce({
      data: {
        user: { id: "existing-user-123", email: "existing@example.com", identities: [] },
        session: null,
      },
      error: null,
    });

    render(
      <ThemeProvider>
        <AuthProvider>
          <MemoryRouter initialEntries={[{ pathname: "/login", state: { mode: "signup" } }]}>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route
                path="/verify-email"
                element={<div data-testid="verify-screen">Verify Screen</div>}
              />
            </Routes>
          </MemoryRouter>
        </AuthProvider>
      </ThemeProvider>
    );

    const nameInput = screen.getByPlaceholderText(/jane doe/i);
    const emailInputs = screen.getAllByPlaceholderText(/name@company.com/i);
    const passwordInput = screen.getByPlaceholderText(/create a strong password/i);
    const confirmInput = screen.getByPlaceholderText(/re-enter password/i);
    const submitBtn = screen.getByRole("button", { name: /create free account/i });

    await act(async () => {
      fireEvent.change(nameInput, { target: { value: "Candidate Name" } });
      fireEvent.change(emailInputs[0], { target: { value: "existing@example.com" } });
      fireEvent.change(passwordInput, { target: { value: "Str0ng!P@ss2026#" } });
      fireEvent.change(confirmInput, { target: { value: "Str0ng!P@ss2026#" } });
      fireEvent.click(submitBtn);
    });

    // Navigates uniformly to verify-email, never displaying "An account with this email already exists"
    expect(await screen.findByTestId("verify-screen")).toBeInTheDocument();
    expect(screen.queryByText(/already exists/i)).not.toBeInTheDocument();
  });

  it("navigates to /verify-email without revealing account existence when error indicates already registered", async () => {
    mockSignUp.mockResolvedValueOnce({
      data: { user: null, session: null },
      error: { message: "User already registered" },
    });

    render(
      <ThemeProvider>
        <AuthProvider>
          <MemoryRouter initialEntries={[{ pathname: "/login", state: { mode: "signup" } }]}>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route
                path="/verify-email"
                element={<div data-testid="verify-screen">Verify Screen</div>}
              />
            </Routes>
          </MemoryRouter>
        </AuthProvider>
      </ThemeProvider>
    );

    const nameInput = screen.getByPlaceholderText(/jane doe/i);
    const emailInputs = screen.getAllByPlaceholderText(/name@company.com/i);
    const passwordInput = screen.getByPlaceholderText(/create a strong password/i);
    const confirmInput = screen.getByPlaceholderText(/re-enter password/i);
    const submitBtn = screen.getByRole("button", { name: /create free account/i });

    await act(async () => {
      fireEvent.change(nameInput, { target: { value: "Candidate Name" } });
      fireEvent.change(emailInputs[0], { target: { value: "existing@example.com" } });
      fireEvent.change(passwordInput, { target: { value: "Str0ng!P@ss2026#" } });
      fireEvent.change(confirmInput, { target: { value: "Str0ng!P@ss2026#" } });
      fireEvent.click(submitBtn);
    });

    // Navigates uniformly without exposing error message to potential attacker
    expect(await screen.findByTestId("verify-screen")).toBeInTheDocument();
    expect(screen.queryByText(/user already registered/i)).not.toBeInTheDocument();
  });

  it("displays verification prompt when unverified user tries to sign in", async () => {
    mockSignInWithPassword.mockResolvedValueOnce({
      data: { user: null, session: null },
      error: { message: "Email not confirmed" },
    });

    render(
      <ThemeProvider>
        <AuthProvider>
          <MemoryRouter initialEntries={["/login"]}>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route
                path="/verify-email"
                element={<div data-testid="verify-screen">Verify Screen</div>}
              />
            </Routes>
          </MemoryRouter>
        </AuthProvider>
      </ThemeProvider>
    );

    const emailInputs = screen.getAllByPlaceholderText(/name@company.com/i);
    const passwordInputs = screen.getAllByPlaceholderText(/••••••••/i);
    const signInBtn = screen.getByRole("button", { name: /sign in to dashboard/i });

    await act(async () => {
      fireEvent.change(emailInputs[0], { target: { value: "unverified@example.com" } });
      fireEvent.change(passwordInputs[0], { target: { value: "Str0ng!P@ss2026#" } });
      fireEvent.click(signInBtn);
    });

    expect(
      await screen.findByText(/your email address has not been verified yet/i)
    ).toBeInTheDocument();

    const verifyOtpBtn = screen.getByRole("button", { name: /enter verification code/i });
    expect(verifyOtpBtn).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(verifyOtpBtn);
    });

    expect(await screen.findByTestId("verify-screen")).toBeInTheDocument();
  });
});

describe("Login Screen - Stay Signed In (FR-05 / Issue #198)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    clearAuthStorage();
  });

  it("renders 'Stay signed in' checkbox on sign-in form and it is unchecked by default", async () => {
    render(
      <ThemeProvider>
        <AuthProvider>
          <MemoryRouter initialEntries={["/login"]}>
            <Routes>
              <Route path="/login" element={<Login />} />
            </Routes>
          </MemoryRouter>
        </AuthProvider>
      </ThemeProvider>
    );

    const checkbox = screen.getByRole("checkbox", { name: /stay signed in/i });
    expect(checkbox).toBeInTheDocument();
    expect(checkbox).not.toBeChecked();
    expect(getStaySignedIn()).toBe(false);
  });

  it("allows toggling the 'Stay signed in' checkbox", async () => {
    render(
      <ThemeProvider>
        <AuthProvider>
          <MemoryRouter initialEntries={["/login"]}>
            <Routes>
              <Route path="/login" element={<Login />} />
            </Routes>
          </MemoryRouter>
        </AuthProvider>
      </ThemeProvider>
    );

    const checkbox = screen.getByRole("checkbox", { name: /stay signed in/i });
    expect(checkbox).not.toBeChecked();

    await act(async () => {
      fireEvent.click(checkbox);
    });
    expect(checkbox).toBeChecked();
    expect(getStaySignedIn()).toBe(true);

    await act(async () => {
      fireEvent.click(checkbox);
    });
    expect(checkbox).not.toBeChecked();
    expect(getStaySignedIn()).toBe(false);
  });

  it("does not render 'Stay signed in' checkbox on sign-up form", async () => {
    render(
      <ThemeProvider>
        <AuthProvider>
          <MemoryRouter initialEntries={[{ pathname: "/login", state: { mode: "signup" } }]}>
            <Routes>
              <Route path="/login" element={<Login />} />
            </Routes>
          </MemoryRouter>
        </AuthProvider>
      </ThemeProvider>
    );

    expect(screen.queryByRole("checkbox", { name: /stay signed in/i })).not.toBeInTheDocument();
  });

  it("submits email/password sign-in with staySignedIn: false when unchecked", async () => {
    mockSignInWithPassword.mockResolvedValueOnce({
      data: {
        user: { id: "user-123", email: "user@example.com" },
        session: { access_token: "mock-token", user: { id: "user-123", email: "user@example.com" } },
      },
      error: null,
    });

    render(
      <ThemeProvider>
        <AuthProvider>
          <MemoryRouter initialEntries={["/login"]}>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/new-interview" element={<div data-testid="new-interview">New Interview</div>} />
            </Routes>
          </MemoryRouter>
        </AuthProvider>
      </ThemeProvider>
    );

    const emailInputs = screen.getAllByPlaceholderText(/name@company.com/i);
    const passwordInputs = screen.getAllByPlaceholderText(/••••••••/i);
    const checkbox = screen.getByRole("checkbox", { name: /stay signed in/i });
    const signInBtn = screen.getByRole("button", { name: /sign in to dashboard/i });

    expect(checkbox).not.toBeChecked();

    await act(async () => {
      fireEvent.change(emailInputs[0], { target: { value: "user@example.com" } });
      fireEvent.change(passwordInputs[0], { target: { value: "Password123!" } });
      fireEvent.click(signInBtn);
    });

    expect(mockSignInWithPassword).toHaveBeenCalledWith({
      email: "user@example.com",
      password: "Password123!",
    });
    expect(getStaySignedIn()).toBe(false);
    expect(sessionStorage.getItem(STAY_SIGNED_IN_KEY)).toBe("false");
    expect(localStorage.getItem(STAY_SIGNED_IN_KEY)).toBe("false");
  });

  it("submits email/password sign-in with staySignedIn: true when checked", async () => {
    mockSignInWithPassword.mockResolvedValueOnce({
      data: {
        user: { id: "user-123", email: "user@example.com" },
        session: { access_token: "mock-token", user: { id: "user-123", email: "user@example.com" } },
      },
      error: null,
    });

    render(
      <ThemeProvider>
        <AuthProvider>
          <MemoryRouter initialEntries={["/login"]}>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/new-interview" element={<div data-testid="new-interview">New Interview</div>} />
            </Routes>
          </MemoryRouter>
        </AuthProvider>
      </ThemeProvider>
    );

    const emailInputs = screen.getAllByPlaceholderText(/name@company.com/i);
    const passwordInputs = screen.getAllByPlaceholderText(/••••••••/i);
    const checkbox = screen.getByRole("checkbox", { name: /stay signed in/i });
    const signInBtn = screen.getByRole("button", { name: /sign in to dashboard/i });

    await act(async () => {
      fireEvent.click(checkbox);
    });
    expect(checkbox).toBeChecked();

    await act(async () => {
      fireEvent.change(emailInputs[0], { target: { value: "user@example.com" } });
      fireEvent.change(passwordInputs[0], { target: { value: "Password123!" } });
      fireEvent.click(signInBtn);
    });

    expect(mockSignInWithPassword).toHaveBeenCalledWith({
      email: "user@example.com",
      password: "Password123!",
    });
    expect(getStaySignedIn()).toBe(true);
    expect(localStorage.getItem(STAY_SIGNED_IN_KEY)).toBe("true");
  });

  it("persists staySignedIn: false when initiating Google sign-in with checkbox unchecked", async () => {
    mockSignInWithOAuth.mockResolvedValueOnce({ error: null });

    render(
      <ThemeProvider>
        <AuthProvider>
          <MemoryRouter initialEntries={["/login"]}>
            <Routes>
              <Route path="/login" element={<Login />} />
            </Routes>
          </MemoryRouter>
        </AuthProvider>
      </ThemeProvider>
    );

    const checkbox = screen.getByRole("checkbox", { name: /stay signed in/i });
    expect(checkbox).not.toBeChecked();

    const googleBtn = screen.getAllByRole("button", { name: /continue with google/i })[0];
    await act(async () => {
      fireEvent.click(googleBtn);
    });

    expect(mockSignInWithOAuth).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "google",
      })
    );
    expect(getStaySignedIn()).toBe(false);
    expect(sessionStorage.getItem(STAY_SIGNED_IN_KEY)).toBe("false");
    expect(localStorage.getItem(STAY_SIGNED_IN_KEY)).toBe("false");
  });

  it("persists staySignedIn: true when initiating Google sign-in with checkbox checked", async () => {
    mockSignInWithOAuth.mockResolvedValueOnce({ error: null });

    render(
      <ThemeProvider>
        <AuthProvider>
          <MemoryRouter initialEntries={["/login"]}>
            <Routes>
              <Route path="/login" element={<Login />} />
            </Routes>
          </MemoryRouter>
        </AuthProvider>
      </ThemeProvider>
    );

    const checkbox = screen.getByRole("checkbox", { name: /stay signed in/i });
    await act(async () => {
      fireEvent.click(checkbox);
    });
    expect(checkbox).toBeChecked();

    const googleBtn = screen.getAllByRole("button", { name: /continue with google/i })[0];
    await act(async () => {
      fireEvent.click(googleBtn);
    });

    expect(mockSignInWithOAuth).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "google",
      })
    );
    expect(getStaySignedIn()).toBe(true);
    expect(localStorage.getItem(STAY_SIGNED_IN_KEY)).toBe("true");
  });

  it("returns success and clears local auth state when sign-out fails after account deletion", async () => {
    const mockUser = {
      id: "delete-user-123",
      email: "delete@example.com",
      user_metadata: { full_name: "Delete User" },
    };

    mockGetSession.mockResolvedValueOnce({
      data: {
        session: { user: mockUser, access_token: "mock-token" },
      },
      error: null,
    });

    mockSignOut.mockRejectedValueOnce(
      new Error("Sign out failed")
    );
    const api = await import("../../lib/api");

    vi.mocked(api.getMe).mockResolvedValueOnce({
      success: true,
      data: {
        id: "delete-user-123",
        email: "delete@example.com",
        name: "Delete User",
      },
    });

    vi.mocked(api.deleteUserAccount).mockResolvedValueOnce({
      success: true,
      message: "Account deleted successfully",
    });

    const TestAuthConsumer = () => {
      const { user, deleteAccount } = useAuth();
      const [result, setResult] = useState("");

      return (
        <div>
          {user && <span data-testid="user-email">{user.email}</span>}
          <button
            onClick={async () => {
              const response = await deleteAccount();
              setResult(
                response.success ? "Deletion successful" : "Deletion failed"
              );
            }}
          >
            Delete account
          </button>
          <span data-testid="delete-result">{result}</span>
        </div>
      );
    };

    render(
      <ThemeProvider>
        <AuthProvider>
          <MemoryRouter initialEntries={["/login"]}>
            <TestAuthConsumer />
          </MemoryRouter>
        </AuthProvider>
      </ThemeProvider>
    );

    expect(await screen.findByTestId("user-email")).toHaveTextContent(
      "delete@example.com"
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /delete account/i }));
    });

    expect(api.deleteUserAccount).toHaveBeenCalledTimes(1);
    expect(mockSignOut).toHaveBeenCalledTimes(1);

    expect(screen.getByTestId("delete-result")).toHaveTextContent(
      "Deletion successful"
    );

    expect(screen.queryByTestId("user-email")).not.toBeInTheDocument();
  });

  it("preserves authentication state and does not sign out when backend account deletion fails", async () => {
    const mockUser = {
      id: "delete-fail-user",
      email: "delete-fail@example.com",
      user_metadata: { full_name: "Delete Fail User" },
    };

    mockGetSession.mockResolvedValueOnce({
      data: {
        session: { user: mockUser, access_token: "mock-token" },
      },
      error: null,
    });

    const api = await import("../../lib/api");

    vi.mocked(api.getMe).mockResolvedValueOnce({
      success: true,
      data: {
        id: "delete-fail-user",
        email: "delete-fail@example.com",
        name: "Delete Fail User",
      },
    });

    vi.mocked(api.deleteUserAccount).mockRejectedValueOnce({
      response: {
        status: 500,
        data: { message: "Internal server error during deletion" },
      },
    });

    const TestAuthConsumer = () => {
      const { user, deleteAccount } = useAuth();
      const [result, setResult] = useState("");

      return (
        <div>
          {user && <span data-testid="user-email">{user.email}</span>}
          <button
            onClick={async () => {
              const response = await deleteAccount();
              setResult(
                response.success ? "Deletion successful" : `Failed: ${response.message}`
              );
            }}
          >
            Delete account
          </button>
          <span data-testid="delete-result">{result}</span>
        </div>
      );
    };

    render(
      <ThemeProvider>
        <AuthProvider>
          <MemoryRouter initialEntries={["/login"]}>
            <TestAuthConsumer />
          </MemoryRouter>
        </AuthProvider>
      </ThemeProvider>
    );

    expect(await screen.findByTestId("user-email")).toHaveTextContent(
      "delete-fail@example.com"
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /delete account/i }));
    });

    expect(api.deleteUserAccount).toHaveBeenCalledTimes(1);
    expect(mockSignOut).not.toHaveBeenCalled();

    expect(screen.getByTestId("delete-result")).toHaveTextContent(
      "Failed: Internal server error during deletion"
    );

    expect(screen.getByTestId("user-email")).toHaveTextContent(
      "delete-fail@example.com"
    );
  });
});
