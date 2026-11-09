// ResultsScreen.test.tsx
import "@testing-library/jest-dom/vitest";
import { test, expect, vi, afterEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { ResultsScreen } from "./ResultsScreen";
import * as api from "./feedbackApi";
import { getTurns } from "../../lib/api";

// The real API client creates a Supabase client on import; these tests replace fetchFeedback and getTurns anyway.
vi.mock("../../lib/api", () => ({
  getFeedback: vi.fn(),
  getTurns: vi.fn().mockResolvedValue({ success: true, data: [] }),
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
    scores: [
      {
        category: "Communication",
        score: 5,
        comment: "Excellent.",
        strengths: ["Clear communication"],
        improvements: ["Keep it up"],
        quote: "I would decouple the notification requests",
      },
    ],
  });

  render(<ResultsScreen sessionId="s1" />);
  expect(await screen.findByText("Great job.")).toBeInTheDocument();
  expect(screen.getByText("Strengths: Clear communication")).toBeInTheDocument();
  expect(screen.getByText("To improve: Keep it up")).toBeInTheDocument();
  expect(screen.getByText("“I would decouple the notification requests”")).toBeInTheDocument();
});

test("given feedback failed, when I press Try again, then it goes back to preparing and then shows the result", async () => {
  vi.spyOn(api, "fetchFeedback")
    .mockResolvedValueOnce({ sessionId: "s1", status: "failed" })
    .mockResolvedValueOnce({ sessionId: "s1", status: "pending" })
    .mockResolvedValue({ sessionId: "s1", status: "ready", summary: "Ready after retry.", scores: [] });
  const retry = vi.spyOn(api, "retryFeedback").mockResolvedValue({ sessionId: "s1", status: "pending" });
  vi.useFakeTimers({ shouldAdvanceTime: true });

  render(<ResultsScreen sessionId="s1" />);
  fireEvent.click(await screen.findByRole("button", { name: "Try again" }));

  expect(await screen.findByText("Preparing your feedback… this can take a moment.")).toBeInTheDocument();
  expect(retry).toHaveBeenCalledWith("s1");
  await act(() => vi.advanceTimersByTimeAsync(3000));
  expect(await screen.findByText("Ready after retry.")).toBeInTheDocument();
});

test("given feedback failed, then the screen says so", async () => {
  vi.spyOn(api, "fetchFeedback").mockResolvedValue({
    sessionId: "s1",
    status: "failed",
  });

  render(<ResultsScreen sessionId="s1" />);
  expect(await screen.findByRole("alert")).toBeInTheDocument();
  expect(screen.getByText("We couldn't generate feedback for this session.")).toBeInTheDocument();
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
    scores: [{ category: "Problem Solving", score: 4, comment: "Good job.", strengths: [], improvements: [], quote: "" }],
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

test("transcript is visible while feedback is pending", async () => {
  vi.spyOn(api, "fetchFeedback").mockResolvedValue({
    sessionId: "s1",
    status: "pending",
  });
  vi.mocked(getTurns).mockResolvedValue({
    success: true,
    data: [
      {
        id: "turn-1",
        sessionId: "s1",
        speaker: "AI" as const,
        text: "Welcome to the interview.",
        timestampSec: 0,
        turnIndex: 0,
        createdAt: new Date().toISOString(),
      },
    ],
  });

  render(<ResultsScreen sessionId="s1" />);

  expect(await screen.findByRole("status")).toBeInTheDocument();
  expect(screen.getByText("Preparing your feedback… this can take a moment.")).toBeInTheDocument();
  expect(screen.getByText("Transcript")).toBeInTheDocument();
  expect(await screen.findByText("Welcome to the interview.")).toBeInTheDocument();
});

test("transcript is visible while feedback has failed", async () => {
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
        speaker: "AI" as const,
        text: "Tell me about your background.",
        timestampSec: 10,
        turnIndex: 0,
        createdAt: new Date().toISOString(),
      },
    ],
  });

  render(<ResultsScreen sessionId="s1" />);

  expect(await screen.findByRole("alert")).toBeInTheDocument();
  expect(screen.getByText("We couldn't generate feedback for this session.")).toBeInTheDocument();
  expect(screen.getByText("Transcript")).toBeInTheDocument();
  expect(await screen.findByText("Tell me about your background.")).toBeInTheDocument();
});

