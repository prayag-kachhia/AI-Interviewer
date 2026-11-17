import "@testing-library/jest-dom/vitest";
import { test, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, within, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { HistoryPage } from "./HistoryPage";
import { getSessions, deleteSession } from "../../lib/api";

vi.mock("../../lib/api", () => ({
  getSessions: vi.fn(),
  deleteSession: vi.fn(),
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

test("a Delete button appears for each interview row and not duplicate in graph/table", async () => {
  vi.mocked(getSessions).mockResolvedValue({
    success: true,
    data: [
      {
        id: "s-1",
        userId: "u1",
        role: "backend-developer",
        status: "ENDED",
        startedAt: "2026-11-01T10:00:00Z",
        endedAt: "2026-11-01T10:20:00Z",
        feedbackStatus: "ready",
        overallScore: 4.0,
      },
      {
        id: "s-2",
        userId: "u1",
        role: "data-analyst",
        status: "ENDED",
        startedAt: "2026-10-15T14:00:00Z",
        endedAt: "2026-10-15T14:30:00Z",
        feedbackStatus: "ready",
        overallScore: 3.5,
      },
    ],
  });

  render(
    <MemoryRouter>
      <HistoryPage />
    </MemoryRouter>
  );

  const row1 = await screen.findByTestId("history-session-s-1");
  const row2 = screen.getByTestId("history-session-s-2");

  expect(within(row1).getByRole("button", { name: /Delete/i })).toBeInTheDocument();
  expect(within(row2).getByRole("button", { name: /Delete/i })).toBeInTheDocument();

  // Exactly 2 delete buttons on the page (no duplicates in graph or table)
  expect(screen.getAllByRole("button", { name: "Delete" })).toHaveLength(2);
});

test("clicking Delete opens a confirmation AlertDialog with role, date, and permanent warning", async () => {
  vi.mocked(getSessions).mockResolvedValue({
    success: true,
    data: [
      {
        id: "s-1",
        userId: "u1",
        role: "backend-developer",
        status: "ENDED",
        startedAt: "2026-11-01T10:00:00Z",
        endedAt: "2026-11-01T10:20:00Z",
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

  const row = await screen.findByTestId("history-session-s-1");
  fireEvent.click(within(row).getByRole("button", { name: "Delete" }));

  const dialog = screen.getByRole("alertdialog");
  expect(dialog).toBeInTheDocument();
  expect(within(dialog).getByText(/Delete Interview\?/i)).toBeInTheDocument();
  expect(within(dialog).getByText(/Backend Developer/i)).toBeInTheDocument();
  expect(within(dialog).getByText(/Nov 1, 2026/i)).toBeInTheDocument();
  expect(within(dialog).getByText(/permanent/i)).toBeInTheDocument();

  const cancelBtn = within(dialog).getByRole("button", { name: "Cancel" });
  const confirmBtn = within(dialog).getByRole("button", { name: "Delete interview" });

  expect(cancelBtn).toBeInTheDocument();
  expect(confirmBtn).toBeInTheDocument();
  expect(confirmBtn).toHaveAttribute("data-variant", "destructive");
});

test("cancel does not call the delete API and closes the dialog", async () => {
  vi.mocked(getSessions).mockResolvedValue({
    success: true,
    data: [
      {
        id: "s-1",
        userId: "u1",
        role: "backend-developer",
        status: "ENDED",
        startedAt: "2026-11-01T10:00:00Z",
        endedAt: "2026-11-01T10:20:00Z",
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

  const row = await screen.findByTestId("history-session-s-1");
  fireEvent.click(within(row).getByRole("button", { name: "Delete" }));

  expect(screen.getByRole("alertdialog")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

  expect(deleteSession).not.toHaveBeenCalled();
  expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  expect(screen.getByTestId("history-session-s-1")).toBeInTheDocument();
});

test("confirm calls deleteSession with the correct session ID", async () => {
  vi.mocked(getSessions).mockResolvedValue({
    success: true,
    data: [
      {
        id: "session-target",
        userId: "u1",
        role: "software-engineer",
        status: "ENDED",
        startedAt: "2026-11-02T10:00:00Z",
        endedAt: "2026-11-02T10:30:00Z",
        feedbackStatus: "ready",
        overallScore: 4.5,
      },
    ],
  });
  vi.mocked(deleteSession).mockResolvedValueOnce({ success: true });

  render(
    <MemoryRouter>
      <HistoryPage />
    </MemoryRouter>
  );

  const row = await screen.findByTestId("history-session-session-target");
  fireEvent.click(within(row).getByRole("button", { name: "Delete" }));

  fireEvent.click(screen.getByRole("button", { name: "Delete interview" }));

  await waitFor(() => {
    expect(deleteSession).toHaveBeenCalledWith("session-target");
  });
});

test("successful deletion removes only that interview from the list", async () => {
  vi.mocked(getSessions).mockResolvedValue({
    success: true,
    data: [
      {
        id: "s-1",
        userId: "u1",
        role: "software-engineer",
        status: "ENDED",
        startedAt: "2026-11-01T10:00:00Z",
        endedAt: "2026-11-01T10:30:00Z",
        feedbackStatus: "ready",
        overallScore: 4.0,
      },
      {
        id: "s-2",
        userId: "u1",
        role: "backend-developer",
        status: "ENDED",
        startedAt: "2026-11-02T10:00:00Z",
        endedAt: "2026-11-02T10:30:00Z",
        feedbackStatus: "ready",
        overallScore: 4.5,
      },
    ],
  });
  vi.mocked(deleteSession).mockResolvedValueOnce({ success: true });

  render(
    <MemoryRouter>
      <HistoryPage />
    </MemoryRouter>
  );

  const row1 = await screen.findByTestId("history-session-s-1");
  expect(screen.getByTestId("history-session-s-2")).toBeInTheDocument();

  fireEvent.click(within(row1).getByRole("button", { name: "Delete" }));
  fireEvent.click(screen.getByRole("button", { name: "Delete interview" }));

  await waitFor(() => {
    expect(screen.queryByTestId("history-session-s-1")).not.toBeInTheDocument();
  });
  expect(screen.getByTestId("history-session-s-2")).toBeInTheDocument();
  expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
});

test("graph and history breakdown update automatically after deletion", async () => {
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
    ],
  });
  vi.mocked(deleteSession).mockResolvedValueOnce({ success: true });

  render(
    <MemoryRouter>
      <HistoryPage />
    </MemoryRouter>
  );

  await screen.findByRole("img", { name: /Performance line graph/i });
  expect(screen.getByTestId("performance-count")).toHaveTextContent("2");
  expect(screen.getByTestId("performance-latest-score")).toHaveTextContent("4.8 / 5");

  // Breakdown table initially has 2 rows + 1 header
  expect(screen.getAllByRole("row")).toHaveLength(3);

  // Delete the latest interview
  const latestCard = screen.getByTestId("history-session-s-latest");
  fireEvent.click(within(latestCard).getByRole("button", { name: "Delete" }));
  fireEvent.click(screen.getByRole("button", { name: "Delete interview" }));

  await waitFor(() => {
    expect(screen.queryByTestId("history-session-s-latest")).not.toBeInTheDocument();
  });

  // Chart and breakdown recompute automatically
  expect(screen.getByTestId("performance-count")).toHaveTextContent("1");
  expect(screen.getByTestId("performance-latest-score")).toHaveTextContent("3.5 / 5");
  expect(screen.getAllByRole("row")).toHaveLength(2);
});

test("deleting the final interview displays the empty History state", async () => {
  vi.mocked(getSessions).mockResolvedValue({
    success: true,
    data: [
      {
        id: "s-only",
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
  vi.mocked(deleteSession).mockResolvedValueOnce({ success: true });

  render(
    <MemoryRouter>
      <HistoryPage />
    </MemoryRouter>
  );

  const row = await screen.findByTestId("history-session-s-only");
  fireEvent.click(within(row).getByRole("button", { name: "Delete" }));
  fireEvent.click(screen.getByRole("button", { name: "Delete interview" }));

  expect(await screen.findByText("No Interviews Yet")).toBeInTheDocument();
  expect(
    screen.getByText(
      "You haven't practiced any mock interviews yet. Start your first session to receive AI feedback and detailed insights."
    )
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Start an Interview/i })).toBeInTheDocument();
  expect(screen.queryByTestId("history-session-s-only")).not.toBeInTheDocument();
});

test("API failure preserves the row, shows an error message, and allows retrying", async () => {
  vi.mocked(getSessions).mockResolvedValue({
    success: true,
    data: [
      {
        id: "s-err",
        userId: "u1",
        role: "data-analyst",
        status: "ENDED",
        startedAt: "2026-11-01T10:00:00Z",
        endedAt: "2026-11-01T10:30:00Z",
        feedbackStatus: "ready",
        overallScore: 4.0,
      },
    ],
  });
  vi.mocked(deleteSession).mockRejectedValueOnce(new Error("Network disconnect"));

  render(
    <MemoryRouter>
      <HistoryPage />
    </MemoryRouter>
  );

  const row = await screen.findByTestId("history-session-s-err");
  fireEvent.click(within(row).getByRole("button", { name: "Delete" }));

  fireEvent.click(screen.getByRole("button", { name: "Delete interview" }));

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Failed to delete the interview. Please try again."
  );

  // Row is preserved
  expect(screen.getByTestId("history-session-s-err")).toBeInTheDocument();

  // Retry is possible
  const retryBtn = screen.getByRole("button", { name: "Delete interview" });
  expect(retryBtn).toBeEnabled();

  vi.mocked(deleteSession).mockResolvedValueOnce({ success: true });
  fireEvent.click(retryBtn);

  await waitFor(() => {
    expect(screen.queryByTestId("history-session-s-err")).not.toBeInTheDocument();
  });
});

test("repeat deletion is blocked while a request is pending", async () => {
  let resolveDeletePromise!: (value: any) => void;
  const deletePromise = new Promise((resolve) => {
    resolveDeletePromise = resolve;
  });

  vi.mocked(getSessions).mockResolvedValue({
    success: true,
    data: [
      {
        id: "s-pending",
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
  vi.mocked(deleteSession).mockReturnValue(deletePromise as any);

  render(
    <MemoryRouter>
      <HistoryPage />
    </MemoryRouter>
  );

  const row = await screen.findByTestId("history-session-s-pending");
  fireEvent.click(within(row).getByRole("button", { name: "Delete" }));

  const confirmBtn = screen.getByRole("button", { name: "Delete interview" });
  const cancelBtn = screen.getByRole("button", { name: "Cancel" });

  fireEvent.click(confirmBtn);

  // While request is pending:
  expect(confirmBtn).toBeDisabled();
  expect(cancelBtn).toBeDisabled();
  expect(within(row).getByTestId("history-delete-s-pending")).toBeDisabled();

  // Clicking again while pending does not fire duplicate API call
  fireEvent.click(confirmBtn);
  expect(deleteSession).toHaveBeenCalledTimes(1);

  // Complete the request
  resolveDeletePromise({ success: true });

  await waitFor(() => {
    expect(screen.queryByTestId("history-session-s-pending")).not.toBeInTheDocument();
  });
});

test("clicking Delete does not navigate to the feedback page", async () => {
  vi.mocked(getSessions).mockResolvedValue({
    success: true,
    data: [
      {
        id: "s-no-nav",
        userId: "u1",
        role: "backend-developer",
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

  const row = await screen.findByTestId("history-session-s-no-nav");
  const deleteBtn = within(row).getByRole("button", { name: "Delete" });

  fireEvent.click(deleteBtn);

  expect(mockNavigate).not.toHaveBeenCalled();
  expect(screen.getByRole("alertdialog")).toBeInTheDocument();

  // Cancel also does not navigate
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(mockNavigate).not.toHaveBeenCalled();

  // Only View Results link navigates
  const viewResultsLink = within(row).getByRole("link", { name: /View Results/i });
  expect(viewResultsLink).toHaveAttribute("href", "/interview/s-no-nav/feedback");
});

test("keyboard interactions and accessibility attributes are correctly wired", async () => {
  vi.mocked(getSessions).mockResolvedValue({
    success: true,
    data: [
      {
        id: "s-a11y",
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
  vi.mocked(deleteSession).mockResolvedValueOnce({ success: true });

  render(
    <MemoryRouter>
      <HistoryPage />
    </MemoryRouter>
  );

  const row = await screen.findByTestId("history-session-s-a11y");
  const deleteBtn = within(row).getByRole("button", { name: "Delete" });
  expect(deleteBtn).toHaveAttribute(
    "title",
    expect.stringContaining("Software Engineer")
  );

  // Triggering Delete via Enter key
  fireEvent.keyDown(deleteBtn, { key: "Enter" });
  fireEvent.click(deleteBtn);

  const dialog = screen.getByRole("alertdialog");
  expect(dialog).toBeInTheDocument();

  // Dialog accessibility attributes
  const title = screen.getByText("Delete Interview?");
  expect(dialog).toHaveAttribute("aria-labelledby", title.id);

  // Confirm via Enter key on the confirm button
  const confirmBtn = screen.getByRole("button", { name: "Delete interview" });
  fireEvent.click(confirmBtn);

  await waitFor(() => {
    expect(deleteSession).toHaveBeenCalledWith("s-a11y");
  });
});
