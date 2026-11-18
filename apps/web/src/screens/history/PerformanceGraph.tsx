import React from "react";
import { Link } from "react-router";
import { TrendingUp } from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";
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

export interface PerformancePoint {
  sessionId: string;
  score: number;
  roleLabel: string;
  displayDate: string;
  fullDate: string;
  index: number;
}

const chartConfig = {
  score: {
    label: "Overall Score",
    color: "var(--primary)",
  },
} satisfies ChartConfig;

interface PerformanceGraphProps {
  chartData: PerformancePoint[];
  onSelectSession: (sessionId: string) => void;
}

export const PerformanceGraph: React.FC<PerformanceGraphProps> = ({
  chartData,
  onSelectSession,
}) => {
  if (chartData.length === 0) {
    return (
      <Card data-testid="performance-graph-empty">
        <CardContent className="flex flex-col items-center justify-center gap-2 py-8 text-center">
          <div className="flex items-center justify-center gap-2 text-muted-foreground">
            <TrendingUp className="size-5" aria-hidden="true" />
            <h2 className="heading text-xl font-semibold text-foreground">Performance Trend</h2>
          </div>
          <CardDescription className="max-w-md text-sm">
            No scored interviews available yet. Completed interviews with feedback scores will be plotted here.
          </CardDescription>
        </CardContent>
      </Card>
    );
  }

  const latestScore = chartData[chartData.length - 1].score;

  return (
    <Card data-testid="performance-graph-container">
      <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <TrendingUp className="size-5 text-primary" aria-hidden="true" />
            <CardTitle id="performance-trend-heading" className="text-xl">Performance Trend</CardTitle>
          </div>
          <CardDescription id="performance-trend-description" className="mt-1 text-sm">
            Overall score progression over time (1–5 scale). Click any point to view results.
          </CardDescription>
        </div>
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <span>
            Interviews:{" "}
            <strong data-testid="performance-count" className="font-semibold text-foreground">
              {chartData.length}
            </strong>
          </span>
          <span>
            Latest:{" "}
            <strong data-testid="performance-latest-score" className="font-semibold text-primary">
              {latestScore.toFixed(1)} / 5
            </strong>
          </span>
        </div>
      </CardHeader>

      <CardContent>
        <div
          // A group, not an image: its points are clickable, and an image can't contain controls.
          role="group"
          aria-labelledby="performance-trend-heading"
          aria-describedby="performance-trend-description"
          className="h-[280px] w-full"
        >
          <ChartContainer config={chartConfig} className="h-[280px] w-full">
            <LineChart
              data={chartData}
              margin={{ top: 15, right: 25, left: -15, bottom: 5 }}
              onClick={(state: any) => {
                const sessionId = state?.activePayload?.[0]?.payload?.sessionId;
                if (sessionId) {
                  onSelectSession(sessionId);
                }
              }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis
                dataKey="sessionId"
                tickFormatter={(id: string | number) => {
                  const sessionId = String(id);
                  return chartData.find((d) => d.sessionId === sessionId)?.displayDate ?? sessionId;
                }}
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
                      <div className="flex flex-col gap-1">
                        <div className="font-semibold text-foreground">
                          {item.payload?.roleLabel}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {item.payload?.fullDate}
                        </div>
                        <div className="mt-1 flex items-baseline gap-1">
                          <span className="font-mono text-sm font-bold text-primary">
                            {Number(value).toFixed(1)}
                          </span>
                          <span className="text-xs text-muted-foreground">/ 5.0</span>
                        </div>
                        <div className="mt-0.5 text-[0.7rem] text-muted-foreground">
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
                  className: "cursor-pointer",
                  onClick: (_e: any, payload: any) => {
                    const sessionId = payload?.payload?.sessionId;
                    if (sessionId) {
                      onSelectSession(sessionId);
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
                      stroke="var(--card)"
                      strokeWidth={2}
                      className="cursor-pointer focus:outline-none"
                      data-testid={`performance-dot-${payload.sessionId}`}
                      role="button"
                      tabIndex={0}
                      aria-label={`Interview on ${payload.fullDate} for ${payload.roleLabel}, score ${payload.score} out of 5. Click to view results.`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectSession(payload.sessionId);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onSelectSession(payload.sessionId);
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
                    <Link to={`/interview/${d.sessionId}/feedback`} tabIndex={-1}>
                      View feedback for {d.roleLabel} on {d.fullDate}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
};
