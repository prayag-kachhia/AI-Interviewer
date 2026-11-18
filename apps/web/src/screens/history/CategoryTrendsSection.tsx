import React from "react";
import { Layers, TrendingUp, TrendingDown, Minus, HelpCircle } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const CATEGORY_TREND_WINDOW_SIZE = 10;
export const TREND_DELTA_THRESHOLD = 0.3;

export interface CategoryTrendItem {
  role: string;
  roleLabel: string;
  category: string;
  averageScore: number;
  sessionCount: number;
  trend: "improving" | "declining" | "stable" | "insufficient_data";
  delta: number | null;
}

export const slugify = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

interface CategoryTrendsSectionProps {
  eligibleSessionsCount: number;
  categoryTrends: CategoryTrendItem[];
}

export const renderTrendBadge = (trend: CategoryTrendItem["trend"], slug: string) => {
  switch (trend) {
    case "improving":
      return (
        <span
          data-testid={`trend-badge-improving-${slug}`}
          aria-label="Trend: Improving"
          className="inline-flex items-center gap-1 rounded-full border border-success/30 bg-success/10 px-2.5 py-0.5 text-xs font-semibold text-success"
        >
          <TrendingUp className="size-3.5" aria-hidden="true" />
          <span>Improving</span>
        </span>
      );
    case "declining":
      return (
        <span
          data-testid={`trend-badge-declining-${slug}`}
          aria-label="Trend: Declining"
          className="inline-flex items-center gap-1 rounded-full border border-destructive/30 bg-destructive/10 px-2.5 py-0.5 text-xs font-semibold text-destructive"
        >
          <TrendingDown className="size-3.5" aria-hidden="true" />
          <span>Declining</span>
        </span>
      );
    case "stable":
      return (
        <span
          data-testid={`trend-badge-stable-${slug}`}
          aria-label="Trend: Stable"
          className="inline-flex items-center gap-1 rounded-full border border-border bg-secondary px-2.5 py-0.5 text-xs font-semibold text-muted-foreground"
        >
          <Minus className="size-3.5" aria-hidden="true" />
          <span>Stable</span>
        </span>
      );
    case "insufficient_data":
    default:
      return (
        <span
          data-testid={`trend-badge-insufficient-${slug}`}
          aria-label="Trend: Insufficient data"
          className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/50 px-2.5 py-0.5 text-xs font-medium text-muted-foreground"
        >
          <HelpCircle className="size-3.5" aria-hidden="true" />
          <span>Insufficient data</span>
        </span>
      );
  }
};

export const CategoryTrendsSection: React.FC<CategoryTrendsSectionProps> = ({
  eligibleSessionsCount,
  categoryTrends,
}) => {
  if (eligibleSessionsCount < 3) {
    return (
      <Card data-testid="category-trends-insufficient">
        <CardContent className="flex flex-col items-center justify-center gap-2 py-8 text-center">
          <div className="flex items-center justify-center gap-2 text-muted-foreground">
            <Layers className="size-5" aria-hidden="true" />
            <h2 className="heading text-xl font-semibold text-foreground">Category-wise Trends</h2>
          </div>
          <CardDescription className="max-w-md text-sm">
            At least 3 scored interviews are required to calculate category trends (you have {eligibleSessionsCount}).
            Complete more mock interviews to see your rubric category breakdown and skill trajectories over time.
          </CardDescription>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card data-testid="category-trends-container">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Layers className="size-5 text-primary" aria-hidden="true" />
          <CardTitle className="text-xl">Category-wise Trends</CardTitle>
        </div>
        <CardDescription className="mt-1 text-sm">
          Average scores and trajectories across your recent interviews (latest{" "}
          {Math.min(eligibleSessionsCount, CATEGORY_TREND_WINDOW_SIZE)} eligible sessions).
          Trends compare the newer half of interviews against the older half (improving: &ge; +0.3, declining: &le; -0.3, stable: within &plusmn;0.2).
        </CardDescription>
      </CardHeader>

      <CardContent>
        {categoryTrends.length > 0 ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {categoryTrends.map((cat) => {
              const slug = slugify(cat.category);
              return (
                <div
                  key={`${cat.role}:::${cat.category}`}
                  data-testid={`category-trend-card-${slug}`}
                  className="flex flex-col justify-between gap-3 rounded-xl border border-border bg-card p-5 [box-shadow:var(--shadow-card)]"
                >
                  <div>
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <Badge variant="secondary" className="font-semibold">
                        {cat.roleLabel}
                      </Badge>
                      {renderTrendBadge(cat.trend, slug)}
                    </div>
                    <h3 className="heading text-base font-semibold text-foreground">
                      {cat.category}
                    </h3>
                  </div>

                  <div className="flex items-baseline justify-between border-t border-border pt-3">
                    <div className="text-xs text-muted-foreground">
                      <span>Average: </span>
                      <strong
                        data-testid={`category-avg-${slug}`}
                        className="font-mono text-base font-bold text-foreground"
                      >
                        {cat.averageScore.toFixed(1)}
                      </strong>
                      <span> / 5.0</span>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {cat.sessionCount} {cat.sessionCount === 1 ? "interview" : "interviews"}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No rubric category data recorded for these sessions.
          </p>
        )}
      </CardContent>
    </Card>
  );
};
