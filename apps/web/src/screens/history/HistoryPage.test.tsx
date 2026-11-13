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

test("given past interviews, lists them in the order the API returns with details and results links", async () => {
  vi.mocked(getSessions).mockResolvedValue({
    success: true,
    data: [
      {
        id: "session-new",
        userId: "u1",
        role: "backend-developer",
        status: "ENDED",
        startedAt: "2026-11-01T10:00:00Z",
        endedAt: "2026-11-01T10:05:00Z",
        feedbackStatus: "ready",
        endedEarly: true,
      },
      {
        id: "session-old",
        userId: "u1",
        role: "data-analyst",
        status: "ENDED",
        startedAt: "2026-10-01T10:00:00Z",
        endedAt: "2026-10-01T10:20:00Z",
        feedbackStatus: "failed",
        endedEarly: false,
      },
    ],
  });

  render(
    <MemoryRouter>
      <HistoryPage />
    </MemoryRouter>
  );

  expect(await screen.findByText("Backend Developer")).toBeInTheDocument();
  expect(screen.getByText("Data Analyst")).toBeInTheDocument();
  expect(screen.getAllByTestId("history-ended-early")).toHaveLength(1);

  const viewLinks = screen.getAllByRole("link", { name: /View Results/i });
  expect(viewLinks[0]).toHaveAttribute("href", "/interview/session-new/feedback");
  expect(viewLinks[1]).toHaveAttribute("href", "/interview/session-old/feedback");
});

test("displays early end reason formatted next to score/status when present (K-10, FR-19)", async () => {
  vi.mocked(getSessions).mockResolvedValue({
    success: true,
    data: [
      {
        id: "session-early",
        userId: "u1",
        role: "software-engineer",
        status: "ENDED",
        startedAt: "2026-11-01T10:00:00Z",
        endedAt: "2026-11-01T10:04:00Z",
        feedbackStatus: "ready",
        overallScore: 4.5,
        endedEarly: true,
        endReason: "technical_problem",
      },
    ],
  });

  render(
    <MemoryRouter>
      <HistoryPage />
    </MemoryRouter>
  );

  const badge = await screen.findByTestId("history-ended-early");
  expect(badge).toHaveTextContent("Ended early (Technical problem)");
  expect(screen.getByTestId("history-overall-score")).toHaveTextContent("Score: 4.5/5");
});

test("given the history request fails, shows an error", async () => {
  vi.mocked(getSessions).mockRejectedValue(new Error("Database connection failed"));

  render(
    <MemoryRouter>
      <HistoryPage />
    </MemoryRouter>
  );

  expect(await screen.findByRole("alert")).toHaveTextContent("Failed to load interview history");
});
