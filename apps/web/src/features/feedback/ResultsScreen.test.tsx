// ResultsScreen.test.tsx
import "@testing-library/jest-dom/vitest";
import { test, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ResultsScreen } from "./ResultsScreen";
import * as api from "./feedbackApi.local";

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