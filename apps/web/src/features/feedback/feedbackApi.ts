import type { Feedback } from "@interview/contracts";
import { getFeedback, retryFeedback as apiRetryFeedback } from "../../lib/api";

// The results screen's one data source; tests replace it with fixed states.
export async function fetchFeedback(sessionId: string): Promise<Feedback> {
  return getFeedback(sessionId);
}

export async function retryFeedback(
  sessionId: string
): Promise<{ success: boolean; message?: string }> {
  return apiRetryFeedback(sessionId);
}
