import "@testing-library/jest-dom/vitest";
import { test, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { HistoryPage } from "./HistoryPage";
import { getSessions } from "../../lib/api";

vi.mock("../../lib/api", () => ({
  getSessions: vi.fn(),
}));

const mockNavigate = vi.fn();
vi.mock("react-router", async () => {
  const actual = await vi.importActual("react-router");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

afterEach(() => {
  vi.restoreAllMocks();
  mockNavigate.mockReset();
});

test("given sessions are loading, shows loading indicator", async () => {
  vi.mocked(getSessions).mockReturnValue(new Promise(() => {})); // never resolves

  render(
    <MemoryRouter>
      <HistoryPage />
    </MemoryRouter>
  );

  expect(screen.getByRole("status")).toBeInTheDocument();
  expect(screen.getByText("Loading interview history…")).toBeInTheDocument();
});

test("given user has no interviews, renders empty state with start interview button", async () => {
  vi.mocked(getSessions).mockResolvedValue({
    success: true,
    data: [],
  });

  render(
    <MemoryRouter>
      <HistoryPage />
    </MemoryRouter>
  );

  expect(await screen.findByText("No Interviews Yet")).toBeInTheDocument();
  expect(
    screen.getByText("You haven't practiced any mock interviews yet. Start your first session to receive AI feedback and detailed insights.")
  ).toBeInTheDocument();

  const startBtn = screen.getByRole("button", { name: /Start an Interview/i });
  expect(startBtn).toBeInTheDocument();

  fireEvent.click(startBtn);
  expect(mockNavigate).toHaveBeenCalledWith("/new-interview");
});

test("given user has past interviews, renders them sorted newest first with details and results link", async () => {
  const mockData = [
    {
      id: "session-old",
      userId: "u1",
      roleId: "r1",
      status: "ENDED" as const,
      startedAt: "2026-10-01T10:00:00Z",
      endedAt: "2026-10-01T10:20:00Z",
      createdAt: "2026-10-01T10:00:00Z",
      updatedAt: "2026-10-01T10:20:00Z",
      role: { id: "r1", name: "Backend Engineer" },
      feedbackStatus: "ready" as const,
      endedEarly: false,
    },
    {
      id: "session-new",
      userId: "u1",
      roleId: "r2",
      status: "ENDED" as const,
      startedAt: "2026-11-01T10:00:00Z",
      endedAt: "2026-11-01T10:05:00Z",
      createdAt: "2026-11-01T10:00:00Z",
      updatedAt: "2026-11-01T10:05:00Z",
      role: { id: "r2", name: "Frontend Engineer" },
      feedbackStatus: "ready" as const,
      endedEarly: true,
    },
  ];

  vi.mocked(getSessions).mockResolvedValue({
    success: true,
    data: mockData,
  });

  render(
    <MemoryRouter>
      <HistoryPage />
    </MemoryRouter>
  );

  // Both role titles rendered
  expect(await screen.findByText("Frontend Engineer")).toBeInTheDocument();
  expect(screen.getByText("Backend Engineer")).toBeInTheDocument();

  // "Ended early" badge rendered for session-new, but not for session-old
  const endedEarlyBadges = screen.getAllByTestId("history-ended-early");
  expect(endedEarlyBadges).toHaveLength(1);

  // Results link for each session
  const viewLinks = screen.getAllByRole("link", { name: /View Results/i });
  expect(viewLinks).toHaveLength(2);
  expect(viewLinks[0]).toHaveAttribute("href", "/interview/session-new/feedback");
  expect(viewLinks[1]).toHaveAttribute("href", "/interview/session-old/feedback");

  // Sorted newest first: session-new appears before session-old
  const sessionNewEl = screen.getByTestId("history-session-session-new");
  const sessionOldEl = screen.getByTestId("history-session-session-old");
  const DOCUMENT_POSITION_FOLLOWING = 4;
  expect(sessionNewEl.compareDocumentPosition(sessionOldEl) & DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test("displays error message when getSessions fails", async () => {
  vi.mocked(getSessions).mockRejectedValue(new Error("Database connection failed"));

  render(
    <MemoryRouter>
      <HistoryPage />
    </MemoryRouter>
  );

  expect(await screen.findByRole("alert")).toBeInTheDocument();
  expect(screen.getByText("Database connection failed")).toBeInTheDocument();
});
