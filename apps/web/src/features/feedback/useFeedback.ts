// useFeedback.ts
import { useEffect, useState } from "react";
import type { Feedback, Turn } from "@interview/contracts";
import { getTurns } from "../../lib/api";
import { fetchFeedback } from "./feedbackApi";

const POLL_INTERVAL_MS = 3000;
// After this long still pending, the screen says it is taking longer than usual.
const LONG_WAIT_MS = 60_000;

// Polls until the feedback is ready or failed. Bump `reloadKey` (after a retry) to start polling again.
export function useFeedback(sessionId: string, reloadKey = 0) {
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLongWait, setIsLongWait] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval>;
    setError(null);
    setIsLongWait(false);
    const longWaitId = setTimeout(() => setIsLongWait(true), LONG_WAIT_MS);

    function stop() {
      clearInterval(intervalId);
      clearTimeout(longWaitId);
    }

    async function poll() {
      try {
        const result = await fetchFeedback(sessionId);
        if (cancelled) return;
        setFeedback(result);
        setError(null);
        if (result.status !== "pending") stop();
      } catch {
        // Keep polling: a dropped request shouldn't end the wait, but the screen says so.
        if (!cancelled) setError("Unable to load feedback. Retrying…");
      }
    }

    poll(); // fetch immediately on mount
    intervalId = setInterval(poll, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      stop();
    };
  }, [sessionId, reloadKey]);

  return { feedback, error, isLongWait };
}

export interface UseTurnsResult {
  turns: Turn[];
  isLoading: boolean;
  isError: boolean;
  error: string | null;
  status: "loading" | "success" | "error";
}

export function useTurns(sessionId: string): UseTurnsResult {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(Boolean(sessionId));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadTurns() {
      setIsLoading(true);
      setError(null);

      try {
        const response = await getTurns(sessionId);
        if (cancelled) return;
        if (response && response.success === false) {
          throw new Error(response.message || "Unable to load transcript. Please try again.");
        }
        const data = response?.data ?? [];
        const sorted = [...data].sort((a, b) => a.turnIndex - b.turnIndex);
        setTurns(sorted);
        setError(null);
        setIsLoading(false);
      } catch {
        if (!cancelled) {
          setError("Unable to load transcript. Please try again.");
          setIsLoading(false);
        }
      }
    }

    if (sessionId) {
      loadTurns();
    } else {
      setIsLoading(false);
      setTurns([]);
      setError(null);
    }

    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const isError = error !== null;
  const status = isLoading ? "loading" : isError ? "error" : "success";

  return { turns, isLoading, isError, error, status };
}
