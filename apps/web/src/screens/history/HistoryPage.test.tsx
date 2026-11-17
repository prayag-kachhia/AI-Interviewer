import "@testing-library/jest-dom/vitest";
import { test, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
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
  vi.mocked(getSessions).mockReturnValue(new Promise(() => { })); // never resolves

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
    screen.getByText(
      "You haven't practiced any mock interviews yet. Start your first session to receive AI feedback and detailed insights."
    )
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
        overallScore: 4.5,
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
        overallScore: null,
        endedEarly: false,
      },
    ],
  });

  render(
    <MemoryRouter>
      <HistoryPage />
    </MemoryRouter>
  );

  const newCard = await screen.findByTestId("history-session-session-new");
  const oldCard = screen.getByTestId("history-session-session-old");

  expect(newCard).toHaveTextContent("Backend Developer");
  expect(oldCard).toHaveTextContent("Data Analyst");
  expect(screen.getAllByTestId("history-ended-early")).toHaveLength(1);

  const newViewLink = within(newCard).getByRole("link", { name: /View Results/i });
  const oldViewLink = within(oldCard).getByRole("link", { name: /View Results/i });
  expect(newViewLink).toHaveAttribute("href", "/interview/session-new/feedback");
  expect(oldViewLink).toHaveAttribute("href", "/interview/session-old/feedback");
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

test("given past interviews with no overall scores, renders performance graph empty message", async () => {
  vi.mocked(getSessions).mockResolvedValue({
    success: true,
    data: [
      {
        id: "session-1",
        userId: "u1",
        role: "software-engineer",
        status: "ENDED",
        startedAt: "2026-11-01T10:00:00Z",
        endedAt: "2026-11-01T10:30:00Z",
        feedbackStatus: "pending",
        overallScore: null,
      },
      {
        id: "session-2",
        userId: "u1",
        role: "data-analyst",
        status: "LIVE",
        startedAt: "2026-11-02T10:00:00Z",
        endedAt: null,
        feedbackStatus: null,
      },
    ],
  });

  render(
    <MemoryRouter>
      <HistoryPage />
    </MemoryRouter>
  );

  expect(await screen.findByTestId("performance-graph-empty")).toBeInTheDocument();
  expect(
    screen.getByText("No scored interviews available yet. Completed interviews with feedback scores will be plotted here.")
  ).toBeInTheDocument();
  expect(screen.queryByRole("img", { name: /Performance line graph/i })).not.toBeInTheDocument();

  // Cards are still rendered below
  expect(screen.getByTestId("history-session-session-1")).toBeInTheDocument();
  expect(screen.getByTestId("history-session-session-2")).toBeInTheDocument();
});

test("given scored interviews in reverse order, plots them chronologically (oldest to newest)", async () => {
  vi.mocked(getSessions).mockResolvedValue({
    success: true,
    data: [
      {
        id: "s-latest",
        userId: "u1",
        role: "software-engineer",
        status: "ENDED",
        startedAt: "2026-11-10T12:00:00Z",
        endedAt: "2026-11-10T12:30:00Z",
        feedbackStatus: "ready",
        overallScore: 4.8,
      },
      {
        id: "s-middle",
        userId: "u1",
        role: "backend-developer",
        status: "ENDED",
        startedAt: "2026-11-05T09:00:00Z",
        endedAt: "2026-11-05T09:30:00Z",
        feedbackStatus: "ready",
        overallScore: 3.5,
      },
      {
        id: "s-earliest",
        userId: "u1",
        role: "data-analyst",
        status: "ENDED",
        startedAt: "2026-10-15T14:00:00Z",
        endedAt: "2026-10-15T14:30:00Z",
        feedbackStatus: "ready",
        overallScore: 4.0,
      },
    ],
  });

  render(
    <MemoryRouter>
      <HistoryPage />
    </MemoryRouter>
  );

  const graph = await screen.findByRole("img", {
    name: "Performance line graph showing overall interview scores over time on a 1 to 5 scale",
  });
  expect(graph).toBeInTheDocument();

  expect(screen.getByTestId("performance-count")).toHaveTextContent("3");
  expect(screen.getByTestId("performance-latest-score")).toHaveTextContent("4.8 / 5");

  // Accessible breakdown table is in chronological order (s-earliest -> s-middle -> s-latest)
  const rows = screen.getAllByRole("row");
  // row 0 is the table header
  expect(within(rows[1]).getByText("Data Analyst")).toBeInTheDocument();
  expect(within(rows[1]).getByText("4 / 5")).toBeInTheDocument();

  expect(within(rows[2]).getByText("Backend Developer")).toBeInTheDocument();
  expect(within(rows[2]).getByText("3.5 / 5")).toBeInTheDocument();

  expect(within(rows[3]).getByText("Software Engineer")).toBeInTheDocument();
  expect(within(rows[3]).getByText("4.8 / 5")).toBeInTheDocument();
});

