// ResultsScreen.tsx
import { useMemo, useState } from "react";
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
import { deleteSession, retryFeedback } from "../../lib/api";
import { useFeedback, useTurns } from "./useFeedback";
import type { TurnSpeaker } from "@interview/contracts";
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
                <h1 className="font-display text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
                  Your Feedback
                </h1>
                <p className="text-sm text-muted-foreground">
                  Detailed performance review and competency evaluation
                </p>
              </div>

              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <Card className="flex flex-col justify-between">
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
                            <RadarChart data={radarData}>
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
                                name="Score"
                                dataKey="score"
                                stroke="var(--primary)"
                                fill="var(--primary)"
                                fillOpacity={0.35}
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
                  <h2 className="font-display text-xl font-semibold tracking-tight text-foreground">
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
