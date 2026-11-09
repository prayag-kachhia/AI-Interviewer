// ResultsScreen.tsx
import { useState } from "react";
import { useFeedback, useTurns } from "./useFeedback";
import { retryFeedback } from "./feedbackApi";
import type { TurnSpeaker } from "@interview/contracts";

export function formatSpeaker(speaker: TurnSpeaker | string): string {
  if (speaker === "AI") return "AI Interviewer";
  if (speaker === "CANDIDATE") return "Candidate";
  return speaker;
}

export function formatElapsedTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds || 0));
  const mm = Math.floor(s / 60)
    .toString()
    .padStart(2, "0");
  const ss = (s % 60).toString().padStart(2, "0");
  return `${mm}:${ss}`;
}

export function ResultsScreen({ sessionId }: { sessionId: string }) {
  const [reloadKey, setReloadKey] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const { feedback, error: feedbackError, isLongWait } = useFeedback(sessionId, reloadKey);
  const { turns, isLoading, error } = useTurns(sessionId);

  async function handleRetry() {
    setRetrying(true);
    setRetryError(null);
    try {
      await retryFeedback(sessionId);
      setReloadKey((key) => key + 1);
    } catch {
      setRetryError("Couldn't restart the feedback. Please try again.");
    } finally {
      setRetrying(false);
    }
  }

  return (
    <div>
      {(!feedback || feedback.status === "pending") && (
        <div role="status">
          <p>Preparing your feedback… this can take a moment.</p>
          {isLongWait && <p>This is taking longer than usual.</p>}
          {feedbackError && <p>{feedbackError}</p>}
        </div>
      )}

      {feedback?.status === "failed" && (
        <div role="alert">
          <p>We couldn't generate feedback for this session.</p>
          {retryError && <p>{retryError}</p>}
          <button type="button" className="btn btn-primary" onClick={handleRetry} disabled={retrying}>
            {retrying ? "Retrying…" : "Try again"}
          </button>
        </div>
      )}

      {feedback?.status === "ready" && (
        <div>
          <h2>Your Feedback</h2>
          <p>{feedback.summary}</p>
          <ul>
            {feedback.scores?.map((s) => (
              <li key={s.category}>
                <strong>{s.category}:</strong> {s.score}/5 — {s.comment}
                {s.strengths.length > 0 && <p>Strengths: {s.strengths.join("; ")}</p>}
                {s.improvements.length > 0 && <p>To improve: {s.improvements.join("; ")}</p>}
                {s.quote && <blockquote>“{s.quote}”</blockquote>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <details open className="transcript-section" style={{ marginTop: "1.5rem" }}>
        <summary
          style={{
            cursor: "pointer",
            fontWeight: 600,
            fontSize: "1.15rem",
            marginBottom: "0.75rem",
          }}
        >
          Transcript
        </summary>
        {isLoading ? (
          <p className="loading-state">Loading transcript…</p>
        ) : error ? (
          <p className="error-state" role="alert">
            {error}
          </p>
        ) : turns.length === 0 ? (
          <p className="empty-state">No transcript turns recorded.</p>
        ) : (
          <ol
            style={{
              listStyle: "none",
              padding: 0,
              margin: 0,
              display: "flex",
              flexDirection: "column",
              gap: "0.75rem",
            }}
          >
            {turns.map((turn) => (
              <li
                key={turn.id || `${turn.turnIndex}-${turn.timestampSec}`}
                data-testid={`transcript-turn-${turn.turnIndex}`}
                style={{
                  border: "1px solid var(--border-color)",
                  borderRadius: "8px",
                  padding: "0.75rem 1rem",
                  background:
                    turn.speaker === "AI" ? "var(--primary-light)" : "var(--surface-color)",
                }}
              >
                <div
                  style={{
                    fontSize: "0.85rem",
                    fontWeight: 600,
                    marginBottom: "0.25rem",
                    color: "var(--text-muted)",
                    display: "flex",
                    alignItems: "center",
                    gap: "0.5rem",
                  }}
                >
                  <span>{formatSpeaker(turn.speaker)}</span>
                  <span>•</span>
                  <span>{formatElapsedTime(turn.timestampSec)}</span>
                </div>
                <div style={{ color: "var(--text-main)", fontSize: "0.95rem" }}>{turn.text}</div>
              </li>
            ))}
          </ol>
        )}
      </details>
    </div>
  );
}
