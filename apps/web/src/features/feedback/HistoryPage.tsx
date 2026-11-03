import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { Clock, Calendar, ArrowRight, AlertCircle, Loader2, Sparkles, CheckCircle2 } from "lucide-react";
import { ROLES } from "@interview/contracts";
import { getSessions } from "../../lib/api";
import { isEndedEarly } from "../../lib/sessionUtils";
import type { SessionListItem } from "../../types";

export const HistoryPage: React.FC = () => {
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;

    async function loadSessions() {
      try {
        setLoading(true);
        setError(null);
        const res = await getSessions();
        if (cancelled) return;
        const list = res?.data || [];
        // Ensure sorted newest first
        const sorted = [...list].sort((a, b) => {
          const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
          const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
          return timeB - timeA;
        });
        setSessions(sorted);
      } catch (err: any) {
        if (cancelled) return;
        setError(err?.response?.data?.message || err?.message || "Failed to load interview history");
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadSessions();

    return () => {
      cancelled = true;
    };
  }, []);

  const formatDate = (dateString?: string) => {
    if (!dateString) return "Unknown date";
    try {
      const d = new Date(dateString);
      if (Number.isNaN(d.getTime())) return dateString;
      return d.toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return dateString;
    }
  };

  const renderFeedbackStatus = (status?: string) => {
    switch (status) {
      case "ready":
        return (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.25rem",
              color: "var(--success-color, #10b981)",
              backgroundColor: "var(--success-bg, #d1fae5)",
              padding: "0.2rem 0.6rem",
              borderRadius: "9999px",
              fontSize: "0.8rem",
              fontWeight: 600,
            }}
          >
            <CheckCircle2 size={13} />
            Ready
          </span>
        );
      case "failed":
        return (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.25rem",
              color: "var(--error-color, #ef4444)",
              backgroundColor: "var(--error-bg, #fee2e2)",
              padding: "0.2rem 0.6rem",
              borderRadius: "9999px",
              fontSize: "0.8rem",
              fontWeight: 600,
            }}
          >
            Failed
          </span>
        );
      case "pending":
      default:
        return (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.25rem",
              color: "var(--warning-color, #f59e0b)",
              backgroundColor: "var(--warning-bg, #fef3c7)",
              padding: "0.2rem 0.6rem",
              borderRadius: "9999px",
              fontSize: "0.8rem",
              fontWeight: 600,
            }}
          >
            <Clock size={13} />
            Pending
          </span>
        );
    }
  };

  return (
    <div className="container page-wrapper">
      <div style={{ marginBottom: "2.5rem" }}>
        <h1 className="text-gradient" style={{ marginBottom: "0.5rem" }}>
          Interview History
        </h1>
        <p style={{ fontSize: "1.1rem", color: "var(--text-muted)" }}>
          Review your previous mock interviews, feedback scores, and transcripts.
        </p>
      </div>

      {loading && (
        <div role="status" className="alert alert-info" style={{ justifyContent: "center" }}>
          <Loader2 size={20} className="animate-spin" />
          <span>Loading interview history…</span>
        </div>
      )}

      {error && (
        <div className="alert alert-error" role="alert">
          <AlertCircle size={20} />
          <span>{error}</span>
        </div>
      )}

      {!loading && !error && sessions.length === 0 && (
        <div
          className="card"
          style={{
            textAlign: "center",
            padding: "4rem 2rem",
            maxWidth: "600px",
            margin: "0 auto",
          }}
        >
          <div
            style={{
              width: "64px",
              height: "64px",
              borderRadius: "50%",
              background: "var(--primary-light)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 1.5rem",
              color: "var(--primary-color)",
            }}
          >
            <Sparkles size={32} />
          </div>
          <h2 style={{ fontSize: "1.5rem", marginBottom: "0.5rem" }}>No Interviews Yet</h2>
          <p style={{ marginBottom: "2rem", color: "var(--text-muted)" }}>
            You haven't practiced any mock interviews yet. Start your first session to receive AI feedback and detailed insights.
          </p>
          <button className="btn btn-primary" onClick={() => navigate("/new-interview")}>
            Start an Interview
            <ArrowRight size={18} />
          </button>
        </div>
      )}

      {!loading && !error && sessions.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          {sessions.map((session) => {
            const endedEarly = isEndedEarly(session);
            const roleName =
              typeof session.role === "string"
                ? ROLES.find((r) => r.id === session.role)?.label || session.role
                : session.role?.name || (session.role as any)?.label || "General Interview";

            return (
              <div
                key={session.id}
                data-testid={`history-session-${session.id}`}
                className="card card-hover"
                style={{
                  padding: "1.5rem",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  flexWrap: "wrap",
                  gap: "1rem",
                }}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
                    <h3 style={{ margin: 0, fontSize: "1.2rem" }}>{roleName}</h3>
                    {endedEarly && (
                      <span
                        data-testid="history-ended-early"
                        style={{
                          backgroundColor: "var(--warning-bg, #fef3c7)",
                          color: "var(--warning-text, #92400e)",
                          border: "1px solid rgba(245, 158, 11, 0.3)",
                          borderRadius: "9999px",
                          padding: "0.15rem 0.55rem",
                          fontSize: "0.75rem",
                          fontWeight: 600,
                        }}
                      >
                        Ended early
                      </span>
                    )}
                  </div>

                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "1rem",
                      fontSize: "0.875rem",
                      color: "var(--text-muted)",
                      flexWrap: "wrap",
                    }}
                  >
                    <span style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
                      <Calendar size={15} />
                      {formatDate(session.createdAt)}
                    </span>
                    <span>•</span>
                    <span>Session: {session.status}</span>
                    <span>•</span>
                    <span style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
                      Feedback: {renderFeedbackStatus(session.feedbackStatus)}
                    </span>
                  </div>
                </div>

                <div>
                  <Link
                    to={`/interview/${session.id}/feedback`}
                    className="btn btn-outline"
                    style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem" }}
                  >
                    View Results
                    <ArrowRight size={16} />
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
