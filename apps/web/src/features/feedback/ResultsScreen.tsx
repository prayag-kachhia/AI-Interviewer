// ResultsScreen.tsx
import { useState } from "react";
import type { TurnSpeaker, Session, Turn } from "@interview/contracts";
import { useFeedback, useTurns, useSessionDetails } from "./useFeedback";
import { retryFeedback } from "./feedbackApi";
import { isEndedEarly } from "../../lib/sessionUtils";

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

export function TranscriptSection({ turns }: { turns: Turn[] }) {
  return (
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
      {turns.length === 0 ? (
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
  );
}

export function ResultsScreen({
  sessionId,
  initialSession,
}: {
  sessionId: string;
  initialSession?: Session | null;
}) {
  const [reloadTrigger, setReloadTrigger] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);

  const feedback = useFeedback(sessionId, reloadTrigger);
  const turns = useTurns(sessionId);
  const fetchedSession = useSessionDetails(sessionId);
  const session = initialSession ?? fetchedSession;
  const endedEarly = isEndedEarly(session);

  const handleRetry = async () => {
    setRetrying(true);
    setRetryError(null);
    try {
      await retryFeedback(sessionId);
      setReloadTrigger((count) => count + 1);
    } catch (err: any) {
      const message =
        err?.response?.data?.message || err?.message || "Failed to retry feedback generation.";
      setRetryError(message);
    } finally {
      setRetrying(false);
    }
  };

  if (!feedback || feedback.status === "pending") {
    return (
      <div role="status">
        <p>Preparing your feedback… this can take a moment.</p>
      </div>
    );
  }

  if (feedback.status === "failed") {
    const errorMsg = "error" in feedback ? (feedback as { error?: string }).error : undefined;
    return (
      <div>
        <div role="alert" style={{ marginBottom: "1.5rem" }}>
          <p>We couldn't generate feedback for this session.</p>
          {errorMsg && <p>{errorMsg}</p>}
          {retryError && (
            <p style={{ color: "var(--error-color, #ef4444)", marginTop: "0.5rem" }}>
              {retryError}
            </p>
          )}
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleRetry}
            disabled={retrying}
            style={{ marginTop: "1rem" }}
          >
            {retrying ? "Retrying…" : "Try again"}
          </button>
        </div>

        <TranscriptSection turns={turns} />
      </div>
    );
  }

  // status === "ready"
  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
          marginBottom: "0.5rem",
        }}
      >
        <h2 style={{ margin: 0 }}>Your Feedback</h2>
        {endedEarly && (
          <span
            data-testid="ended-early-badge"
            style={{
              display: "inline-block",
              backgroundColor: "var(--warning-bg, #fef3c7)",
              color: "var(--warning-text, #92400e)",
              border: "1px solid rgba(245, 158, 11, 0.3)",
              borderRadius: "9999px",
              padding: "0.2rem 0.6rem",
              fontSize: "0.8rem",
              fontWeight: 600,
            }}
          >
            Ended early
          </span>
        )}
      </div>

      <p>{feedback.summary}</p>
      <ul
        style={{
          listStyle: "none",
          padding: 0,
          margin: "1rem 0",
          display: "flex",
          flexDirection: "column",
          gap: "1rem",
        }}
      >
        {feedback.scores?.map((s) => (
          <li
            key={s.category}
            data-testid={`feedback-score-${s.category.toLowerCase().replace(/\s+/g, "-")}`}
            style={{
              border: "1px solid var(--border-color)",
              borderRadius: "8px",
              padding: "1rem",
              background: "var(--surface-color)",
            }}
          >
            <div>
              <strong>{s.category}:</strong> {s.score}/5 — {s.comment}
            </div>

            {s.strengths && s.strengths.length > 0 && (
              <div style={{ marginTop: "0.5rem" }}>
                <strong style={{ fontSize: "0.9rem", color: "var(--success-color, #10b981)" }}>
                  Strengths:
                </strong>
                <ul style={{ margin: "0.25rem 0 0.25rem 1.25rem" }}>
                  {s.strengths.map((str, idx) => (
                    <li key={idx} style={{ color: "var(--text-main)", fontSize: "0.9rem" }}>
                      {str}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {s.improvements && s.improvements.length > 0 && (
              <div style={{ marginTop: "0.5rem" }}>
                <strong style={{ fontSize: "0.9rem", color: "var(--warning-color, #f59e0b)" }}>
                  Areas for Improvement:
                </strong>
                <ul style={{ margin: "0.25rem 0 0.25rem 1.25rem" }}>
                  {s.improvements.map((imp, idx) => (
                    <li key={idx} style={{ color: "var(--text-main)", fontSize: "0.9rem" }}>
                      {imp}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {s.quote && (
              <div
                style={{
                  marginTop: "0.5rem",
                  fontStyle: "italic",
                  color: "var(--text-muted)",
                  fontSize: "0.9rem",
                }}
              >
                <span>Supporting Quote: </span>
                <span>"{s.quote}"</span>
              </div>
            )}
          </li>
        ))}
      </ul>

      <TranscriptSection turns={turns} />
    </div>
  );
}
