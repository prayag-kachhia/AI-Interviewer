// ResultsScreen.test.tsx
import "@testing-library/jest-dom/vitest";
import { test, expect, vi, afterEach, describe } from "vitest";
import { act, render, screen, fireEvent } from "@testing-library/react";
import { ResultsScreen } from "./ResultsScreen";
import * as api from "./feedbackApi";

// The real API client creates a Supabase client on import; these tests replace fetchFeedback anyway.
vi.mock("../../lib/api", () => ({
  getFeedback: vi.fn(),
  deleteSession: vi.fn().mockResolvedValue({ success: true }),
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

describe("FR-28 — ResultsScreen Delete Interview", () => {
  test("shows Delete Interview button when feedback is ready, and clicking it opens confirmation without deleting", async () => {
    vi.spyOn(api, "fetchFeedback").mockResolvedValue({
      sessionId: "s1",
      status: "ready",
      summary: "Great job.",
      scores: [],
    });
    const deleteSpy = vi.spyOn(api, "deleteInterview").mockResolvedValue({ success: true });

    render(<ResultsScreen sessionId="s1" />);
    const deleteBtn = await screen.findByRole("button", { name: /delete interview/i });
    expect(deleteBtn).toBeInTheDocument();

    // Clicking delete opens confirmation
    fireEvent.click(deleteBtn);

    expect(
      screen.getByText("Are you sure you want to delete this interview? This action cannot be undone.")
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^cancel$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /delete interview/i })).toBeInTheDocument();

    // Nothing deleted yet
    expect(deleteSpy).not.toHaveBeenCalled();
  });

  test("cancelling confirmation closes dialog and does not trigger delete API", async () => {
    vi.spyOn(api, "fetchFeedback").mockResolvedValue({
      sessionId: "s1",
      status: "ready",
      summary: "Great job.",
      scores: [],
    });
    const deleteSpy = vi.spyOn(api, "deleteInterview").mockResolvedValue({ success: true });

    render(<ResultsScreen sessionId="s1" />);
    const deleteBtn = await screen.findByRole("button", { name: /delete interview/i });
    fireEvent.click(deleteBtn);

    const cancelBtn = screen.getByRole("button", { name: /^cancel$/i });
    fireEvent.click(cancelBtn);

    // Confirmation dialog is closed
    expect(
      screen.queryByText("Are you sure you want to delete this interview? This action cannot be undone.")
    ).not.toBeInTheDocument();

    // API was not called
    expect(deleteSpy).not.toHaveBeenCalled();

    // Main Delete Interview button is visible again
    expect(screen.getByRole("button", { name: /delete interview/i })).toBeInTheDocument();
  });

  test("confirming deletion calls delete API and triggers onDeleted callback", async () => {
    vi.spyOn(api, "fetchFeedback").mockResolvedValue({
      sessionId: "s1",
      status: "ready",
      summary: "Great job.",
      scores: [],
    });
    const deleteSpy = vi.spyOn(api, "deleteInterview").mockResolvedValue({ success: true });
    const onDeletedMock = vi.fn();

    render(<ResultsScreen sessionId="s1" onDeleted={onDeletedMock} />);
    const deleteBtn = await screen.findByRole("button", { name: /delete interview/i });
    fireEvent.click(deleteBtn);

    const confirmBtn = screen.getByRole("button", { name: /delete interview/i });
    await act(async () => {
      fireEvent.click(confirmBtn);
    });

    expect(deleteSpy).toHaveBeenCalledWith("s1");
    expect(onDeletedMock).toHaveBeenCalledTimes(1);
    expect(
      screen.getByText("Interview session deleted successfully. Redirecting...")
    ).toBeInTheDocument();
    // Stale feedback is no longer displayed
    expect(screen.queryByText("Great job.")).not.toBeInTheDocument();
  });

  test("handles delete API failure gracefully by displaying error message", async () => {
    vi.spyOn(api, "fetchFeedback").mockResolvedValue({
      sessionId: "s1",
      status: "ready",
      summary: "Great job.",
      scores: [],
    });
    vi.spyOn(api, "deleteInterview").mockRejectedValueOnce(
      new Error("Network connection error")
    );

    render(<ResultsScreen sessionId="s1" />);
    const deleteBtn = await screen.findByRole("button", { name: /delete interview/i });
    fireEvent.click(deleteBtn);

    const confirmBtn = screen.getByRole("button", { name: /delete interview/i });
    await act(async () => {
      fireEvent.click(confirmBtn);
    });

    expect(screen.getByText("Network connection error")).toBeInTheDocument();
    // Dialog remains open for retry or cancellation
    expect(
      screen.getByText("Are you sure you want to delete this interview? This action cannot be undone.")
    ).toBeInTheDocument();
  });
});
