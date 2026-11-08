// useFeedback.ts
import { useEffect, useState } from "react";
import type { Feedback, Turn, Session } from "@interview/contracts";
import { getTurns, getSession } from "../../lib/api";
import { fetchFeedback } from "./feedbackApi";

const POLL_INTERVAL_MS = 3000;
const LONG_WAIT_THRESHOLD_MS = 60000;

export interface UseFeedbackResult {
  feedback: Feedback | null;
  error: string | null;
  isLongWaiting: boolean;
}

export function useFeedback(sessionId: string, reloadTrigger = 0): UseFeedbackResult {
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLongWaiting, setIsLongWaiting] = useState<boolean>(false);

  useEffect(() => {
    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval>;
    let longWaitTimer: ReturnType<typeof setTimeout>;

    setError(null);
    setIsLongWaiting(false);

    if (reloadTrigger > 0) {
      setFeedback({ sessionId, status: "pending" });
    }

    longWaitTimer = setTimeout(() => {
      if (!cancelled) {
        setIsLongWaiting(true);
      }
    }, LONG_WAIT_THRESHOLD_MS);

    async function poll() {
      try {
        const result = await fetchFeedback(sessionId);
        if (cancelled) return;
        setFeedback(result);
        setError(null);

        if (result.status !== "pending") {
          clearInterval(intervalId);
          clearTimeout(longWaitTimer);
          setIsLongWaiting(false);
        }
      } catch (err: any) {
        if (cancelled) return;
        const msg =
          err?.response?.data?.message ||
          err?.message ||
          "Unable to load feedback. Please try again.";
        setError(msg);
      }
    }

    intervalId = setInterval(poll, POLL_INTERVAL_MS);
    poll(); // fetch immediately on mount

    return () => {
      cancelled = true;
      clearInterval(intervalId);
      clearTimeout(longWaitTimer);
    };
  }, [sessionId, reloadTrigger]);

  return { feedback, error, isLongWaiting };
}

export function useSessionDetails(sessionId: string): Session | null {
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadSession() {
      try {
        if (typeof getSession === "function") {
          const res = await getSession(sessionId);
          if (!cancelled && res?.data) {
            setSession(res.data);
          }
        }
      } catch {
        // ignore errors
      }
    }

    if (sessionId) {
      loadSession();
    }

    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  return session;
}

export function useTurns(sessionId: string): Turn[] {
  const [turns, setTurns] = useState<Turn[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function loadTurns() {
      try {
        const response = await getTurns(sessionId);
        if (cancelled) return;
        const data = response?.data ?? [];
        const sorted = [...data].sort((a, b) => a.turnIndex - b.turnIndex);
        setTurns(sorted);
      } catch {
        if (!cancelled) {
          setTurns([]);
        }
      }
    }

    if (sessionId) {
      loadTurns();
    }

    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  return turns;
}

export const useTranscript = useTurns;
