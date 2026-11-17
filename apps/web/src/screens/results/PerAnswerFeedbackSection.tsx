import { useState } from "react";
import type { PerAnswerFeedback } from "@interview/contracts";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { cn } from "../../lib/utils";

export interface PerAnswerFeedbackSectionProps {
  perAnswer?: PerAnswerFeedback[];
  className?: string;
}

export function PerAnswerFeedbackSection({
  perAnswer,
  className,
}: PerAnswerFeedbackSectionProps) {
  const [expandedIndices, setExpandedIndices] = useState<Set<number>>(
    () => new Set<number>()
  );

  const hasItems = perAnswer && perAnswer.length > 0;
  const allExpanded = Boolean(
    hasItems && perAnswer.every((_, idx) => expandedIndices.has(idx))
  );

  const toggleAll = () => {
    if (!hasItems) return;
    if (allExpanded) {
      setExpandedIndices(new Set());
    } else {
      setExpandedIndices(new Set(perAnswer.map((_, i) => i)));
    }
  };

  const toggleIndex = (index: number) => {
    setExpandedIndices((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  // If perAnswer is undefined or empty, render nothing to maintain backward compatibility (PN-9, FR-21, FR-26)
  if (!hasItems) {
    return null;
  }

  return (
    <section
      data-testid="per-answer-feedback-section"
      aria-labelledby="per-answer-feedback-heading"
      className={cn("per-answer-section space-y-4 pt-2", className)}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2
            id="per-answer-feedback-heading"
            className="text-lg font-semibold tracking-tight text-foreground"
          >
            Feedback by Answer
          </h2>
          <p className="text-sm text-muted-foreground">
            Detailed breakdown of strengths and specific areas to improve for each answer.
          </p>
        </div>
        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={toggleAll}
            aria-label={allExpanded ? "Collapse all answers" : "Expand all answers"}
            className="w-full sm:w-auto"
          >
            {allExpanded ? "Collapse all" : "Expand all"}
          </Button>
        </div>
      </div>

      <div className="space-y-3" role="list">
        {perAnswer.map((item, index) => {
          const isExpanded = expandedIndices.has(index);
          const headingId = `per-answer-heading-${index}`;
          const contentId = `per-answer-content-${index}`;

          return (
            <Card
              key={index}
              data-testid={`per-answer-card-${index}`}
              className={cn(
                "overflow-hidden border border-border bg-card text-card-foreground shadow-xs transition-colors py-0 gap-0",
                isExpanded && "ring-1 ring-border"
              )}
            >
              <button
                type="button"
                id={headingId}
                onClick={() => toggleIndex(index)}
                aria-expanded={isExpanded}
                aria-controls={contentId}
                className="flex w-full cursor-pointer items-start justify-between gap-3 p-4 sm:p-5 text-left transition-colors hover:bg-muted/30 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div className="space-y-1.5 flex-1 pr-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="font-semibold text-xs">
                      Answer {index + 1}
                    </Badge>
                  </div>
                  <h3 className="text-sm font-semibold text-foreground leading-snug">
                    {item.question}
                  </h3>
                  <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
                    {item.summary}
                  </p>
                </div>

                <div className="pt-0.5 text-muted-foreground shrink-0">
                  <svg
                    aria-hidden="true"
                    xmlns="http://www.w3.org/2000/svg"
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className={cn(
                      "transition-transform duration-200 motion-reduce:transition-none",
                      isExpanded && "rotate-180"
                    )}
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </div>
              </button>

              {isExpanded && (
                <div
                  id={contentId}
                  role="region"
                  aria-labelledby={headingId}
                  className="border-t border-border/60 bg-muted/15 px-4 sm:px-6 py-4 space-y-4"
                >
                  {item.strengths && item.strengths.length > 0 && (
                    <div className="space-y-1.5">
                      <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-success">
                        <span
                          className="inline-block size-1.5 rounded-full bg-success"
                          aria-hidden="true"
                        />
                        Strengths
                      </h4>
                      <ul className="list-disc list-inside space-y-1 text-sm text-foreground">
                        {item.strengths.map((str, sIdx) => (
                          <li key={sIdx}>{str}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {item.improvements && item.improvements.length > 0 && (
                    <div className="space-y-1.5">
                      <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-warning">
                        <span
                          className="inline-block size-1.5 rounded-full bg-warning"
                          aria-hidden="true"
                        />
                        To improve
                      </h4>
                      <ul className="list-disc list-inside space-y-1 text-sm text-foreground">
                        {item.improvements.map((imp, iIdx) => (
                          <li key={iIdx}>{imp}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </section>
  );
}
