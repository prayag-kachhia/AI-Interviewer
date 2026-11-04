import { useEffect, useState } from "react";
import type { Feedback } from "@interview/contracts";
import { getFeedback } from "../../lib/api";

const POLL_INTERVAL_MS = 3000;

export function useFeedback(sessionId: string | undefined) {
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    const id = sessionId; // keeps the narrowed type inside poll()
    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval>;

    async function poll() {
      const result = await getFeedback(id);
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