test("filters out null, missing, NaN, and out-of-range scores safely", async () => {
  vi.mocked(getSessions).mockResolvedValue({
    success: true,
    data: [
      {
        id: "s-valid-1",
        userId: "u1",
        role: "software-engineer",
        status: "ENDED",
        startedAt: "2026-10-01T10:00:00Z",
        endedAt: "2026-10-01T10:30:00Z",
        feedbackStatus: "ready",
        overallScore: 3.0,
      },
      {
        id: "s-invalid-low",
        userId: "u1",
        role: "software-engineer",
        status: "ENDED",
        startedAt: "2026-10-02T10:00:00Z",
        endedAt: "2026-10-02T10:30:00Z",
        feedbackStatus: "ready",
        overallScore: 0.5, // below 1
      },
      {
        id: "s-invalid-high",
        userId: "u1",
        role: "software-engineer",
        status: "ENDED",
        startedAt: "2026-10-03T10:00:00Z",
        endedAt: "2026-10-03T10:30:00Z",
        feedbackStatus: "ready",
        overallScore: 6.0, // above 5
      },
      {
        id: "s-invalid-nan",
        userId: "u1",
        role: "software-engineer",
        status: "ENDED",
        startedAt: "2026-10-04T10:00:00Z",
        endedAt: "2026-10-04T10:30:00Z",
        feedbackStatus: "ready",
        overallScore: NaN,
      },
      {
        id: "s-invalid-null",
        userId: "u1",
        role: "software-engineer",
        status: "ENDED",
        startedAt: "2026-10-05T10:00:00Z",
        endedAt: "2026-10-05T10:30:00Z",
        feedbackStatus: "failed",
        overallScore: null,
      },
      {
        id: "s-valid-2",
        userId: "u1",
        role: "backend-developer",
        status: "ENDED",
        startedAt: "2026-10-06T10:00:00Z",
        endedAt: "2026-10-06T10:30:00Z",
        feedbackStatus: "ready",
        overallScore: 4.2,
      },
    ],
  });

  render(
    <MemoryRouter>
      <HistoryPage />
    </MemoryRouter>
  );

  await screen.findByRole("img", { name: /Performance line graph/i });

  // Only the 2 valid scores are counted
  expect(screen.getByTestId("performance-count")).toHaveTextContent("2");
  expect(screen.getByTestId("performance-latest-score")).toHaveTextContent("4.2 / 5");

  // Accessible breakdown table contains only 2 rows (+ header)
  const rows = screen.getAllByRole("row");
  expect(rows).toHaveLength(3);
  expect(within(rows[1]).getByText("Software Engineer")).toBeInTheDocument();
  expect(within(rows[2]).getByText("Backend Developer")).toBeInTheDocument();
});

