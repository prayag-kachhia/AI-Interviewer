// useFeedback.ts
import { useEffect, useState } from "react";
import type { Feedback } from "@interview/contracts";
import { fetchFeedback } from "./feedbackApi";

const POLL_INTERVAL_MS = 3000;

export function useFeedback(sessionId: string) {
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  useEffect(() => {
    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval>;

    async function poll() {
      const result = await fetchFeedback(sessionId);
      if (cancelled) return;
      setFeedback(result);

      if (result.status !== "pending") {
        clearInterval(intervalId);
      }
    }

    poll(); // fetch immediately on mount
    intervalId = setInterval(poll, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [sessionId]);

  return feedback;
}