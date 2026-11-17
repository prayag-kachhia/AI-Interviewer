import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { ResetPassword } from "./ResetPassword";
import { AuthProvider } from "../../context/AuthContext";
import { ThemeProvider } from "../../context/ThemeContext";

const mockGetSession = vi.fn();
const mockOnAuthStateChange = vi.fn();
const mockUpdateUser = vi.fn();
const mockNavigate = vi.fn();

vi.mock("react-router", async () => {
  const actual = await vi.importActual("react-router");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock("../../lib/supabase", () => ({
  isSupabaseConfigured: true,
  supabase: {
    auth: {
      getSession: () => mockGetSession(),
      onAuthStateChange: (cb: any) => mockOnAuthStateChange(cb),
      updateUser: (params: any) => mockUpdateUser(params),
      signOut: vi.fn().mockResolvedValue({ error: null }),
      signInWithPassword: vi.fn(),
      signUp: vi.fn(),
      signInWithOAuth: vi.fn(),
    },
  },
}));

vi.mock("../../lib/api", () => ({
  getMe: vi.fn().mockResolvedValue({ success: true, data: { id: "u1", email: "test@example.com" } }),
  deleteUserAccount: vi.fn().mockResolvedValue({ success: true }),
}));

describe("ResetPassword Screen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows invalid/expired link banner when no active session exists", async () => {
    mockGetSession.mockResolvedValue({ data: { session: null }, error: null });
    mockOnAuthStateChange.mockReturnValue({
      data: { subscription: { unsubscribe: vi.fn() } },
    });

    render(
      <ThemeProvider>
        <AuthProvider>
          <MemoryRouter initialEntries={["/reset-password"]}>
            <ResetPassword />
          </MemoryRouter>
        </AuthProvider>
      </ThemeProvider>
    );

    // Wait for the verification timeout/check to finish
    await waitFor(
      () => {
        expect(
          screen.getByText(/this password reset link is invalid or has expired/i)
        ).toBeInTheDocument();
      },
      { timeout: 2500 }
    );

    const backBtn = screen.getByRole("button", { name: /back to sign in/i });
    expect(backBtn).toBeInTheDocument();
    fireEvent.click(backBtn);
    expect(mockNavigate).toHaveBeenCalledWith("/login", { state: { mode: "signin" } });
  });

  it("renders form and enforces password strength and matching checks when session is valid", async () => {
    const mockSession = {
      user: { id: "user-123", email: "candidate@example.com" },
      access_token: "recovery-token",
    };
    mockGetSession.mockResolvedValue({ data: { session: mockSession }, error: null });
    mockOnAuthStateChange.mockReturnValue({
      data: { subscription: { unsubscribe: vi.fn() } },
    });

    render(
      <ThemeProvider>
        <AuthProvider>
          <MemoryRouter initialEntries={["/reset-password"]}>
            <ResetPassword />
          </MemoryRouter>
        </AuthProvider>
      </ThemeProvider>
    );

    const passwordInputs = await screen.findAllByPlaceholderText(/••••••••/i);
    const newPasswordInput = passwordInputs[0];
    const confirmPasswordInput = passwordInputs[1];
    const submitBtn = screen.getByRole("button", { name: /update password/i });

    // Enter a weak password
    await act(async () => {
      fireEvent.change(newPasswordInput, { target: { value: "weakpass" } });
      fireEvent.change(confirmPasswordInput, { target: { value: "weakpass" } });
    });

    expect(screen.getByText(/strength:/i)).toBeInTheDocument();
    expect(screen.getByText(/weak/i)).toBeInTheDocument();
    expect(submitBtn).toBeDisabled();

    // Enter a strong password but mismatch confirmation
    await act(async () => {
      fireEvent.change(newPasswordInput, { target: { value: "Str0ng!P@ss2026#" } });
      fireEvent.change(confirmPasswordInput, { target: { value: "Mismatch!123" } });
    });

    expect(screen.getByText(/passwords do not match/i)).toBeInTheDocument();
    expect(submitBtn).toBeDisabled();

    // Match confirmation
    await act(async () => {
      fireEvent.change(confirmPasswordInput, { target: { value: "Str0ng!P@ss2026#" } });
    });

    expect(screen.queryByText(/passwords do not match/i)).not.toBeInTheDocument();
    expect(submitBtn).toBeEnabled();
  });

  it("submits updated password successfully and displays success notification", async () => {
    const mockSession = {
      user: { id: "user-123", email: "candidate@example.com" },
      access_token: "recovery-token",
    };
    mockGetSession.mockResolvedValue({ data: { session: mockSession }, error: null });
    mockOnAuthStateChange.mockReturnValue({
      data: { subscription: { unsubscribe: vi.fn() } },
    });
    mockUpdateUser.mockResolvedValue({ data: { user: mockSession.user }, error: null });

    render(
      <ThemeProvider>
        <AuthProvider>
          <MemoryRouter initialEntries={["/reset-password"]}>
            <ResetPassword />
          </MemoryRouter>
        </AuthProvider>
      </ThemeProvider>
    );

    const passwordInputs = await screen.findAllByPlaceholderText(/••••••••/i);
    await act(async () => {
      fireEvent.change(passwordInputs[0], { target: { value: "Str0ng!P@ss2026#" } });
      fireEvent.change(passwordInputs[1], { target: { value: "Str0ng!P@ss2026#" } });
    });

    const submitBtn = screen.getByRole("button", { name: /update password/i });
    expect(submitBtn).toBeEnabled();

    await act(async () => {
      fireEvent.click(submitBtn);
    });

    expect(mockUpdateUser).toHaveBeenCalledWith({
      password: "Str0ng!P@ss2026#",
    });

    expect(
      await screen.findByText(/your password has been reset successfully! redirecting to login\.\.\./i)
    ).toBeInTheDocument();
  });

  it("displays backend error message when updatePassword fails", async () => {
    const mockSession = {
      user: { id: "user-123", email: "candidate@example.com" },
      access_token: "recovery-token",
    };
    mockGetSession.mockResolvedValue({ data: { session: mockSession }, error: null });
    mockOnAuthStateChange.mockReturnValue({
      data: { subscription: { unsubscribe: vi.fn() } },
    });
    mockUpdateUser.mockResolvedValue({
      data: { user: null },
      error: { message: "New password should be different from old password." },
    });

    render(
      <ThemeProvider>
        <AuthProvider>
          <MemoryRouter initialEntries={["/reset-password"]}>
            <ResetPassword />
          </MemoryRouter>
        </AuthProvider>
      </ThemeProvider>
    );

    const passwordInputs = await screen.findAllByPlaceholderText(/••••••••/i);
    await act(async () => {
      fireEvent.change(passwordInputs[0], { target: { value: "Str0ng!P@ss2026#" } });
      fireEvent.change(passwordInputs[1], { target: { value: "Str0ng!P@ss2026#" } });
    });

    const submitBtn = screen.getByRole("button", { name: /update password/i });
    await act(async () => {
      fireEvent.click(submitBtn);
    });

    expect(
      await screen.findByText(/new password should be different from old password\./i)
    ).toBeInTheDocument();
  });
});
