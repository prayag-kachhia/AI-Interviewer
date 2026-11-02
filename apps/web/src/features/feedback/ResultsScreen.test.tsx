
// ResultsScreen.test.tsx
import "@testing-library/jest-dom/vitest";
import { test, expect, vi, afterEach, describe } from "vitest";
import { act, render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { ResultsScreen } from "./ResultsScreen";
import * as feedbackApi from "./feedbackApi";
import * as api from "../../lib/api";
import { getTurns } from "../../lib/api";

vi.mock("../../lib/api", () => ({
  getFeedback: vi.fn(),
  getTurns: vi.fn().mockResolvedValue({ success: true, data: [] }),
  deleteSession: vi.fn().mockResolvedValue({ success: true }),
}));
function renderResultsScreen(props: { sessionId: string; onDeleted?: () => void }) {
  return render(
    <MemoryRouter>
      <ResultsScreen {...props} />
    </MemoryRouter>
  );
}


afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

test("given feedback is pending, then it shows preparing and keeps polling", async () => {
  vi.spyOn(feedbackApi, "fetchFeedback").mockResolvedValue({
    sessionId: "s1",
    status: "pending",
  });

  renderResultsScreen({ sessionId: "s1" });
  expect(await screen.findByRole("status")).toBeInTheDocument();
});

test("given feedback is ready, then it is displayed", async () => {
  vi.spyOn(feedbackApi, "fetchFeedback").mockResolvedValue({
    sessionId: "s1",
    status: "ready",
    summary: "Great job.",
    scores: [{ category: "Communication", score: 5, comment: "Excellent." }],
  });

  renderResultsScreen({ sessionId: "s1" });
  expect(await screen.findByText("Great job.")).toBeInTheDocument();
});

test("given feedback failed, then the screen says so", async () => {
  vi.spyOn(feedbackApi, "fetchFeedback").mockResolvedValue({
    sessionId: "s1",
    status: "failed",
  });

  renderResultsScreen({ sessionId: "s1" });
  expect(await screen.findByRole("alert")).toBeInTheDocument();
  expect(screen.getByText("We couldn't generate feedback for this session.")).toBeInTheDocument();
});

test("given feedback is pending, then it polls again and shows it once ready, then stops", async () => {
  vi.useFakeTimers();
  const fetchSpy = vi
    .spyOn(feedbackApi, "fetchFeedback")
    .mockResolvedValueOnce({ sessionId: "s1", status: "pending" })
    .mockResolvedValue({ sessionId: "s1", status: "ready", summary: "Ready now.", scores: [] });

  renderResultsScreen({ sessionId: "s1" });
  await act(() => vi.advanceTimersByTimeAsync(0));
  expect(screen.getByRole("status")).toBeInTheDocument();

  await act(() => vi.advanceTimersByTimeAsync(3000));
  expect(screen.getByText("Ready now.")).toBeInTheDocument();
  expect(fetchSpy).toHaveBeenCalledTimes(2);

  await act(() => vi.advanceTimersByTimeAsync(9000));
  expect(fetchSpy).toHaveBeenCalledTimes(2);
});



test("given feedback is ready and turns exist, then transcript is rendered in correct order with correct speaker labels and elapsed time", async () => {
  vi.spyOn(feedbackApi, "fetchFeedback").mockResolvedValue({
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

  renderResultsScreen({ sessionId: "s1" });

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
  vi.spyOn(feedbackApi, "fetchFeedback").mockResolvedValue({
    sessionId: "s1",
    status: "ready",
    summary: "Overview.",
    scores: [],
  });

  vi.mocked(getTurns).mockResolvedValue({
    success: true,
    data: [],
  });

  renderResultsScreen({ sessionId: "s1" });

  const summary = await screen.findByText("Transcript");
  const details = summary.closest("details");
  expect(details).toHaveAttribute("open");
});

test("transcript is visible while feedback is pending", async () => {
  vi.spyOn(feedbackApi, "fetchFeedback").mockResolvedValue({
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

  renderResultsScreen({ sessionId: "s1" });

  expect(await screen.findByRole("status")).toBeInTheDocument();
  expect(screen.getByText("Preparing your feedback… this can take a moment.")).toBeInTheDocument();
  expect(screen.getByText("Transcript")).toBeInTheDocument();
  expect(await screen.findByText("Welcome to the interview.")).toBeInTheDocument();
});

test("transcript is visible while feedback has failed", async () => {
  vi.spyOn(feedbackApi, "fetchFeedback").mockResolvedValue({
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

  renderResultsScreen({ sessionId: "s1" });

  expect(await screen.findByRole("alert")).toBeInTheDocument();
  expect(screen.getByText("We couldn't generate feedback for this session.")).toBeInTheDocument();
  expect(screen.getByText("Transcript")).toBeInTheDocument();
  expect(await screen.findByText("Tell me about your background.")).toBeInTheDocument();
});

test("transcript is visible when feedback is ready", async () => {
  vi.spyOn(feedbackApi, "fetchFeedback").mockResolvedValue({
    sessionId: "s1",
    status: "ready",
    summary: "Detailed review completed.",
    scores: [{ category: "System Design", score: 5, comment: "Clear explanation." }],
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

  renderResultsScreen({ sessionId: "s1" });

  expect(await screen.findByText("Detailed review completed.")).toBeInTheDocument();
  expect(screen.getByText("System Design:")).toBeInTheDocument();
  expect(screen.getByText("Transcript")).toBeInTheDocument();
  expect(await screen.findByText("I partitioned the database horizontally.")).toBeInTheDocument();
});

test("empty transcript message displayed only after a successful fetch returning zero turns", async () => {
  vi.spyOn(feedbackApi, "fetchFeedback").mockResolvedValue({
    sessionId: "s1",
    status: "ready",
    summary: "Solid performance.",
    scores: [],
  });
  vi.mocked(getTurns).mockResolvedValue({
    success: true,
    data: [],
  });

  renderResultsScreen({ sessionId: "s1" });

  expect(await screen.findByText("Transcript")).toBeInTheDocument();
  expect(await screen.findByText("No transcript turns recorded.")).toBeInTheDocument();
  expect(screen.queryByText("Unable to load transcript. Please try again.")).not.toBeInTheDocument();
  expect(screen.queryByText("Loading transcript…")).not.toBeInTheDocument();
});

test("fetch failure displays an error instead of the empty-transcript message", async () => {
  vi.spyOn(feedbackApi, "fetchFeedback").mockResolvedValue({
    sessionId: "s1",
    status: "ready",
    summary: "Solid performance.",
    scores: [],
  });
  vi.mocked(getTurns).mockRejectedValue(new Error("Network Error"));

  renderResultsScreen({ sessionId: "s1" });

  expect(await screen.findByText("Transcript")).toBeInTheDocument();
  expect(await screen.findByText("Unable to load transcript. Please try again.")).toBeInTheDocument();
  expect(screen.queryByText("No transcript turns recorded.")).not.toBeInTheDocument();
});

test("while transcript is loading, displays a loading message", async () => {
  vi.spyOn(feedbackApi, "fetchFeedback").mockResolvedValue({
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

  renderResultsScreen({ sessionId: "s1" });

  expect(screen.getByText("Transcript")).toBeInTheDocument();
  expect(screen.getByText("Loading transcript…")).toBeInTheDocument();
  expect(screen.queryByText("No transcript turns recorded.")).not.toBeInTheDocument();

  await act(async () => {
    resolveTurns({ success: true, data: [] });
  });

  expect(await screen.findByText("No transcript turns recorded.")).toBeInTheDocument();
  expect(screen.queryByText("Loading transcript…")).not.toBeInTheDocument();
});

describe("FR-28 - ResultsScreen Delete Interview", () => {
  test("shows Delete Interview button when feedback is ready", async () => {
    vi.spyOn(feedbackApi, "fetchFeedback").mockResolvedValue({
      sessionId: "s1",
      status: "ready",
      summary: "Great job.",
      scores: [],
    });

    renderResultsScreen({ sessionId: "s1" });

    expect(
      await screen.findByRole("button", { name: /delete interview/i })
    ).toBeInTheDocument();
  });

  test("cancelling window.confirm does not call delete API", async () => {
    vi.spyOn(feedbackApi, "fetchFeedback").mockResolvedValue({
      sessionId: "s1",
      status: "ready",
      summary: "Great job.",
      scores: [],
    });

    const deleteSpy = vi.spyOn(api, "deleteSession");
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);

    renderResultsScreen({ sessionId: "s1" });

    const deleteBtn = await screen.findByRole("button", {
      name: /delete interview/i,
    });

    fireEvent.click(deleteBtn);

    expect(confirmSpy).toHaveBeenCalledWith(
      "Are you sure you want to delete this interview? This action cannot be undone."
    );
    expect(deleteSpy).not.toHaveBeenCalled();
  });

  test("confirming deletion calls delete API and triggers onDeleted callback", async () => {
    vi.spyOn(feedbackApi, "fetchFeedback").mockResolvedValue({
      sessionId: "s1",
      status: "ready",
      summary: "Great job.",
      scores: [],
    });

    const deleteSpy = vi.spyOn(api, "deleteSession");
    vi.spyOn(window, "confirm").mockReturnValue(true);

    const onDeletedMock = vi.fn();

    renderResultsScreen({
      sessionId: "s1",
      onDeleted: onDeletedMock,
    });

    const deleteBtn = await screen.findByRole("button", {
      name: /delete interview/i,
    });

    await act(async () => {
      fireEvent.click(deleteBtn);
    });

    expect(deleteSpy).toHaveBeenCalledWith("s1");
    expect(onDeletedMock).toHaveBeenCalledTimes(1);

    expect(
      screen.getByText("Interview session deleted successfully. Redirecting...")
    ).toBeInTheDocument();

    expect(screen.queryByText("Great job.")).not.toBeInTheDocument();
  });

  test("handles delete API failure by displaying an error message", async () => {
    vi.spyOn(feedbackApi, "fetchFeedback").mockResolvedValue({
      sessionId: "s1",
      status: "ready",
      summary: "Great job.",
      scores: [],
    });

    vi.spyOn(api, "deleteSession").mockRejectedValueOnce(
      new Error("Network connection error")
    );

    vi.spyOn(window, "confirm").mockReturnValue(true);

    renderResultsScreen({ sessionId: "s1" });

    const deleteBtn = await screen.findByRole("button", {
      name: /delete interview/i,
    });

    await act(async () => {
      fireEvent.click(deleteBtn);
    });

    expect(
      screen.getByText("Network connection error")
    ).toBeInTheDocument();

    expect(
      screen.getByRole("button", { name: /delete interview/i })
    ).toBeEnabled();
  });

  test("allows deleting an interview when feedback generation failed", async () => {
    vi.spyOn(feedbackApi, "fetchFeedback").mockResolvedValue({
      sessionId: "s1",
      status: "failed",
    });

    const deleteSpy = vi.spyOn(api, "deleteSession");
    vi.spyOn(window, "confirm").mockReturnValue(true);

    const onDeletedMock = vi.fn();

    renderResultsScreen({
      sessionId: "s1",
      onDeleted: onDeletedMock,
    });

    const deleteBtn = await screen.findByRole("button", {
      name: /delete interview/i,
    });

    await act(async () => {
      fireEvent.click(deleteBtn);
    });

    expect(deleteSpy).toHaveBeenCalledWith("s1");
    expect(onDeletedMock).toHaveBeenCalledTimes(1);
  });
});
