import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router";
import { Login } from "./Login";
import { AuthProvider, useAuth } from "../context/AuthContext";
import { ThemeProvider } from "../context/ThemeContext";

// Mock Supabase client
const mockGetSession = vi.fn().mockResolvedValue({ data: { session: null }, error: null });
const mockOnAuthStateChange = vi.fn((_callback?: any) => {
  return { data: { subscription: { unsubscribe: vi.fn() } } };
});
const mockSignOut = vi.fn().mockResolvedValue({ error: null });
const mockSignInWithOAuth = vi.fn().mockResolvedValue({ error: null });

vi.mock("../lib/supabase", () => ({
  isSupabaseConfigured: true,
  supabase: {
    auth: {
      getSession: (...args: unknown[]) => mockGetSession(...args),
      onAuthStateChange: (callback: any) => mockOnAuthStateChange(callback),
      signOut: (...args: unknown[]) => mockSignOut(...args),
      signInWithOAuth: (...args: unknown[]) => mockSignInWithOAuth(...args),
      signInWithPassword: vi.fn(),
      signUp: vi.fn(),
    },
  },
}));

vi.mock("../lib/api", () => ({
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
    vi.mocked(await import("../lib/api")).getMe.mockResolvedValueOnce({
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
    vi.mocked(await import("../lib/api")).getMe.mockResolvedValueOnce({
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
