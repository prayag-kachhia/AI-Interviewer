import "@testing-library/jest-dom/vitest";
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PerAnswerFeedbackSection } from "./PerAnswerFeedbackSection";
import type { PerAnswerFeedback } from "@interview/contracts";

const MOCK_PER_ANSWER: PerAnswerFeedback[] = [
  {
    question: "How do you design a high-throughput rate limiter?",
    summary: "Described token bucket algorithm with Redis and Lua scripts for atomic increments.",
    strengths: ["Atomic Lua scripting prevents race conditions", "Clear rate limiting mathematical model"],
    improvements: ["Discuss fail-open vs fail-closed strategy during Redis outage"],
  },
  {
    question: "What is database indexing and how do B-trees work?",
    summary: "Explained B-Tree structure, balanced tree node traversal, and index seek complexity.",
    strengths: ["Accurate O(log N) depth and balance analysis", "Clear leftmost prefix rule explanation"],
    improvements: ["Mention write overhead of maintaining indexes on INSERT/UPDATE"],
  },
];

describe("PerAnswerFeedbackSection (PN-9, #174)", () => {
  it("renders nothing when perAnswer is undefined (backward compatibility)", () => {
    const { container } = render(<PerAnswerFeedbackSection perAnswer={undefined} />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId("per-answer-feedback-section")).not.toBeInTheDocument();
  });

  it("renders nothing when perAnswer is an empty array", () => {
    const { container } = render(<PerAnswerFeedbackSection perAnswer={[]} />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId("per-answer-feedback-section")).not.toBeInTheDocument();
  });

  it("renders questions and summaries for all answers", () => {
    render(<PerAnswerFeedbackSection perAnswer={MOCK_PER_ANSWER} />);

    expect(screen.getByText("Feedback by Answer")).toBeInTheDocument();
    expect(
      screen.getByText("How do you design a high-throughput rate limiter?")
    ).toBeInTheDocument();
    expect(
      screen.getByText("What is database indexing and how do B-trees work?")
    ).toBeInTheDocument();

    expect(
      screen.getByText(
        "Described token bucket algorithm with Redis and Lua scripts for atomic increments."
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Explained B-Tree structure, balanced tree node traversal, and index seek complexity."
      )
    ).toBeInTheDocument();
  });

  it("answers are collapsed initially and expand on click", () => {
    render(<PerAnswerFeedbackSection perAnswer={MOCK_PER_ANSWER} />);

    // Strengths and improvements are not visible initially
    expect(
      screen.queryByText("Atomic Lua scripting prevents race conditions")
    ).not.toBeInTheDocument();

    const firstAnswerToggle = screen.getByRole("button", {
      name: /How do you design a high-throughput rate limiter/i,
    });
    expect(firstAnswerToggle).toHaveAttribute("aria-expanded", "false");

    // Click to expand
    fireEvent.click(firstAnswerToggle);

    expect(firstAnswerToggle).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByText("Atomic Lua scripting prevents race conditions")
    ).toBeInTheDocument();
    expect(
      screen.getByText("Discuss fail-open vs fail-closed strategy during Redis outage")
    ).toBeInTheDocument();

    // Second answer remains collapsed
    expect(
      screen.queryByText("Accurate O(log N) depth and balance analysis")
    ).not.toBeInTheDocument();

    // Click again to collapse
    fireEvent.click(firstAnswerToggle);
    expect(firstAnswerToggle).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.queryByText("Atomic Lua scripting prevents race conditions")
    ).not.toBeInTheDocument();
  });

  it("toggles all answers with Expand all / Collapse all button", () => {
    render(<PerAnswerFeedbackSection perAnswer={MOCK_PER_ANSWER} />);

    const toggleAllBtn = screen.getByRole("button", { name: "Expand all answers" });
    expect(toggleAllBtn).toHaveTextContent("Expand all");

    // Click Expand all
    fireEvent.click(toggleAllBtn);

    expect(screen.getByText("Collapse all")).toBeInTheDocument();
    expect(
      screen.getByText("Atomic Lua scripting prevents race conditions")
    ).toBeInTheDocument();
    expect(
      screen.getByText("Accurate O(log N) depth and balance analysis")
    ).toBeInTheDocument();

    // Click Collapse all
    const collapseAllBtn = screen.getByRole("button", { name: "Collapse all answers" });
    fireEvent.click(collapseAllBtn);

    expect(screen.getByText("Expand all")).toBeInTheDocument();
    expect(
      screen.queryByText("Atomic Lua scripting prevents race conditions")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Accurate O(log N) depth and balance analysis")
    ).not.toBeInTheDocument();
  });

  it("regression: transitions from undefined to defined perAnswer without React hook errors", () => {
    const { rerender } = render(<PerAnswerFeedbackSection perAnswer={undefined} />);
    expect(screen.queryByTestId("per-answer-feedback-section")).not.toBeInTheDocument();

    // Rerender with valid perAnswer data
    rerender(<PerAnswerFeedbackSection perAnswer={MOCK_PER_ANSWER} />);
    expect(screen.getByTestId("per-answer-feedback-section")).toBeInTheDocument();
    expect(screen.getByText("How do you design a high-throughput rate limiter?")).toBeInTheDocument();
  });
});
