// ResultsScreen.test.tsx
import "@testing-library/jest-dom/vitest";
import { test, expect, vi, afterEach } from "vitest";
import { act, render, screen, fireEvent } from "@testing-library/react";
import { ResultsScreen } from "./ResultsScreen";
import * as api from "./feedbackApi";
import { getTurns, getSession } from "../../lib/api";

// The real API client creates a Supabase client on import; these tests replace fetchFeedback and getTurns anyway.
vi.mock("../../lib/api", () => ({
  getFeedback: vi.fn(),
  getTurns: vi.fn().mockResolvedValue({ success: true, data: [] }),
  getSession: vi.fn().mockResolvedValue({ success: true, data: null }),
  retryFeedback: vi.fn().mockResolvedValue({ sessionId: "s1", status: "pending" }),
}));

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

test("given feedback is pending, then it shows preparing and keeps polling", async () => {
  vi.spyOn(api, "fetchFeedback").mockResolvedValue({
    sessionId: "s1",
    status: "pending",
  });

  render(<ResultsScreen sessionId="s1" />);
  expect(await screen.findByRole("status")).toBeInTheDocument();
});

test("given feedback is ready, then it is displayed", async () => {
  vi.spyOn(api, "fetchFeedback").mockResolvedValue({
    sessionId: "s1",
    status: "ready",
    summary: "Great job.",
    scores: [{ category: "Communication", score: 5, comment: "Excellent." }],
  });

  render(<ResultsScreen sessionId="s1" />);
  expect(await screen.findByText("Great job.")).toBeInTheDocument();
});

test("given feedback failed, then the screen says so", async () => {
  vi.spyOn(api, "fetchFeedback").mockResolvedValue({
    sessionId: "s1",
    status: "failed",
  });

  render(<ResultsScreen sessionId="s1" />);
  expect(await screen.findByRole("alert")).toBeInTheDocument();
});

test("given feedback is pending, then it polls again and shows it once ready, then stops", async () => {
  vi.useFakeTimers();
  const fetchSpy = vi
    .spyOn(api, "fetchFeedback")
    .mockResolvedValueOnce({ sessionId: "s1", status: "pending" })
    .mockResolvedValue({ sessionId: "s1", status: "ready", summary: "Ready now.", scores: [] });

  render(<ResultsScreen sessionId="s1" />);
  await act(() => vi.advanceTimersByTimeAsync(0));
  expect(screen.getByRole("status")).toBeInTheDocument();

  await act(() => vi.advanceTimersByTimeAsync(3000));
  expect(screen.getByText("Ready now.")).toBeInTheDocument();
  expect(fetchSpy).toHaveBeenCalledTimes(2);

  await act(() => vi.advanceTimersByTimeAsync(9000));
  expect(fetchSpy).toHaveBeenCalledTimes(2);
});

