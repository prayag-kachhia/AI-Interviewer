import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { ArrowRight, AlertCircle, Loader2, Sparkles } from "lucide-react";
import { ROLES } from "@interview/contracts";
import { getSessions, deleteSession } from "../../lib/api";
import type { SessionData } from "../../types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
PerformanceGraph,
  type PerformancePoint,
} from "./PerformanceGraph";
import {
  CategoryTrendsSection,
  CATEGORY_TREND_WINDOW_SIZE,
  TREND_DELTA_THRESHOLD,
  type CategoryTrendItem,
} from "./CategoryTrendsSection";
import { HistorySessionCard } from "./HistorySessionCard";

export { CATEGORY_TREND_WINDOW_SIZE, TREND_DELTA_THRESHOLD, type CategoryTrendItem };

export const HistoryPage: React.FC = () => {
  const [sessions, setSessions] = useState<SessionData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sessionToDelete, setSessionToDelete] = useState<SessionData | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const navigate = useNavigate();

  const handleDeleteClick = (e: React.MouseEvent, session: SessionData) => {
    e.preventDefault();
    e.stopPropagation();
    setDeleteError(null);
    setSessionToDelete(session);
  };

  const handleCancelDelete = () => {
    if (deleting) return;
    setSessionToDelete(null);
    setDeleteError(null);
  };

  const handleConfirmDelete = async () => {
    if (!sessionToDelete || deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await deleteSession(sessionToDelete.id);
      if (res && res.success === false) {
        throw new Error(res.message || "Failed to delete the interview");
      }
      setSessions((prev) => prev.filter((s) => s.id !== sessionToDelete.id));
      setSessionToDelete(null);
    } catch {
      setDeleteError("Failed to delete the interview. Please try again.");
    } finally {
      setDeleting(false);
    }
  };

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

  const selectedRoleName = sessionToDelete
    ? (ROLES.find((r) => r.id === sessionToDelete.role)?.label ?? sessionToDelete.role)
    : "";
  const selectedDateFormatted = sessionToDelete ? formatDate(sessionToDelete.startedAt) : "";

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

  // Performance graph data: chronological order (oldest to newest), only valid finite 1-5 scores
    const chartData = useMemo((): PerformancePoint[] => {
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

    // Eligible sessions for category trends: ready feedback with at least one valid category score
    const eligibleSessions = useMemo(() => {
      return sessions
        .filter((s) => {
          return (
            s.feedbackStatus === "ready" &&
            Array.isArray(s.categoryScores) &&
            s.categoryScores.some(
              (cs) =>
                typeof cs?.category === "string" &&
                cs.category.trim().length > 0 &&
                typeof cs?.score === "number" &&
                Number.isFinite(cs.score) &&
                cs.score >= 1 &&
                cs.score <= 5
            )
          );
        })
        .sort((a, b) => {
          const timeA = new Date(a.startedAt).getTime();
          const timeB = new Date(b.startedAt).getTime();
          if (timeA !== timeB) return timeA - timeB;
          return a.id.localeCompare(b.id);
        });
    }, [sessions]);

    // Category-wise trends calculation across the latest eligible interviews (fixed window)
    const categoryTrends = useMemo((): CategoryTrendItem[] => {
      if (eligibleSessions.length < 3) {
        return [];
      }

      const windowSessions = eligibleSessions.slice(-CATEGORY_TREND_WINDOW_SIZE);

      const categoryMap = new Map<
        string,
        {
          role: string;
          roleLabel: string;
          category: string;
          scores: number[];
        }
      >();

      for (const session of windowSessions) {
        if (!Array.isArray(session.categoryScores)) continue;

        const roleLabel = ROLES.find((r) => r.id === session.role)?.label ?? session.role;

        // Ensure each category is only counted once per session (averaging if duplicates exist within session)
        const sessionCatScores = new Map<string, number[]>();
        for (const item of session.categoryScores) {
          if (
            typeof item?.category === "string" &&
            item.category.trim().length > 0 &&
            typeof item?.score === "number" &&
            Number.isFinite(item.score) &&
            item.score >= 1 &&
            item.score <= 5
          ) {
            const trimmed = item.category.trim();
            const existing = sessionCatScores.get(trimmed) ?? [];
            existing.push(item.score);
            sessionCatScores.set(trimmed, existing);
          }
        }

        for (const [category, scoreList] of sessionCatScores.entries()) {
          const key = `${session.role}:::${category}`;
          if (!categoryMap.has(key)) {
            categoryMap.set(key, {
              role: session.role,
              roleLabel,
              category,
              scores: [],
            });
          }
          const avgSessionScore = scoreList.reduce((a, b) => a + b, 0) / scoreList.length;
          categoryMap.get(key)!.scores.push(avgSessionScore);
        }
      }

      const items: CategoryTrendItem[] = [];

      for (const data of categoryMap.values()) {
        const { role, roleLabel, category, scores } = data;
        const sum = scores.reduce((acc, curr) => acc + curr, 0);
        const averageScore = Math.round((sum / scores.length) * 10) / 10;

        let trend: CategoryTrendItem["trend"] = "insufficient_data";
        let delta: number | null = null;

        if (scores.length >= 2) {
          const half = Math.floor(scores.length / 2);
          const older = scores.slice(0, half);
          const newer = scores.slice(scores.length - half);

          const avgOlder = older.reduce((a, b) => a + b, 0) / older.length;
          const avgNewer = newer.reduce((a, b) => a + b, 0) / newer.length;
          delta = Math.round((avgNewer - avgOlder) * 10) / 10;

          if (delta >= TREND_DELTA_THRESHOLD) {
            trend = "improving";
          } else if (delta <= -TREND_DELTA_THRESHOLD) {
            trend = "declining";
          } else {
            trend = "stable";
          }
        }

        items.push({
          role,
          roleLabel,
          category,
          averageScore,
          sessionCount: scores.length,
          trend,
          delta,
        });
      }

      // Sort categories deterministically: by role label, then category name
      return items.sort((a, b) => {
        const roleCmp = a.roleLabel.localeCompare(b.roleLabel);
        if (roleCmp !== 0) return roleCmp;
        return a.category.localeCompare(b.category);
      });
    }, [eligibleSessions]);

    return (
            <div className="mx-auto max-w-5xl min-h-[calc(100vh-70px)] px-4 sm:px-6 pt-28 pb-20 space-y-8">
              {/* Page Header */}
              <div>
                <h1 className="heading text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
                  Interview History
                </h1>
                  <p className="mt-2 text-base text-muted-foreground sm:text-lg">
                    Review your previous mock interviews, feedback scores, and transcripts.
                  </p>
              </div>

              {loading && (
        <Alert role="status" className="justify-center border-border bg-card">
          <Loader2 className="size-5 motion-safe:animate-spin text-primary" />
          <AlertTitle className="text-base font-medium">Loading interview history…</AlertTitle>
        </Alert>
              )}

              {error && (
        <Alert variant="error">
          <AlertCircle className="size-5" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
              )}

              {deleteError && !sessionToDelete && (
        <Alert variant="error">
          <AlertCircle className="size-5" />
          <AlertDescription>{deleteError}</AlertDescription>
        </Alert>
              )}

              {!loading && !error && sessions.length === 0 && (
        <Card className="mx-auto max-w-xl text-center py-12 px-6">
          <CardContent className="flex flex-col items-center">
            <div className="mb-6 flex size-16 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Sparkles className="size-8" aria-hidden="true" />
            </div>
            <CardTitle className="mb-2 text-2xl font-semibold">No Interviews Yet</CardTitle>
            <CardDescription className="mb-8 max-w-md text-base text-muted-foreground">
              You haven't practiced any mock interviews yet. Start your first session to receive AI feedback and detailed insights.
            </CardDescription>
            <Button onClick={() => navigate("/new-interview")}>
              Start an Interview
              <ArrowRight className="size-4" aria-hidden="true" />
            </Button>
          </CardContent>
        </Card>
              )}

              {!loading && !error && sessions.length > 0 && (
                <>
                  {/* Performance Graph Section (RH-5) */}
                      <PerformanceGraph
                        chartData={chartData}
                        onSelectSession={(sessionId) => navigate(`/interview/${sessionId}/feedback`)}
                      />

                  {/* Category-wise Trends Section (RH-6) */}
                      <CategoryTrendsSection
                        eligibleSessionsCount={eligibleSessions.length}
                        categoryTrends={categoryTrends}
                      />

                  {/* Past Interview Cards */}
                  <div className="flex flex-col gap-4">
                    {sessions.map((session) => (
                      <HistorySessionCard
                        key={session.id}
                        session={session}
                        onDeleteClick={handleDeleteClick}
                        deleting={deleting}
                        formatDate={formatDate}
                      />
                    ))}
                  </div>
                </>
              )}

                  {/* Delete Confirmation AlertDialog */}
                  <AlertDialog
                    open={sessionToDelete !== null}
                    onOpenChange={(open) => {
                      if (!open && !deleting) {
                        handleCancelDelete();
                      }
                    }}
                  >
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete Interview?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Are you sure you want to delete this {selectedRoleName} interview from {selectedDateFormatted}? This action is permanent and cannot be undone. Its recording, transcript, and feedback will be permanently deleted.
                        </AlertDialogDescription>
                      </AlertDialogHeader>

                      {deleteError && (
                        <Alert variant="error" className="mb-2">
                          <AlertCircle className="size-4" />
                          <AlertDescription>{deleteError}</AlertDescription>
                        </Alert>
                      )}

                <AlertDialogFooter>
                  <AlertDialogCancel
                    disabled={deleting}
                    onClick={handleCancelDelete}
                  >
                    Cancel
                  </AlertDialogCancel>
                  <AlertDialogAction
                    disabled={deleting}
                    loading={deleting}
                    onClick={(e) => {
                      e.preventDefault();
                      handleConfirmDelete();
                    }}
                  >
                    {deleting ? "Deleting…" : "Delete interview"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
        </div>
        );
};
