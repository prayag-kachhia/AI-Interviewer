// ResultsScreen.test.tsx
import "@testing-library/jest-dom/vitest";
import { test, expect, vi, afterEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { ResultsScreen } from "./ResultsScreen";
import { getFeedback } from "../../lib/api";

// The real API client creates a Supabase client on import; these tests replace getFeedback anyway.
vi.mock("../../lib/api", () => ({ getFeedback: vi.fn() }));

const renderResults = () =>
  render(
    <MemoryRouter initialEntries={["/interview/s1/feedback"]}>
      <Routes>
        <Route path="/interview/:sessionId/feedback" element={<ResultsScreen />} />
      </Routes>
    </MemoryRouter>,
  );

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.mocked(getFeedback).mockReset();
});

test("given feedback is pending, then it shows preparing and keeps polling", async () => {
  vi.mocked(getFeedback).mockResolvedValue({
    sessionId: "s1",
    status: "pending",
  });

  renderResults();
  expect(await screen.findByRole("status")).toBeInTheDocument();
});

test("given feedback is ready, then it is displayed", async () => {
  vi.mocked(getFeedback).mockResolvedValue({
    sessionId: "s1",
    status: "ready",
    summary: "Great job.",
    scores: [{ category: "Communication", score: 5, comment: "Excellent." }],
  });

  renderResults();
  expect(await screen.findByText("Great job.")).toBeInTheDocument();
});

test("given feedback failed, then the screen says so", async () => {
  vi.mocked(getFeedback).mockResolvedValue({
    sessionId: "s1",
    status: "failed",
  });

  renderResults();
  expect(await screen.findByRole("alert")).toBeInTheDocument();
});

test("given feedback is pending, then it polls again and shows it once ready, then stops", async () => {
  vi.useFakeTimers();
  const fetchSpy = vi
    .mocked(getFeedback)
    .mockResolvedValueOnce({ sessionId: "s1", status: "pending" })
    .mockResolvedValue({ sessionId: "s1", status: "ready", summary: "Ready now.", scores: [] });

  renderResults();
  await act(() => vi.advanceTimersByTimeAsync(0));
  expect(screen.getByRole("status")).toBeInTheDocument();

  await act(() => vi.advanceTimersByTimeAsync(3000));
  expect(screen.getByText("Ready now.")).toBeInTheDocument();
  expect(fetchSpy).toHaveBeenCalledTimes(2);

  await act(() => vi.advanceTimersByTimeAsync(9000));
  expect(fetchSpy).toHaveBeenCalledTimes(2);
});
