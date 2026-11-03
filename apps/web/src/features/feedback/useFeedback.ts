// useFeedback.ts
import { useEffect, useState } from "react";
import type { Feedback, Turn } from "@interview/contracts";
import { getTurns } from "../../lib/api";
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