test("given only one scored interview, renders graph with single point correctly", async () => {
  vi.mocked(getSessions).mockResolvedValue({
    success: true,
    data: [
      {
        id: "s-single",
        userId: "u1",
        role: "data-analyst",
        status: "ENDED",
        startedAt: "2026-11-01T10:00:00Z",
        endedAt: "2026-11-01T10:30:00Z",
        feedbackStatus: "ready",
        overallScore: 4.5,
      },
    ],
  });

  render(
    <MemoryRouter>
      <HistoryPage />
    </MemoryRouter>
  );

  expect(await screen.findByRole("img", { name: /Performance line graph/i })).toBeInTheDocument();
  expect(screen.getByTestId("performance-count")).toHaveTextContent("1");
  expect(screen.getByTestId("performance-latest-score")).toHaveTextContent("4.5 / 5");

  const dot = screen.getByTestId("performance-dot-s-single");
  expect(dot).toBeInTheDocument();
  expect(dot).toHaveAttribute("role", "button");
});

test("handles duplicate dates gracefully without crashing or grouping into one point", async () => {
  vi.mocked(getSessions).mockResolvedValue({
    success: true,
    data: [
      {
        id: "s-dup-1",
        userId: "u1",
        role: "software-engineer",
        status: "ENDED",
        startedAt: "2026-11-01T10:00:00Z",
        endedAt: "2026-11-01T10:20:00Z",
        feedbackStatus: "ready",
        overallScore: 3.5,
      },
      {
        id: "s-dup-2",
        userId: "u1",
        role: "backend-developer",
        status: "ENDED",
        startedAt: "2026-11-01T14:00:00Z",
        endedAt: "2026-11-01T14:20:00Z",
        feedbackStatus: "ready",
        overallScore: 4.5,
      },
    ],
  });

  render(
    <MemoryRouter>
      <HistoryPage />
    </MemoryRouter>
  );

  expect(await screen.findByRole("img", { name: /Performance line graph/i })).toBeInTheDocument();
  expect(screen.getByTestId("performance-count")).toHaveTextContent("2");

  // Both dots exist
  expect(screen.getByTestId("performance-dot-s-dup-1")).toBeInTheDocument();
  expect(screen.getByTestId("performance-dot-s-dup-2")).toBeInTheDocument();
});

test("clicking a plotted point navigates to /interview/{sessionId}/feedback", async () => {
  vi.mocked(getSessions).mockResolvedValue({
    success: true,
    data: [
      {
        id: "sess-abc",
        userId: "u1",
        role: "software-engineer",
        status: "ENDED",
        startedAt: "2026-11-01T10:00:00Z",
        endedAt: "2026-11-01T10:30:00Z",
        feedbackStatus: "ready",
        overallScore: 4.0,
      },
    ],
  });

  render(
    <MemoryRouter>
      <HistoryPage />
    </MemoryRouter>
  );

  const dot = await screen.findByTestId("performance-dot-sess-abc");
  fireEvent.click(dot);
  expect(mockNavigate).toHaveBeenCalledWith("/interview/sess-abc/feedback");
});

test("keyboard interactions on plotted points and accessible links navigate to feedback", async () => {
  vi.mocked(getSessions).mockResolvedValue({
    success: true,
    data: [
      {
        id: "sess-key",
        userId: "u1",
        role: "software-engineer",
        status: "ENDED",
        startedAt: "2026-11-01T10:00:00Z",
        endedAt: "2026-11-01T10:30:00Z",
        feedbackStatus: "ready",
        overallScore: 4.2,
      },
    ],
  });

  render(
    <MemoryRouter>
      <HistoryPage />
    </MemoryRouter>
  );

  const dot = await screen.findByTestId("performance-dot-sess-key");

  // Pressing Enter on the dot button
  fireEvent.keyDown(dot, { key: "Enter" });
  expect(mockNavigate).toHaveBeenCalledWith("/interview/sess-key/feedback");

  // Pressing Space on the dot button
  mockNavigate.mockReset();
  fireEvent.keyDown(dot, { key: " " });
  expect(mockNavigate).toHaveBeenCalledWith("/interview/sess-key/feedback");

  // Accessible breakdown table contains an operable link
  const accessibleLink = screen.getByRole("link", {
    name: /View feedback for Software Engineer/i,
  });
  expect(accessibleLink).toHaveAttribute("href", "/interview/sess-key/feedback");
});
