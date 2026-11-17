// ResultsScreen.tsx
import { useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router";
import {
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
} from "recharts";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { cn } from "@/lib/utils";
import {
  deleteSession,
  getSession,
  retryFeedback,
  updateSessionKeep,
} from "../../lib/api";
import { useFeedback, useTurns } from "./useFeedback";
import { PerAnswerFeedbackSection } from "./PerAnswerFeedbackSection";
import {
  calculateSummaryStats,
  downloadMarkdownFile,
  generateMarkdownFilename,
  generateMarkdownReport,
} from "./resultsSummary";
import { formatEndReason, type Session, type TurnSpeaker } from "@interview/contracts";
import "./ResultsScreen.css";

const chartConfig = {
  score: {
    label: "Score",
    color: "var(--primary)",
  },
} satisfies ChartConfig;

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
  const navigate = useNavigate();
  const { feedback, error: feedbackError, isLongWait } = useFeedback(sessionId, reloadKey);
  const { turns, isLoading, error } = useTurns(sessionId);
  const [keep, setKeep] = useState(false);
  const [keepLoading, setKeepLoading] = useState(true);
  const [keepError, setKeepError] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadSession() {
      setSessionLoading(true);
      try {
        const response = await getSession(sessionId!);

        if (!cancelled) {
          if (response.data) {
            setSession(response.data as Session);
            setKeep(response.data.keep ?? false);
          }
        }
      } catch {
        if (!cancelled) {
          setKeepError("Unable to load interview protection status.");
        }
      } finally {
        if (!cancelled) {
          setKeepLoading(false);
          setSessionLoading(false);
        }
      }
    }

    if (sessionId) {
      loadSession();
    }

    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const stats = useMemo(() => {
    return calculateSummaryStats(isLoading ? null : turns, sessionLoading ? null : session);
  }, [isLoading, turns, sessionLoading, session]);

  const radarData = useMemo(() => {
    if (!feedback?.scores || feedback.scores.length === 0) return [];
    return feedback.scores.map((s) => ({
      category: s.category,
      score: Math.min(5, Math.max(1, s.score)),
      fullMark: 5,
    }));
  }, [feedback?.scores]);

  const averageScore = useMemo(() => {
    if (!feedback?.scores || feedback.scores.length === 0) return null;
    const sum = feedback.scores.reduce((acc, curr) => acc + curr.score, 0);
    return (sum / feedback.scores.length).toFixed(1);
  }, [feedback?.scores]);

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

  const handleToggleKeep = async () => {
    const nextKeep = !keep;

    setKeepLoading(true);
    setKeepError(null);

    try {
      const response = await updateSessionKeep(sessionId, nextKeep);

      if (response.success) {
        setKeep(response.data?.keep ?? nextKeep);
      } else {
        throw new Error(response.message || "Unable to update protection status.");
      }
    } catch {
      setKeepError("Couldn't update interview protection. Please try again.");
    } finally {
      setKeepLoading(false);
    }
  };

  const handleDownloadMarkdown = () => {
    setIsDownloading(true);
    setDownloadError(null);
    try {
      const reportSession: Session = session ?? {
        id: sessionId!,
        userId: "",
        role: "interview",
        status: "ENDED",
        startedAt: "",
        endedAt: null,
      };
      const content = generateMarkdownReport({
        session: reportSession,
        feedback,
        turns,
        stats,
      });
      const filename = generateMarkdownFilename(reportSession);
      downloadMarkdownFile(content, filename);
    } catch {
      setDownloadError("Unable to download interview report. Please try again.");
    } finally {
      setIsDownloading(false);
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
        <div className="container page-wrapper mx-auto max-w-5xl space-y-6 px-4 py-8">
          {(!feedback || feedback.status === "pending") && (
            <Alert role="status" className="border-border bg-card">
              <AlertTitle className="text-base font-semibold">Preparing Feedback</AlertTitle>
              <AlertDescription className="mt-1 space-y-1">
                <p>Preparing your feedback… this can take a moment.</p>
                {isLongWait && <p className="font-medium text-warning">This is taking longer than usual.</p>}
                {feedbackError && <p className="font-medium text-destructive">{feedbackError}</p>}
              </AlertDescription>
            </Alert>
      )}

          {keepError && (
            <Alert variant="error" role="alert">
              <AlertDescription>{keepError}</AlertDescription>
            </Alert>
          )}

          {downloadError && (
            <Alert variant="error" role="alert">
              <AlertDescription>{downloadError}</AlertDescription>
            </Alert>
          )}

          <div className="flex flex-wrap items-center justify-between gap-4">
            <p className="text-sm text-muted-foreground">
              Kept interviews are protected from automatic 30-day cleanup.
            </p>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={handleDownloadMarkdown}
                disabled={sessionLoading || isLoading || isDownloading}
                loading={isDownloading}
              >
                Download Markdown
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={handleToggleKeep}
                loading={keepLoading}
                aria-pressed={keep}
              >
                {keepLoading
                  ? "Updating…"
                  : keep
                    ? "Unkeep interview"
                    : "Keep interview"}
              </Button>
            </div>
          </div>

          {/* Summary Statistics Section (RH-8) */}
          <section aria-label="Interview Summary Statistics">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3" data-testid="summary-stats-section">
              <Card data-testid="stat-questions-asked">
                <CardHeader className="pb-2">
                  <CardDescription className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Questions Asked
                  </CardDescription>
                  <CardTitle className="font-mono text-2xl font-bold text-foreground">
                    {isLoading ? (
                      <span className="text-muted-foreground" aria-busy="true">Loading…</span>
                    ) : stats.questionsAsked !== null ? (
                      stats.questionsAsked
                    ) : (
                      <span className="text-muted-foreground">Unavailable</span>
                    )}
                  </CardTitle>
                </CardHeader>
              </Card>

              <Card data-testid="stat-answers-given">
                <CardHeader className="pb-2">
                  <CardDescription className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Answers Given
                  </CardDescription>
                  <CardTitle className="font-mono text-2xl font-bold text-foreground">
                    {isLoading ? (
                      <span className="text-muted-foreground" aria-busy="true">Loading…</span>
                    ) : stats.answersGiven !== null ? (
                      stats.answersGiven
                    ) : (
                      <span className="text-muted-foreground">Unavailable</span>
                    )}
                  </CardTitle>
                </CardHeader>
              </Card>

              <Card data-testid="stat-duration">
                <CardHeader className="pb-2">
                  <CardDescription className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Duration
                  </CardDescription>
                  <CardTitle className="font-mono text-2xl font-bold text-foreground">
                    {sessionLoading ? (
                      <span className="text-muted-foreground" aria-busy="true">Loading…</span>
                    ) : stats.durationSeconds !== null ? (
                      stats.formattedDuration
                    ) : (
                      <span className="text-muted-foreground">Unavailable</span>
                    )}
                  </CardTitle>
                </CardHeader>
              </Card>
            </div>
          </section>

          {feedback?.status === "failed" && (
            <Alert variant="error" role="alert">
              <AlertTitle className="text-base font-semibold">Feedback Unavailable</AlertTitle>
              <AlertDescription className="mt-1 space-y-3">
                <p>We couldn't generate feedback for this session.</p>
                {retryError && <p className="text-destructive">{retryError}</p>}
                <div>
                  <Button type="button" onClick={handleRetry} loading={retrying}>
                    {retrying ? "Retrying…" : "Try again"}
                  </Button>
                </div>
              </AlertDescription>
            </Alert>
          )}

          {feedback?.status === "ready" && (
            <div className="space-y-6">
              <div className="flex flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2.5">
                  <h1 className="heading text-2xl text-foreground sm:text-3xl">
                    Your Feedback
                  </h1>
                  {(session?.endedEarly || session?.endReason) && (
                    <Badge data-testid="results-ended-early" variant="pending" className="text-xs">
                      Ended early{session.endReason ? ` (${formatEndReason(session.endReason)})` : ""}
                    </Badge>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">
                  Detailed performance review and competency evaluation
                </p>
              </div>

              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle>Overall Summary</CardTitle>
                    {averageScore && (
                      <CardDescription>
                        Average score:{" "}
                        <span className="font-mono font-medium text-foreground">
                          {averageScore}/5
                        </span>
                      </CardDescription>
                    )}
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <p className="text-sm leading-relaxed text-foreground sm:text-base">
                      {feedback.summary}
                    </p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Rubric Evaluation</CardTitle>
                    <CardDescription>Radar overview of assessed rubric categories</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {radarData.length === 0 ? (
                      <div className="flex h-56 flex-col items-center justify-center text-center">
                        <p className="text-sm text-muted-foreground">
                          No rubric scores available for this session.
                        </p>
                      </div>
                    ) : (
                      <>
                        <div
                          role="img"
                          aria-label="Radar chart showing rubric scores on a 1 to 5 scale"
                          className="mx-auto w-full max-w-[340px]"
                        >
                          <ChartContainer
                            config={chartConfig}
                            className="aspect-square max-h-[280px] w-full"
                          >
                            <RadarChart data={radarData} outerRadius="46%">
                              <PolarGrid stroke="var(--border)" className="stroke-border" />
                              <PolarAngleAxis
                                dataKey="category"
                                tick={{ fill: "var(--foreground)", fontSize: 11 }}
                              />
                              <PolarRadiusAxis
                                angle={30}
                                domain={[0, 5]}
                                ticks={[1, 2, 3, 4, 5]}
                                stroke="var(--border)"
                                tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
                              />
                              <ChartTooltip
                                cursor={false}
                                content={<ChartTooltipContent hideLabel indicator="line" />}
                              />
                              <Radar
                                {...({
                                  name: "Score",
                                  dataKey: "score",
                                  stroke: "var(--primary)",
                                  fill: "var(--primary)",
                                  fillOpacity: 0.35,
                                } as any)}
                              />
                            </RadarChart>
                          </ChartContainer>
                        </div>

                        <div className="sr-only">
                          <h4>Rubric Scores</h4>
                          <table>
                            <caption>Rubric scores breakdown normalized to 5</caption>
                            <thead>
                              <tr>
                                <th scope="col">Category</th>
                                <th scope="col">Score</th>
                                <th scope="col">Max Score</th>
                              </tr>
                            </thead>
                            <tbody>
                              {feedback.scores?.map((s) => (
                                <tr key={s.category}>
                                  <td>{s.category}</td>
                                  <td>{s.score}</td>
                                  <td>5</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </>
                    )}
                  </CardContent>
                </Card>
              </div>

              {feedback.scores && feedback.scores.length > 0 && (
                <div className="space-y-4">
                  <h2 className="heading text-xl text-foreground">
                    Category Details
                  </h2>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    {feedback.scores.map((s, index) => (
                      <Card
                        key={s.category}
                        data-reveal-index={index}
                        className="category-card-reveal motion-reduce:animate-none flex flex-col justify-between"
                      >
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                          <CardTitle className="text-base font-semibold">
                            <strong>{s.category}:</strong>
                          </CardTitle>
                          <Badge
                            variant={s.score >= 4 ? "default" : "secondary"}
                            className="font-mono text-xs"
                          >
                            Score: {s.score}/5
                          </Badge>
                        </CardHeader>
                        <CardContent className="space-y-3.5">
                          <p className="text-sm leading-relaxed text-muted-foreground">{s.comment}</p>

                          {s.strengths && s.strengths.length > 0 && (
                            <div className="space-y-1">
                              <h3 className="text-xs font-semibold uppercase tracking-wider text-success">
                                Strengths
                              </h3>
                              <ul className="list-disc list-inside space-y-0.5 text-sm text-foreground">
                                {s.strengths.map((str, idx) => (
                                  <li key={idx}>{str}</li>
                                ))}
                              </ul>
                            </div>
                          )}

                          {s.improvements && s.improvements.length > 0 && (
                            <div className="space-y-1">
                              <h3 className="text-xs font-semibold uppercase tracking-wider text-warning">
                                To improve
                              </h3>
                              <ul className="list-disc list-inside space-y-0.5 text-sm text-foreground">
                                {s.improvements.map((imp, idx) => (
                                  <li key={idx}>{imp}</li>
                                ))}
                              </ul>
                            </div>
                          )}

                          {s.quote && (
                            <blockquote className="rounded-r border-l-2 border-primary bg-muted/30 px-3 py-2 text-sm italic text-foreground">
                              “{s.quote}”
                            </blockquote>
                          )}
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <details
            open
            className="transcript-section rounded-xl border border-border bg-card p-6 text-card-foreground shadow-xs"
          >
            <summary className="cursor-pointer text-lg font-semibold text-foreground select-none">
              Transcript
            </summary>
            <div className="mt-4">
              {isLoading ? (
                <p className="loading-state text-sm text-muted-foreground">Loading transcript…</p>
              ) : error ? (
                <p className="error-state text-sm text-destructive" role="alert">
                  {error}
                </p>
              ) : turns.length === 0 ? (
                <p className="empty-state text-sm text-muted-foreground">No transcript turns recorded.</p>
              ) : (
                <ol className="m-0 flex list-none flex-col gap-3 p-0">
                  {turns.map((turn) => (
                    <li
                      key={turn.id || `${turn.turnIndex}-${turn.timestampSec}`}
                      data-testid={`transcript-turn-${turn.turnIndex}`}
                      className={cn(
                        "rounded-lg border p-3.5 transition-colors",
                        turn.speaker === "AI"
                          ? "border-primary/20 bg-primary/5 dark:bg-primary/10"
                          : "border-border bg-secondary/30 dark:bg-secondary/20"
                      )}
                    >
                      <div className="mb-1 flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                        <span>{formatSpeaker(turn.speaker)}</span>
                        <span aria-hidden="true">•</span>
                        <span>{formatElapsedTime(turn.timestampSec)}</span>
                      </div>
                      <div className="text-sm leading-relaxed text-foreground">{turn.text}</div>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </details>

          <PerAnswerFeedbackSection perAnswer={feedback?.perAnswer} />

          <div className="flex flex-col gap-2 pt-2">
            {deleteError && (
              <Alert variant="error" role="alert">
                <AlertDescription>{deleteError}</AlertDescription>
              </Alert>
            )}
            <div>
              <Button
                type="button"
                variant="outline"
                onClick={handleDelete}
                loading={deleting}
              >
                {deleting ? "Deleting…" : "Delete interview"}
              </Button>
            </div>
          </div>
        </div>
      );
}
