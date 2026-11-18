import React from "react";
import { Link } from "react-router";
import { Calendar, ArrowRight, Trash2 } from "lucide-react";
import { ROLES, formatEndReason } from "@interview/contracts";
import type { SessionData } from "../../types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

interface HistorySessionCardProps {
  session: SessionData;
  onDeleteClick: (e: React.MouseEvent, session: SessionData) => void;
  deleting: boolean;
  formatDate: (dateString: string) => string;
}

export const renderFeedbackStatus = (status: SessionData["feedbackStatus"]) => {
  switch (status) {
    case "ready":
      return <Badge variant="success">Ready</Badge>;
    case "failed":
      return <Badge variant="error">Failed</Badge>;
    case "pending":
    default:
      return <Badge variant="pending">Pending</Badge>;
  }
};

export const HistorySessionCard: React.FC<HistorySessionCardProps> = ({
  session,
  onDeleteClick,
  deleting,
  formatDate,
}) => {
  const roleName = ROLES.find((r) => r.id === session.role)?.label ?? session.role;

  return (
    <Card
      data-testid={`history-session-${session.id}`}
      className="transition-colors hover:border-primary/50"
    >
      <CardContent className="flex flex-wrap items-center justify-between gap-4 p-6">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <h3 className="heading text-lg font-semibold text-foreground">{roleName}</h3>
            {session.endedEarly && (
              <Badge
                variant="outline"
                data-testid="history-ended-early"
                className="border-warning/40 bg-warning/10 text-warning"
              >
                Ended early{session.endReason ? ` (${formatEndReason(session.endReason)})` : ""}
              </Badge>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <Calendar className="size-4" aria-hidden="true" />
              {formatDate(session.startedAt)}
            </span>
            <span aria-hidden="true">•</span>
            <span>Session: {session.status}</span>
            <span aria-hidden="true">•</span>
            <span className="flex items-center gap-1.5">
              Feedback: {renderFeedbackStatus(session.feedbackStatus)}
            </span>
            {session.overallScore !== undefined && session.overallScore !== null && (
              <>
                <span aria-hidden="true">•</span>
                <span data-testid="history-overall-score" className="font-semibold text-foreground">
                  Score: {session.overallScore}/5
                </span>
              </>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button asChild variant="outline">
            <Link to={`/interview/${session.id}/feedback`}>
              View Results
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          </Button>
          <Button
            type="button"
            variant="outline"
            className="border-border text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={(e) => onDeleteClick(e, session)}
            disabled={deleting}
            title={`Delete interview for ${roleName} on ${formatDate(session.startedAt)}`}
            data-testid={`history-delete-${session.id}`}
          >
            <Trash2 className="size-4" aria-hidden="true" />
            Delete
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};