test("given feedback is ready and turns exist, then transcript is rendered in correct order with correct speaker labels and elapsed time", async () => {
  vi.spyOn(api, "fetchFeedback").mockResolvedValue({
    sessionId: "s1",
    status: "ready",
    summary: "Solid interview.",
    scores: [{ category: "Problem Solving", score: 4, comment: "Good job." }],
  });

  // Provide turns intentionally out of order to verify sorting by turnIndex
  const mockTurns = [
    {
      id: "turn-2",
      sessionId: "s1",
      speaker: "CANDIDATE" as const,
      text: "I implemented a cache with an LRU eviction policy.",
      timestampSec: 75,
      turnIndex: 1,
      createdAt: new Date().toISOString(),
    },
    {
      id: "turn-1",
      sessionId: "s1",
      speaker: "AI" as const,
      text: "Tell me about a caching strategy you used.",
      timestampSec: 5,
      turnIndex: 0,
      createdAt: new Date().toISOString(),
    },
    {
      id: "turn-3",
      sessionId: "s1",
      speaker: "AI" as const,
      text: "How did you handle cache invalidation?",
      timestampSec: 130,
      turnIndex: 2,
      createdAt: new Date().toISOString(),
    },
  ];

  vi.mocked(getTurns).mockResolvedValue({
    success: true,
    data: mockTurns,
  });

  render(<ResultsScreen sessionId="s1" />);

  // Wait for ready state
  expect(await screen.findByText("Solid interview.")).toBeInTheDocument();

  // Collapsible transcript heading
  expect(screen.getByText("Transcript")).toBeInTheDocument();

  // Verify texts are rendered
  const turn1Text = await screen.findByText("Tell me about a caching strategy you used.");
  const turn2Text = screen.getByText("I implemented a cache with an LRU eviction policy.");
  const turn3Text = screen.getByText("How did you handle cache invalidation?");

  expect(turn1Text).toBeInTheDocument();
  expect(turn2Text).toBeInTheDocument();
  expect(turn3Text).toBeInTheDocument();

  // Verify speaker labels
  const aiSpeakers = screen.getAllByText("AI Interviewer");
  expect(aiSpeakers).toHaveLength(2);
  expect(screen.getByText("Candidate")).toBeInTheDocument();

  // Verify elapsed time formatted as mm:ss (5s -> 00:05, 75s -> 01:15, 130s -> 02:10)
  expect(screen.getByText("00:05")).toBeInTheDocument();
  expect(screen.getByText("01:15")).toBeInTheDocument();
  expect(screen.getByText("02:10")).toBeInTheDocument();

  // Verify ordering: turn 0 must appear in the DOM before turn 1, which appears before turn 2
  const DOCUMENT_POSITION_FOLLOWING = 4;
  expect(turn1Text.compareDocumentPosition(turn2Text) & DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(turn2Text.compareDocumentPosition(turn3Text) & DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test("given feedback is ready and no turns exist, then empty transcript state is displayed", async () => {
  vi.spyOn(api, "fetchFeedback").mockResolvedValue({
    sessionId: "s1",
    status: "ready",
    summary: "No turns interview.",
    scores: [],
  });

  vi.mocked(getTurns).mockResolvedValue({
    success: true,
    data: [],
  });

  render(<ResultsScreen sessionId="s1" />);

  expect(await screen.findByText("No turns interview.")).toBeInTheDocument();
  expect(screen.getByText("Transcript")).toBeInTheDocument();
  expect(screen.getByText("No transcript turns recorded.")).toBeInTheDocument();
});

test("collapsible transcript section is open by default", async () => {
  vi.spyOn(api, "fetchFeedback").mockResolvedValue({
    sessionId: "s1",
    status: "ready",
    summary: "Overview.",
    scores: [],
  });

  vi.mocked(getTurns).mockResolvedValue({
    success: true,
    data: [],
  });

  render(<ResultsScreen sessionId="s1" />);

  const summary = await screen.findByText("Transcript");
  const details = summary.closest("details");
  expect(details).toHaveAttribute("open");
});

test("displays feedback scores", async () => {
  vi.spyOn(api, "fetchFeedback").mockResolvedValue({
    sessionId: "s1",
    status: "ready",
    summary: "Detailed interview assessment.",
    scores: [
      {
        category: "System Design",
        score: 4,
        comment: "Solid architecture explanation.",
      },
    ],
  });

  render(<ResultsScreen sessionId="s1" />);

  expect(await screen.findByText("Detailed interview assessment.")).toBeInTheDocument();
  expect(screen.getByText(/System Design:/)).toBeInTheDocument();
  expect(screen.getByText(/4\/5/)).toBeInTheDocument();
  expect(screen.getByText(/Solid architecture explanation/)).toBeInTheDocument();
});

test("displays 'Ended early' badge when session ended before limit", async () => {
  vi.spyOn(api, "fetchFeedback").mockResolvedValue({
    sessionId: "s1",
    status: "ready",
    summary: "Short session.",
    scores: [],
  });

  vi.mocked(getSession).mockResolvedValue({
    success: true,
    data: {
      id: "s1",
      userId: "u1",
      role: "Software Engineer",
      status: "ENDED",
      startedAt: "2026-11-01T10:00:00Z",
      endedAt: "2026-11-01T10:05:00Z", // 5 min < 15 min
      createdAt: "2026-11-01T10:00:00Z",
      endedEarly: true,
    },
  });

  render(<ResultsScreen sessionId="s1" />);

  expect(await screen.findByTestId("ended-early-badge")).toBeInTheDocument();
  expect(screen.getByText("Ended early")).toBeInTheDocument();
});

test("does not display 'Ended early' badge when session ran full time", async () => {
  vi.spyOn(api, "fetchFeedback").mockResolvedValue({
    sessionId: "s1",
    status: "ready",
    summary: "Full session.",
    scores: [],
  });

  vi.mocked(getSession).mockResolvedValue({
    success: true,
    data: {
      id: "s1",
      userId: "u1",
      role: "Software Engineer",
      status: "ENDED",
      startedAt: "2026-11-01T10:00:00Z",
      endedAt: "2026-11-01T10:20:00Z",
      createdAt: "2026-11-01T10:00:00Z",
      endedEarly: false,
    },
  });

  render(<ResultsScreen sessionId="s1" />);

  await screen.findByText("Full session.");
  expect(screen.queryByTestId("ended-early-badge")).not.toBeInTheDocument();
});

test("given feedback failed, then 'Try again' button is shown and transcript is preserved", async () => {
  vi.spyOn(api, "fetchFeedback").mockResolvedValue({
    sessionId: "s1",
    status: "failed",
  });

  vi.mocked(getTurns).mockResolvedValue({
    success: true,
    data: [
      {
        id: "turn-1",
        sessionId: "s1",
        speaker: "CANDIDATE",
        text: "I built the frontend with React.",
        timestampSec: 10,
        turnIndex: 0,
        createdAt: new Date().toISOString(),
      },
    ],
  });

  render(<ResultsScreen sessionId="s1" />);

  expect(await screen.findByRole("alert")).toBeInTheDocument();
  expect(screen.getByText("We couldn't generate feedback for this session.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Try again/i })).toBeInTheDocument();

  // Transcript is preserved even on failed feedback
  expect(screen.getByText("Transcript")).toBeInTheDocument();
  expect(screen.getByText("I built the frontend with React.")).toBeInTheDocument();
});

test("clicking 'Try again' calls retry endpoint, transitions to preparing state, and resumes polling", async () => {
  vi.useFakeTimers();
  const retrySpy = vi.spyOn(api, "retryFeedback").mockResolvedValue({
    sessionId: "s1",
    status: "pending",
  });

  vi.spyOn(api, "fetchFeedback")
    .mockResolvedValueOnce({ sessionId: "s1", status: "failed" })
    .mockResolvedValueOnce({ sessionId: "s1", status: "pending" })
    .mockResolvedValue({
      sessionId: "s1",
      status: "ready",
      summary: "Evaluated successfully after retry.",
      scores: [],
    });

  render(<ResultsScreen sessionId="s1" />);
  await act(() => vi.advanceTimersByTimeAsync(0));

  const tryAgainButton = screen.getByRole("button", { name: /Try again/i });
  expect(tryAgainButton).toBeInTheDocument();

  await act(async () => {
    fireEvent.click(tryAgainButton);
  });

  expect(retrySpy).toHaveBeenCalledWith("s1");
  expect(screen.getByRole("status")).toBeInTheDocument();

  // Advance timer for next polling iteration
  await act(() => vi.advanceTimersByTimeAsync(3000));

  expect(screen.getByText("Evaluated successfully after retry.")).toBeInTheDocument();
});

test("handles retry API failure gracefully", async () => {
  vi.spyOn(api, "fetchFeedback").mockResolvedValue({
    sessionId: "s1",
    status: "failed",
  });

  vi.spyOn(api, "retryFeedback").mockRejectedValue(new Error("Network timeout during retry"));

  render(<ResultsScreen sessionId="s1" />);

  const tryAgainBtn = await screen.findByRole("button", { name: /Try again/i });
  fireEvent.click(tryAgainBtn);

  expect(await screen.findByText("Network timeout during retry")).toBeInTheDocument();
  // Button re-enabled
  expect(screen.getByRole("button", { name: /Try again/i })).not.toBeDisabled();
});

test("feedback fetch error displays error state alert", async () => {
  vi.spyOn(api, "fetchFeedback").mockRejectedValue(new Error("Unable to fetch feedback from server"));

  render(<ResultsScreen sessionId="s1" />);

  expect(await screen.findByRole("alert")).toBeInTheDocument();
  expect(screen.getByText("Unable to fetch feedback from server")).toBeInTheDocument();
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});

test("a later successful fetch clears the error state", async () => {
  vi.useFakeTimers();
  vi.spyOn(api, "fetchFeedback")
    .mockRejectedValueOnce(new Error("Temporary network glitch"))
    .mockResolvedValue({
      sessionId: "s1",
      status: "ready",
      summary: "Ready after reconnect.",
      scores: [],
    });

  render(<ResultsScreen sessionId="s1" />);
  await act(() => vi.advanceTimersByTimeAsync(0));

  expect(screen.getByRole("alert")).toBeInTheDocument();
  expect(screen.getByText("Temporary network glitch")).toBeInTheDocument();

  // Advance timer by 3000ms for next poll
  await act(() => vi.advanceTimersByTimeAsync(3000));

  expect(screen.getByText("Ready after reconnect.")).toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

test("60-second waiting message appears only after threshold and disappears when ready", async () => {
  vi.useFakeTimers();
  const fetchSpy = vi.spyOn(api, "fetchFeedback").mockResolvedValue({
    sessionId: "s1",
    status: "pending",
  });

  render(<ResultsScreen sessionId="s1" />);
  await act(() => vi.advanceTimersByTimeAsync(0));

  expect(screen.getByRole("status")).toBeInTheDocument();
  expect(screen.queryByText("Taking longer than usual")).not.toBeInTheDocument();

  // Advance by 30 seconds (before 60s threshold)
  await act(() => vi.advanceTimersByTimeAsync(30000));
  expect(screen.queryByText("Taking longer than usual")).not.toBeInTheDocument();

  // Advance by another 30 seconds (reaching 60s threshold)
  await act(() => vi.advanceTimersByTimeAsync(30000));
  expect(screen.getByText("Taking longer than usual")).toBeInTheDocument();

  // Now resolve feedback to ready on next poll
  fetchSpy.mockResolvedValueOnce({
    sessionId: "s1",
    status: "ready",
    summary: "Finally ready.",
    scores: [],
  });

  await act(() => vi.advanceTimersByTimeAsync(3000));

  expect(screen.getByText("Finally ready.")).toBeInTheDocument();
  expect(screen.queryByText("Taking longer than usual")).not.toBeInTheDocument();
});

test("60-second waiting message disappears when feedback becomes failed", async () => {
  vi.useFakeTimers();
  const fetchSpy = vi.spyOn(api, "fetchFeedback").mockResolvedValue({
    sessionId: "s1",
    status: "pending",
  });

  render(<ResultsScreen sessionId="s1" />);
  await act(() => vi.advanceTimersByTimeAsync(60000));

  expect(screen.getByText("Taking longer than usual")).toBeInTheDocument();

  // Resolves to failed on next poll
  fetchSpy.mockResolvedValueOnce({
    sessionId: "s1",
    status: "failed",
  });

  await act(() => vi.advanceTimersByTimeAsync(3000));

  expect(screen.getByText("We couldn't generate feedback for this session.")).toBeInTheDocument();
  expect(screen.queryByText("Taking longer than usual")).not.toBeInTheDocument();
});

test("retry resets the 60-second waiting timer, clears error, and resumes polling", async () => {
  vi.useFakeTimers();
  vi.spyOn(api, "retryFeedback").mockResolvedValue({
    sessionId: "s1",
    status: "pending",
  });

  const fetchSpy = vi.spyOn(api, "fetchFeedback")
    .mockResolvedValueOnce({ sessionId: "s1", status: "pending" })
    .mockResolvedValue({ sessionId: "s1", status: "failed" });

  render(<ResultsScreen sessionId="s1" />);
  await act(() => vi.advanceTimersByTimeAsync(3000));

  expect(screen.getByRole("alert")).toBeInTheDocument();
  const tryAgainButton = screen.getByRole("button", { name: /Try again/i });

  // Now when clicking retry, it resets to pending
  fetchSpy.mockResolvedValue({ sessionId: "s1", status: "pending" });

  await act(async () => {
    fireEvent.click(tryAgainButton);
  });

  expect(screen.getByRole("status")).toBeInTheDocument();
  expect(screen.queryByText("Taking longer than usual")).not.toBeInTheDocument();

  // Advance by 30 seconds: still pending, but under 60s from retry reset
  await act(() => vi.advanceTimersByTimeAsync(30000));
  expect(screen.queryByText("Taking longer than usual")).not.toBeInTheDocument();

  // Advance another 30 seconds (total 60s after retry): now message appears
  await act(() => vi.advanceTimersByTimeAsync(30000));
  expect(screen.getByText("Taking longer than usual")).toBeInTheDocument();
});

test("retry on fetch error resets error state and resumes polling", async () => {
  vi.useFakeTimers();
  const retrySpy = vi.spyOn(api, "retryFeedback").mockResolvedValue({
    sessionId: "s1",
    status: "pending",
  });

  vi.spyOn(api, "fetchFeedback")
    .mockRejectedValueOnce(new Error("Initial fetch failure"))
    .mockResolvedValueOnce({ sessionId: "s1", status: "pending" })
    .mockResolvedValue({
      sessionId: "s1",
      status: "ready",
      summary: "Success after retry button.",
      scores: [],
    });

  render(<ResultsScreen sessionId="s1" />);
  await act(() => vi.advanceTimersByTimeAsync(0));

  expect(screen.getByText("Initial fetch failure")).toBeInTheDocument();
  const tryAgainBtn = screen.getByRole("button", { name: /Try again/i });

  await act(async () => {
    fireEvent.click(tryAgainBtn);
  });

  expect(retrySpy).toHaveBeenCalledWith("s1");
  // Retry resets error state to pending status
  expect(screen.getByRole("status")).toBeInTheDocument();
  expect(screen.queryByText("Initial fetch failure")).not.toBeInTheDocument();

  // Advance timer for next polling iteration
  await act(() => vi.advanceTimersByTimeAsync(3000));
  expect(screen.getByText("Success after retry button.")).toBeInTheDocument();
});
