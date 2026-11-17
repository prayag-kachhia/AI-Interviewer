import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import {
  Clock,
  Calendar,
  ArrowRight,
  AlertCircle,
  Loader2,
  Sparkles,
  CheckCircle2,
  TrendingUp,
} from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";
import { ROLES } from "@interview/contracts";
import { getSessions } from "../../lib/api";
import type { SessionData } from "../../types";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "../../components/ui/chart";

const chartConfig = {
  score: {
    label: "Overall Score",
    color: "var(--primary)",
  },
} satisfies ChartConfig;

export const HistoryPage: React.FC = () => {
  const [sessions, setSessions] = useState<SessionData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;

    async function loadSessions() {
      try {
        setLoading(true);
        setError(null);
        const res = await getSessions(); // newest first
        if (!cancelled) setSessions(res.data ?? []);
      } catch {
        if (!cancelled) setError("Failed to load interview history");
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

  const formatDate = (dateString: string) => {
    const d = new Date(dateString);
    if (Number.isNaN(d.getTime())) return dateString;
    return d.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const formatShortDate = (dateString: string) => {
    const d = new Date(dateString);
    if (Number.isNaN(d.getTime())) return dateString;
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  };

  // Performance graph data: chronological order (oldest to newest), only valid finite 1-5 scores
  const chartData = useMemo(() => {
    const scoredSessions = sessions.filter(
      (s): s is SessionData & { overallScore: number } =>
        typeof s.overallScore === "number" &&
        Number.isFinite(s.overallScore) &&
        s.overallScore >= 1 &&
        s.overallScore <= 5
    );

    const sorted = [...scoredSessions].sort((a, b) => {
      const timeA = new Date(a.startedAt).getTime();
      const timeB = new Date(b.startedAt).getTime();
      if (timeA !== timeB) return timeA - timeB;
      return a.id.localeCompare(b.id);
    });

    const dateCounts = new Map<string, number>();
    sorted.forEach((s) => {
      const short = formatShortDate(s.startedAt);
      dateCounts.set(short, (dateCounts.get(short) ?? 0) + 1);
    });

    const seenCounts = new Map<string, number>();

    return sorted.map((session, index) => {
      const roleLabel = ROLES.find((r) => r.id === session.role)?.label ?? session.role;
      const shortDate = formatShortDate(session.startedAt);
      const count = (seenCounts.get(shortDate) ?? 0) + 1;
      seenCounts.set(shortDate, count);

      const hasDuplicate = (dateCounts.get(shortDate) ?? 0) > 1;
      const displayDate = hasDuplicate ? `${shortDate} (#${count})` : shortDate;

      return {
        sessionId: session.id,
        score: session.overallScore,
        roleLabel,
        displayDate,
        fullDate: formatDate(session.startedAt),
        index: index + 1,
      };
    });
  }, [sessions]);

  const renderFeedbackStatus = (status: SessionData["feedbackStatus"]) => {
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
        <>
          {/* Performance Graph Section */}
          {chartData.length > 0 ? (
            <div
              className="card"
              data-testid="performance-graph-container"
              style={{
                padding: "1.5rem",
                marginBottom: "2rem",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  flexWrap: "wrap",
                  gap: "0.75rem",
                  marginBottom: "1.25rem",
                }}
              >
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.25rem" }}>
                    <TrendingUp size={20} style={{ color: "var(--primary)" }} />
                    <h2 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 600 }}>Performance Trend</h2>
                  </div>
                  <p style={{ margin: 0, fontSize: "0.875rem", color: "var(--text-muted)" }}>
                    Overall score progression over time (1–5 scale). Click any point to view results.
                  </p>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "1rem", fontSize: "0.875rem" }}>
                  <span style={{ color: "var(--text-muted)" }}>
                    Interviews:{" "}
                    <strong data-testid="performance-count" style={{ color: "var(--foreground)" }}>
                      {chartData.length}
                    </strong>
                  </span>
                  <span style={{ color: "var(--text-muted)" }}>
                    Latest:{" "}
                    <strong data-testid="performance-latest-score" style={{ color: "var(--primary)" }}>
                      {chartData[chartData.length - 1].score.toFixed(1)} / 5
                    </strong>
                  </span>
                </div>
              </div>

              <div
                role="img"
                aria-label="Performance line graph showing overall interview scores over time on a 1 to 5 scale"
                style={{ width: "100%", height: "280px" }}
              >
                <ChartContainer
                  config={chartConfig}
                  className="h-[280px] w-full"
                >
                  <LineChart
                    data={chartData}
                    margin={{ top: 15, right: 25, left: -15, bottom: 5 }}
                    onClick={(state: any) => {
                      const sessionId = state?.activePayload?.[0]?.payload?.sessionId;
                      if (sessionId) {
                        navigate(`/interview/${sessionId}/feedback`);
                      }
                    }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis
                      dataKey="sessionId"
                      tickFormatter={(id) => chartData.find((d) => d.sessionId === id)?.displayDate ?? id}
                      stroke="var(--border)"
                      tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
                      tickLine={{ stroke: "var(--border)" }}
                    />
                    <YAxis
                      domain={[1, 5]}
                      ticks={[1, 2, 3, 4, 5]}
                      stroke="var(--border)"
                      tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
                      tickLine={{ stroke: "var(--border)" }}
                      allowDecimals={false}
                    />
                    <ChartTooltip
                      cursor={{ stroke: "var(--border)", strokeWidth: 1, strokeDasharray: "4 4" }}
                      content={
                        <ChartTooltipContent
                          hideLabel
                          formatter={(value, _name, item) => (
                            <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                              <div style={{ fontWeight: 600, color: "var(--foreground)" }}>
                                {item.payload?.roleLabel}
                              </div>
                              <div style={{ fontSize: "0.75rem", color: "var(--muted-foreground)" }}>
                                {item.payload?.fullDate}
                              </div>
                              <div style={{ display: "flex", alignItems: "baseline", gap: "0.25rem", marginTop: "0.25rem" }}>
                                <span style={{ fontSize: "0.875rem", fontWeight: 700, color: "var(--primary)" }}>
                                  {Number(value).toFixed(1)}
                                </span>
                                <span style={{ fontSize: "0.75rem", color: "var(--muted-foreground)" }}>/ 5.0</span>
                              </div>
                              <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", marginTop: "0.15rem" }}>
                                Click point to view feedback
                              </div>
                            </div>
                          )}
                        />
                      }
                    />
                    <Line
                      type="monotone"
                      dataKey="score"
                      stroke="var(--color-score, var(--primary))"
                      strokeWidth={2.5}
                      isAnimationActive={false}
                      activeDot={{
                        r: 7,
                        style: { cursor: "pointer" },
                        onClick: (_e: any, payload: any) => {
                          const sessionId = payload?.payload?.sessionId;
                          if (sessionId) {
                            navigate(`/interview/${sessionId}/feedback`);
                          }
                        },
                      }}
                      dot={(dotProps: any) => {
                        const { cx, cy, payload } = dotProps;
                        if (cx == null || cy == null) return null;
                        return (
                          <circle
                            key={`dot-${payload.sessionId}`}
                            cx={cx}
                            cy={cy}
                            r={5}
                            fill="var(--color-score, var(--primary))"
                            stroke="var(--card, #fff)"
                            strokeWidth={2}
                            style={{ cursor: "pointer" }}
                            data-testid={`performance-dot-${payload.sessionId}`}
                            role="button"
                            tabIndex={0}
                            aria-label={`Interview on ${payload.fullDate} for ${payload.roleLabel}, score ${payload.score} out of 5. Click to view results.`}
                            onClick={(e) => {
                              e.stopPropagation();
                              navigate(`/interview/${payload.sessionId}/feedback`);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                navigate(`/interview/${payload.sessionId}/feedback`);
                              }
                            }}
                          />
                        );
                      }}
                    />
                  </LineChart>
                </ChartContainer>
              </div>

              {/* Accessible list / table for screen readers and keyboard navigation */}
              <div className="sr-only">
                <h3>Performance History Breakdown</h3>
                <table>
                  <caption>Chronological list of mock interview overall scores</caption>
                  <thead>
                    <tr>
                      <th scope="col">Date</th>
                      <th scope="col">Role</th>
                      <th scope="col">Overall Score</th>
                      <th scope="col">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {chartData.map((d) => (
                      <tr key={`perf-row-${d.sessionId}`}>
                        <td>{d.fullDate}</td>
                        <td>{d.roleLabel}</td>
                        <td>{d.score} / 5</td>
                        <td>
                          <Link to={`/interview/${d.sessionId}/feedback`}>
                            View feedback for {d.roleLabel} on {d.fullDate}
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div
              className="card"
              data-testid="performance-graph-empty"
              style={{
                padding: "1.5rem",
                marginBottom: "2rem",
                textAlign: "center",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem", marginBottom: "0.5rem" }}>
                <TrendingUp size={20} style={{ color: "var(--text-muted)" }} />
                <h2 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 600 }}>Performance Trend</h2>
              </div>
              <p style={{ margin: 0, fontSize: "0.875rem", color: "var(--text-muted)" }}>
                No scored interviews available yet. Completed interviews with feedback scores will be plotted here.
              </p>
            </div>
          )}

          {/* Existing Interview Cards */}
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            {sessions.map((session) => {
              const roleName = ROLES.find((r) => r.id === session.role)?.label ?? session.role;

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
                      {session.endedEarly && (
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
                        {formatDate(session.startedAt)}
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
        </>
      )}
    </div>
  );
};