test("transcript is visible when feedback is ready", async () => {
  vi.spyOn(api, "fetchFeedback").mockResolvedValue({
    sessionId: "s1",
    status: "ready",
    summary: "Detailed review completed.",
    scores: [{ category: "System Design", score: 5, comment: "Clear explanation.", strengths: [], improvements: [], quote: "" }],
  });
  vi.mocked(getTurns).mockResolvedValue({
    success: true,
    data: [
      {
        id: "turn-1",
        sessionId: "s1",
        speaker: "CANDIDATE" as const,
        text: "I partitioned the database horizontally.",
        timestampSec: 42,
        turnIndex: 0,
        createdAt: new Date().toISOString(),
      },
    ],
  });

  render(<ResultsScreen sessionId="s1" />);

  expect(await screen.findByText("Detailed review completed.")).toBeInTheDocument();
  expect(screen.getByText("System Design:")).toBeInTheDocument();
  expect(screen.getByText("Transcript")).toBeInTheDocument();
  expect(await screen.findByText("I partitioned the database horizontally.")).toBeInTheDocument();
});

test("empty transcript message displayed only after a successful fetch returning zero turns", async () => {
  vi.spyOn(api, "fetchFeedback").mockResolvedValue({
    sessionId: "s1",
    status: "ready",
    summary: "Solid performance.",
    scores: [],
  });
  vi.mocked(getTurns).mockResolvedValue({
    success: true,
    data: [],
  });

  render(<ResultsScreen sessionId="s1" />);

  expect(await screen.findByText("Transcript")).toBeInTheDocument();
  expect(await screen.findByText("No transcript turns recorded.")).toBeInTheDocument();
  expect(screen.queryByText("Unable to load transcript. Please try again.")).not.toBeInTheDocument();
  expect(screen.queryByText("Loading transcript…")).not.toBeInTheDocument();
});

test("fetch failure displays an error instead of the empty-transcript message", async () => {
  vi.spyOn(api, "fetchFeedback").mockResolvedValue({
    sessionId: "s1",
    status: "ready",
    summary: "Solid performance.",
    scores: [],
  });
  vi.mocked(getTurns).mockRejectedValue(new Error("Network Error"));

  render(<ResultsScreen sessionId="s1" />);

  expect(await screen.findByText("Transcript")).toBeInTheDocument();
  expect(await screen.findByText("Unable to load transcript. Please try again.")).toBeInTheDocument();
  expect(screen.queryByText("No transcript turns recorded.")).not.toBeInTheDocument();
});

test("while transcript is loading, displays a loading message", async () => {
  vi.spyOn(api, "fetchFeedback").mockResolvedValue({
    sessionId: "s1",
    status: "ready",
    summary: "Solid performance.",
    scores: [],
  });

  let resolveTurns: (value: any) => void = () => {};
  const turnsPromise = new Promise((resolve) => {
    resolveTurns = resolve;
  });
  vi.mocked(getTurns).mockReturnValue(turnsPromise as any);

  render(<ResultsScreen sessionId="s1" />);

  expect(screen.getByText("Transcript")).toBeInTheDocument();
  expect(screen.getByText("Loading transcript…")).toBeInTheDocument();
  expect(screen.queryByText("No transcript turns recorded.")).not.toBeInTheDocument();

  await act(async () => {
    resolveTurns({ success: true, data: [] });
  });

  expect(await screen.findByText("No transcript turns recorded.")).toBeInTheDocument();
  expect(screen.queryByText("Loading transcript…")).not.toBeInTheDocument();
});
