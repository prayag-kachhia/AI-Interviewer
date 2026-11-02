
import { useState } from "react";
import { useNavigate } from "react-router";
import { Trash2, AlertCircle, Loader2 } from "lucide-react";
import { useFeedback, useTurns } from "./useFeedback";
import type { TurnSpeaker } from "@interview/contracts";
import * as api from "../../lib/api";

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

interface ResultsScreenProps {
  sessionId: string;
  onDeleted?: () => void;
}

export function ResultsScreen({ sessionId, onDeleted }: ResultsScreenProps) {
  const feedback = useFeedback(sessionId);
  const { turns, isLoading, error } = useTurns(sessionId);
  const navigate = useNavigate();

  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [isDeleted, setIsDeleted] = useState(false);

  const handleDelete = async () => {
    if (deleting) return;

    setDeleting(true);
    setDeleteError("");

    try {
      await api.deleteSession(sessionId);
      setIsDeleted(true);

      if (onDeleted) {
        onDeleted();
      } else {
        navigate("/dashboard");
      }
    } catch (err: unknown) {
      const error = err as {
        response?: { data?: { message?: string } };
        message?: string;
      };

      setDeleteError(
        error.response?.data?.message ||
          error.message ||
          "Failed to delete interview"
      );
      setDeleting(false);
    }
  };

  const confirmDelete = () => {
    if (deleting) return;

    if (
      window.confirm(
        "Are you sure you want to delete this interview? This action cannot be undone."
      )
    ) {
      void handleDelete();
    }
  };

  if (isDeleted) {
    return (
      <div className="alert alert-info" role="status">
        <p>Interview session deleted successfully. Redirecting...</p>
      </div>
    );
  }

  return (
    <div>
      {(!feedback || feedback.status === "pending") && (
        <div role="status">
          <p>Preparing your feedback… this can take a moment.</p>
        </div>
      )}

      {feedback?.status === "failed" && (
        <div
          className="card"
          style={{
            maxWidth: "650px",
            margin: "2rem auto",
            padding: "2rem",
          }}
        >
          <div role="alert" style={{ marginBottom: "1.5rem" }}>
            <p>We couldn't generate feedback for this session.</p>
          </div>

          {deleteError && (
            <div
              className="alert alert-error"
              role="alert"
              style={{
                marginBottom: "1rem",
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
              }}
            >
              <AlertCircle size={18} />
              <span>{deleteError}</span>
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button
              type="button"
              className="btn btn-outline"
              style={{
                color: "var(--error-color, #ef4444)",
                borderColor: "rgba(239, 68, 68, 0.4)",
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
              }}
              onClick={confirmDelete}
              disabled={deleting}
            >
              {deleting ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Deleting...
                </>
              ) : (
                <>
                  <Trash2 size={16} />
                  Delete Interview
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {feedback?.status === "ready" && (
        <div
          className="card"
          style={{
            maxWidth: "750px",
            margin: "2rem auto",
            padding: "2.5rem",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "1.5rem",
              flexWrap: "wrap",
              gap: "1rem",
            }}
          >
            <h2 style={{ margin: 0 }}>Your Feedback</h2>

            <button
              type="button"
              className="btn btn-outline"
              style={{
                color: "var(--error-color, #ef4444)",
                borderColor: "rgba(239, 68, 68, 0.4)",
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
              }}
              onClick={confirmDelete}
              disabled={deleting}
            >
              {deleting ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Deleting...
                </>
              ) : (
                <>
                  <Trash2 size={16} />
                  Delete Interview
                </>
              )}
            </button>
          </div>

          {deleteError && (
            <div
              className="alert alert-error"
              role="alert"
              style={{
                marginBottom: "1.5rem",
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
              }}
            >
              <AlertCircle size={18} />
              <span>{deleteError}</span>
            </div>
          )}

          <p
            style={{
              fontSize: "1.05rem",
              lineHeight: 1.6,
              marginBottom: "2rem",
            }}
          >
            {feedback.summary}
          </p>

          <ul
            style={{
              listStyle: "none",
              padding: 0,
              margin: "0 0 2rem 0",
              display: "flex",
              flexDirection: "column",
              gap: "1rem",
            }}
          >
            {feedback.scores?.map((s) => (
              <li
                key={s.category}
                style={{
                  padding: "1rem",
                  background: "var(--bg-color)",
                  borderRadius: "var(--radius-md)",
                  border: "1px solid var(--border-color)",
                }}
              >
                <strong>{s.category}:</strong> {s.score}/5 — {s.comment}
              </li>
            ))}
          </ul>
        </div>
      )}

      <details
        open
        className="transcript-section"
        style={{ marginTop: "1.5rem" }}
      >
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
                    turn.speaker === "AI"
                      ? "var(--primary-light)"
                      : "var(--surface-color)",
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

                <div
                  style={{
                    color: "var(--text-main)",
                    fontSize: "0.95rem",
                  }}
                >
                  {turn.text}
                </div>
              </li>
            ))}
          </ol>
        )}
      </details>
    </div>
  );
}
