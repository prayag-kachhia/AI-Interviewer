// feedbackApi.local.ts
// STUB (feedback): fake data until FB3's real GET /feedback endpoint exists.
// Replace fetchFeedback's body with a real fetch() call once FB3 merges.

import type { Feedback, FeedbackStatus } from "@interview/contracts";

// Change this constant while developing to preview each state manually.
const FAKE_STATE: FeedbackStatus = "pending";

export async function fetchFeedback(sessionId: string): Promise<Feedback> {
  // simulate network latency
  await new Promise((r) => setTimeout(r, 400));

  if (FAKE_STATE === "pending") {
    return { sessionId, status: "pending" };
  }

  if (FAKE_STATE === "failed") {
    return { sessionId, status: "failed" };
  }

  return {
    sessionId,
    status: "ready",
    summary: "Solid communication, could go deeper on system design tradeoffs.",
    scores: [
      { category: "Communication", score: 4, comment: "Clear and structured answers." },
      { category: "Technical depth", score: 3, comment: "Correct but surface-level on tradeoffs." },
      { category: "Structure", score: 4, comment: "Followed a logical problem-solving order." },
    ],
  };
}