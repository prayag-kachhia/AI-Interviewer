// ResultsScreen.tsx
import { useState } from "react";
import { useNavigate } from "react-router";
import { Trash2, AlertTriangle, AlertCircle, Loader2 } from "lucide-react";
import { useFeedback } from "./useFeedback";
import { deleteInterview } from "./feedbackApi";

interface ResultsScreenProps {
  sessionId: string;
  onDeleted?: () => void;
}

export function ResultsScreen({ sessionId, onDeleted }: ResultsScreenProps) {
  const feedback = useFeedback(sessionId);
  const [showConfirm, setShowConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [isDeleted, setIsDeleted] = useState(false);

  let navigate: ReturnType<typeof useNavigate> | undefined;
  try {
    navigate = useNavigate();
  } catch {
    // Graceful fallback for test environments rendered without a Router
  }

  const handleDelete = async () => {
    if (deleting) return;
    setDeleting(true);
    setDeleteError("");

    try {
      await deleteInterview(sessionId);
      setIsDeleted(true);
      setShowConfirm(false);

      if (onDeleted) {
        onDeleted();
      } else if (navigate) {
        navigate("/dashboard");
      } else if (typeof window !== "undefined" && window.location) {
        window.location.href = "/dashboard";
      }
    } catch (err: any) {
      setDeleteError(
        err.response?.data?.message || err.message || "Failed to delete interview"
      );
      setDeleting(false);
    }
  };

  const renderConfirmDialog = () => (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-confirm-message"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "rgba(0, 0, 0, 0.65)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        padding: "1rem",
      }}
    >
      <div
        className="card"
        style={{
          maxWidth: "480px",
          width: "100%",
          padding: "2rem",
          boxShadow: "var(--shadow-float)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.75rem",
            marginBottom: "1rem",
            color: "var(--error-color, #ef4444)",
          }}
        >
          <AlertTriangle size={24} />
          <h3 style={{ margin: 0, fontSize: "1.25rem", color: "var(--text-main)" }}>
            Confirm Deletion
          </h3>
        </div>

        <p
          id="delete-confirm-message"
          style={{
            color: "var(--text-muted)",
            fontSize: "0.95rem",
            lineHeight: 1.6,
            marginBottom: "1.5rem",
          }}
        >
          Are you sure you want to delete this interview? This action cannot be undone.
        </p>

        {deleteError && (
          <div
            className="alert alert-error"
            role="alert"
            style={{ marginBottom: "1rem", display: "flex", gap: "0.5rem", alignItems: "center" }}
          >
            <AlertCircle size={18} />
            <span>{deleteError}</span>
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.75rem" }}>
          <button
            type="button"
            className="btn btn-outline"
            onClick={() => {
              if (!deleting) {
                setShowConfirm(false);
                setDeleteError("");
              }
            }}
            disabled={deleting}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn"
            style={{
              backgroundColor: "var(--error-color, #ef4444)",
              color: "#fff",
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
            }}
            onClick={handleDelete}
            disabled={deleting}
          >
            {deleting ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Deleting...
              </>
            ) : (
              <>
                <Trash2 size={16} /> Delete Interview
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );

  if (isDeleted) {
    return (
      <div className="alert alert-info" role="status">
        <p>Interview session deleted successfully. Redirecting...</p>
      </div>
    );
  }

  if (!feedback || feedback.status === "pending") {
    return (
      <div role="status">
        <p>Preparing your feedback… this can take a moment.</p>
      </div>
    );
  }

  if (feedback.status === "failed") {
    return (
      <div className="card" style={{ maxWidth: "650px", margin: "2rem auto", padding: "2rem" }}>
        <div role="alert" style={{ marginBottom: "1.5rem" }}>
          <p>We couldn't generate feedback for this session.</p>
        </div>
        {!showConfirm && (
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
              onClick={() => setShowConfirm(true)}
            >
              <Trash2 size={16} /> Delete Interview
            </button>
          </div>
        )}
        {showConfirm && renderConfirmDialog()}
      </div>
    );
  }

  // status === "ready"
  return (
    <div className="card" style={{ maxWidth: "750px", margin: "2rem auto", padding: "2.5rem" }}>
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
        {!showConfirm && (
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
            onClick={() => setShowConfirm(true)}
          >
            <Trash2 size={16} /> Delete Interview
          </button>
        )}
      </div>

      <p style={{ fontSize: "1.05rem", lineHeight: 1.6, marginBottom: "2rem" }}>
        {feedback.summary}
      </p>

      <ul style={{ listStyle: "none", padding: 0, margin: "0 0 2rem 0", display: "flex", flexDirection: "column", gap: "1rem" }}>
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

      {showConfirm && renderConfirmDialog()}
    </div>
  );
}
