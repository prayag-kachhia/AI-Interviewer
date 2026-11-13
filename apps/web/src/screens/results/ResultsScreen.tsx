// ResultsScreen.tsx
import { useEffect, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router";
import { deleteSession, getSession, retryFeedback } from "../../lib/api";
import { useFeedback, useTurns } from "./useFeedback";
import type { Session, TurnSpeaker } from "@interview/contracts";

export function formatEndReason(reason?: string | null): string {
  if (!reason) return '';
  switch (reason) {
    case 'finished_early':
      return 'Finished early';
    case 'technical_problem':
      return 'Technical problem';
    case 'need_to_stop':
      return 'Need to stop';
    case 'other':
      return 'Other';
    default:
      return reason.replace(/_/g, ' ');
  }
}

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

// Route: /interview/:sessionId/feedback — where ending an interview lands.
export function ResultsScreen() {
  const { sessionId } = useParams();
  const [reloadKey, setReloadKey] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const navigate = useNavigate();
  const { feedback, error: feedbackError, isLongWait } = useFeedback(sessionId, reloadKey);
  const { turns, isLoading, error } = useTurns(sessionId);

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    try {
      const promise = getSession(sessionId);
      if (promise && typeof promise.then === "function") {
        promise
          .then((res) => {
            if (!cancelled && res?.data) {
              setSession(res.data);
            }
          })
          .catch(() => {
            // Silently continue if session metadata is unavailable
          });
      }
    } catch {
      // Ignore
    }
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  if (!sessionId) {
    return <Navigate to="/dashboard" replace />;
  }

  const handleRetry = async () => {
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
  };

  const handleDelete = async () => {
    if (!window.confirm("Are you sure you want to delete this interview? This action cannot be undone.")) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteSession(sessionId);
      navigate("/history");
    } catch {
      setDeleteError("Couldn't delete the interview. Please try again.");
      setDeleting(false);
    }
  };

  return (
    <div className="container page-wrapper">
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
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap", marginBottom: "0.5rem" }}>
            <h2 style={{ margin: 0 }}>Your Feedback</h2>
            {(session?.endedEarly || session?.endReason) && (
              <span
                data-testid="results-ended-early"
                style={{
                  backgroundColor: "var(--warning-bg, #fef3c7)",
                  color: "var(--warning-text, #92400e)",
                  border: "1px solid rgba(245, 158, 11, 0.3)",
                  borderRadius: "9999px",
                  padding: "0.2rem 0.65rem",
                  fontSize: "0.8rem",
                  fontWeight: 600,
                }}
              >
                Ended early{session.endReason ? ` (${formatEndReason(session.endReason)})` : ''}
              </span>
            )}
          </div>
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

      {deleteError && <p role="alert">{deleteError}</p>}
      <button type="button" className="btn btn-outline" onClick={handleDelete} disabled={deleting}>
        {deleting ? "Deleting…" : "Delete interview"}
      </button>
    </div>
  );
}
