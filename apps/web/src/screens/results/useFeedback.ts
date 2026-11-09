// useFeedback.ts
import { useEffect, useState } from "react";
import type { Feedback, Turn } from "@interview/contracts";
import { getFeedback, getTurns } from "../../lib/api";

const POLL_INTERVAL_MS = 3000;
// After this long still pending, the screen says it is taking longer than usual.
const LONG_WAIT_MS = 60_000;

// Polls until the feedback is ready or failed. Bump `reloadKey` (after a retry) to start polling again.
// sessionId is undefined only before the results screen redirects away; the hook then does nothing.
export function useFeedback(sessionId: string | undefined, reloadKey = 0) {
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLongWait, setIsLongWait] = useState(false);

  useEffect(() => {
    if (!sessionId) return;
    const id = sessionId;
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
        const result = await getFeedback(id);
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

export function useTurns(sessionId: string | undefined): UseTurnsResult {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(Boolean(sessionId));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadTurns(id: string) {
      setIsLoading(true);
      setError(null);

      try {
        const response = await getTurns(id);
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
      loadTurns(sessionId);
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
