// resultsSummary.ts
import type { Feedback, Session, SessionStatus, Turn } from "@interview/contracts";
import { ROLES } from "@interview/contracts";

export interface SummaryStats {
  questionsAsked: number | null;
  answersGiven: number | null;
  durationSeconds: number | null;
  formattedDuration: string;
}

/**
 * Checks whether an AI transcript turn represents an actual interview question,
 * rather than a greeting, instruction, thinking encouragement, or wrap-up statement.
 */
export function isAiQuestion(rawText: string | undefined | null): boolean {
  if (!rawText) return false;
  const text = rawText.trim();
  if (!text) return false;

  // Bracketed internal prompts or thinking cues
  if (/^\[.*\]$/.test(text) || /the candidate is thinking/i.test(text)) {
    return false;
  }

  // Exact standalone greetings, conversational pleasantries, and readiness checks
  if (
    /^(hello|hi|hey|welcome|good (morning|afternoon|evening))[.!]?$/i.test(text) ||
    /^(okay|ok|got it|understood|sure|great|alright|thank you|thanks|noted)[.!]?$/i.test(text) ||
    /^(are you ready( to (begin|start))?\??|shall we (begin|start)\??)$/i.test(text) ||
    /^(how are you( doing)?( today)?\??|how('s| is) it going( today)?\??)$/i.test(text)
  ) {
    return false;
  }

  // Pure encouragement / silence thinking cues without a question
  if (
    /\b(take your time|no rush|feel free to think|let me know when you('re| are) ready)\b/i.test(text) &&
    !text.includes("?") &&
    !/\b(tell me|explain|describe|what|how|why)\b/i.test(text)
  ) {
    return false;
  }

  // Pure wrap-up / closing statements
  if (
    /\b(concludes (our|the) interview|interview is (now )?(ended|complete)|thank you for your time|that('s| is) all (the questions )?for today|best of luck)\b/i.test(text) &&
    !text.includes("?") &&
    !/\b(do you have any questions|any closing questions)\b/i.test(text)
  ) {
    return false;
  }

  // Pure instructions
  if (
    /\b(please speak clearly|you may (type|speak)|ensure your microphone|this interview will last)\b/i.test(text) &&
    !text.includes("?")
  ) {
    return false;
  }

  // Check if it has a question mark
  if (text.includes("?")) {
    const withoutGreeting = text.replace(/^(hello|hi|hey|welcome)[^.!?]*[.!?]\s*/i, "").trim();
    if (
      /^(are you ready( to (begin|start))?\??|shall we (begin|start)\??)$/i.test(withoutGreeting) ||
      /^(how are you( doing)?( today)?\??|how('s| is) it going( today)?\??)$/i.test(withoutGreeting)
    ) {
      return false;
    }
    return true;
  }

  // Imperative question prompts commonly used in tech interviews (e.g. "Tell me about...", "Explain...")
  const QUESTION_PROMPT_REGEX =
    /\b(tell me about|explain|describe|walk (me )?through|give (me )?(an |a )?example|how (would|can|do|did)|what (is|are|was|were|would)|why (did|do|is|are)|compare and contrast)\b/i;

  return QUESTION_PROMPT_REGEX.test(text);
}

/**
 * Checks whether a transcript turn is a valid candidate answer.
 */
export function isCandidateAnswer(turn: Turn | undefined | null): boolean {
  if (!turn) return false;
  if (turn.speaker !== "CANDIDATE") return false;
  return Boolean(turn.text && turn.text.trim().length > 0);
}

/**
 * Calculates interview duration in whole seconds from startedAt and endedAt timestamps.
 * Returns null for missing, invalid, reversed, negative, or still-running sessions.
 */
export function calculateDurationSeconds(
  startedAt?: string | null,
  endedAt?: string | null,
  status?: SessionStatus | string | null
): number | null {
  if (!startedAt || !endedAt) return null;
  if (status === "LIVE") return null;

  const start = new Date(startedAt).getTime();
  const end = new Date(endedAt).getTime();

  if (isNaN(start) || isNaN(end)) return null;
  if (end < start) return null;

  const diffSeconds = Math.floor((end - start) / 1000);
  if (diffSeconds < 0) return null;

  return diffSeconds;
}

/**
 * Formats duration in seconds to mm:ss format, or "—" if unavailable.
 */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || isNaN(seconds) || seconds < 0) {
    return "—";
  }
  const s = Math.floor(seconds);
  const mm = Math.floor(s / 60)
    .toString()
    .padStart(2, "0");
  const ss = (s % 60).toString().padStart(2, "0");
  return `${mm}:${ss}`;
}

/**
 * Computes interview summary statistics.
 * Returns null for questionsAsked and answersGiven while transcript turns are loading (null/undefined).
 */
export function calculateSummaryStats(
  turns?: Turn[] | null,
  session?: Session | null
): SummaryStats {
  const isTurnsLoaded = turns !== null && turns !== undefined;
  const questionsAsked = isTurnsLoaded
    ? turns.filter((t) => t.speaker === "AI" && isAiQuestion(t.text)).length
    : null;
  const answersGiven = isTurnsLoaded
    ? turns.filter(isCandidateAnswer).length
    : null;

  const durationSeconds = calculateDurationSeconds(
    session?.startedAt,
    session?.endedAt,
    session?.status
  );

  return {
    questionsAsked,
    answersGiven,
    durationSeconds,
    formattedDuration: formatDuration(durationSeconds),
  };
}

export function getRoleLabel(roleId?: string | null): string {
  if (!roleId) return "Interview";
  const match = ROLES.find((r) => r.id === roleId);
  if (match) return match.label;
  return roleId
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Escapes pipe characters and newlines for safe inclusion in Markdown tables.
 */
function escapeTableCell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

/**
 * Generates a clean Markdown filename for the interview session report.
 */
export function generateMarkdownFilename(session?: Session | null): string {
  const roleSlug = (session?.role || "interview")
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-");
  let dateStr = "session";
  if (session?.startedAt) {
    const d = new Date(session.startedAt);
    if (!isNaN(d.getTime())) {
      dateStr = d.toISOString().split("T")[0]!;
    }
  }
  return `interview-report-${roleSlug}-${dateStr}.md`;
}

/**
 * Generates the full Markdown report content from session, feedback, turns, and stats.
 */
export function generateMarkdownReport({
  session,
  feedback,
  turns,
  stats,
}: {
  session?: Session | null;
  feedback?: Feedback | null;
  turns?: Turn[] | null;
  stats?: SummaryStats;
}): string {
  const computedStats = stats ?? calculateSummaryStats(turns, session);
  const roleLabel = getRoleLabel(session?.role);
  const lines: string[] = [];

  // Header
  lines.push(`# Interview Report: ${roleLabel}`);
  lines.push("");

  // Metadata Overview
  lines.push("## Session Overview");
  const dateFormatted = session?.startedAt
    ? (() => {
        const d = new Date(session.startedAt);
        return isNaN(d.getTime()) ? session.startedAt : d.toISOString().replace("T", " ").replace(/\..+/, " UTC");
      })()
    : "Unavailable";

  lines.push(`- **Date:** ${dateFormatted}`);
  lines.push(`- **Role:** ${roleLabel}`);
  if (session?.company) {
    lines.push(`- **Company:** ${session.company}`);
  }
  if (session?.focus) {
    lines.push(`- **Focus Area:** ${session.focus}`);
  }
  if (session?.level) {
    lines.push(`- **Experience Level:** ${session.level}`);
  }
  if (session?.mode) {
    lines.push(`- **Interview Mode:** ${session.mode}`);
  }
  lines.push(`- **Duration:** ${computedStats.formattedDuration}`);
  lines.push(
    `- **Questions Asked:** ${
      computedStats.questionsAsked !== null ? computedStats.questionsAsked : "Unavailable"
    }`
  );
  lines.push(
    `- **Answers Given:** ${
      computedStats.answersGiven !== null ? computedStats.answersGiven : "Unavailable"
    }`
  );
  lines.push("");

  // Performance Summary
  lines.push("## Performance Summary");
  if (feedback?.scores && feedback.scores.length > 0) {
    const sum = feedback.scores.reduce((acc, curr) => acc + curr.score, 0);
    const avg = (sum / feedback.scores.length).toFixed(1);
    lines.push(`**Average Rubric Score:** ${avg} / 5`);
    lines.push("");
  }

  if (feedback?.status === "ready" && feedback.summary) {
    lines.push(feedback.summary);
  } else if (feedback?.status === "pending") {
    lines.push("*Feedback is currently preparing.*");
  } else if (feedback?.status === "failed") {
    lines.push("*Feedback generation was unavailable for this session.*");
  } else {
    lines.push("*No feedback summary available.*");
  }
  lines.push("");

  // Rubric Scores Table & Category Details
  if (feedback?.scores && feedback.scores.length > 0) {
    lines.push("## Rubric Evaluation");
    lines.push("");
    lines.push("| Category | Score | Max Score | Comment |");
    lines.push("| --- | --- | --- | --- |");
    for (const s of feedback.scores) {
      lines.push(
        `| ${escapeTableCell(s.category)} | ${s.score} | 5 | ${escapeTableCell(s.comment)} |`
      );
    }
    lines.push("");

    lines.push("### Category Breakdown");
    lines.push("");
    for (const s of feedback.scores) {
      lines.push(`#### ${s.category} (${s.score}/5)`);
      lines.push(s.comment);
      lines.push("");

      if (s.strengths && s.strengths.length > 0) {
        lines.push("**Strengths:**");
        for (const str of s.strengths) {
          lines.push(`- ${str}`);
        }
        lines.push("");
      }

      if (s.improvements && s.improvements.length > 0) {
        lines.push("**Areas for Improvement:**");
        for (const imp of s.improvements) {
          lines.push(`- ${imp}`);
        }
        lines.push("");
      }

      if (s.quote) {
        lines.push(`> “${s.quote}”`);
        lines.push("");
      }
    }
  }

  // Per-Answer Feedback
  if (feedback?.perAnswer && feedback.perAnswer.length > 0) {
    lines.push("## Feedback by Answer");
    lines.push("");
    feedback.perAnswer.forEach((item, index) => {
      lines.push(`### Question ${index + 1}`);
      lines.push(`**Question:** ${item.question}`);
      lines.push("");
      lines.push(`**Answer Summary:** ${item.summary}`);
      lines.push("");

      if (item.strengths && item.strengths.length > 0) {
        lines.push("**Strengths:**");
        for (const str of item.strengths) {
          lines.push(`- ${str}`);
        }
        lines.push("");
      }

      if (item.improvements && item.improvements.length > 0) {
        lines.push("**Areas for Improvement:**");
        for (const imp of item.improvements) {
          lines.push(`- ${imp}`);
        }
        lines.push("");
      }
    });
  }

  // Transcript (deterministic sorting by turnIndex)
  lines.push("## Transcript");
  lines.push("");
  if (!turns || turns.length === 0) {
    lines.push("*No transcript turns recorded.*");
  } else {
    const sortedTurns = [...turns].sort((a, b) => a.turnIndex - b.turnIndex);
    sortedTurns.forEach((turn, idx) => {
      const speakerLabel = turn.speaker === "AI" ? "AI Interviewer" : "Candidate";
      const mm = Math.floor(Math.max(0, turn.timestampSec || 0) / 60)
        .toString()
        .padStart(2, "0");
      const ss = (Math.max(0, turn.timestampSec || 0) % 60)
        .toString()
        .padStart(2, "0");
      const timeStr = `${mm}:${ss}`;

      lines.push(`**${speakerLabel}** (${timeStr}) — *Turn ${turn.turnIndex ?? idx + 1}*`);
      lines.push("");
      lines.push(turn.text);
      lines.push("");
    });
  }

  return lines.join("\n").trim() + "\n";
}

/**
 * Triggers a browser download of the given content as a Markdown file,
 * cleaning up the object URL afterwards.
 */
export function downloadMarkdownFile(content: string, filename: string): void {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } finally {
    URL.revokeObjectURL(url);
  }
}
