// useFeedback.ts
import { useEffect, useState } from "react";
import type { Feedback, Turn, Session } from "@interview/contracts";
import { getTurns, getSession } from "../../lib/api";
import { fetchFeedback } from "./feedbackApi";

const POLL_INTERVAL_MS = 3000;

export function useFeedback(sessionId: string, reloadTrigger = 0) {
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  useEffect(() => {
    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval>;

    if (reloadTrigger > 0) {
      setFeedback({ sessionId, status: "pending" });
    }

    async function poll() {
      try {
        const result = await fetchFeedback(sessionId);
        if (cancelled) return;
        setFeedback(result);

        if (result.status !== "pending") {
          clearInterval(intervalId);
        }
      } catch {
        // Keep polling on transient failure
      }
    }

    poll(); // fetch immediately on mount
    intervalId = setInterval(poll, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [sessionId, reloadTrigger]);

  return feedback;
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
