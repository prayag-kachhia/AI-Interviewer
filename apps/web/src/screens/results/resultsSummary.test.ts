// resultsSummary.test.ts
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { Feedback, Session, Turn } from "@interview/contracts";
import {
  isAiQuestion,
  isCandidateAnswer,
  calculateDurationSeconds,
  formatDuration,
  calculateSummaryStats,
  generateMarkdownFilename,
  generateMarkdownReport,
  downloadMarkdownFile,
  getRoleLabel,
} from "./resultsSummary";

describe("resultsSummary helper", () => {
  describe("isAiQuestion", () => {
    it("identifies real AI interview questions with question marks", () => {
      expect(isAiQuestion("How do hash tables resolve collisions?")).toBe(true);
      expect(isAiQuestion("Can you describe a time you handled a difficult production bug?")).toBe(true);
      expect(isAiQuestion("What are the key trade-offs between SQL and NoSQL databases?")).toBe(true);
    });

    it("identifies imperative interview questions without question marks", () => {
      expect(isAiQuestion("Tell me about a time you optimized a slow database query.")).toBe(true);
      expect(isAiQuestion("Explain how JavaScript's event loop and call stack work.")).toBe(true);
      expect(isAiQuestion("Describe your experience with REST vs GraphQL APIs.")).toBe(true);
      expect(isAiQuestion("Walk me through how you would architect a real-time chat application.")).toBe(true);
      expect(isAiQuestion("Give me an example of how you solved a distributed concurrency issue.")).toBe(true);
    });

    it("identifies questions that begin with a greeting or transition phrase", () => {
      expect(
        isAiQuestion("Welcome to your mock interview! To begin, how would you design a scalable rate limiter?")
      ).toBe(true);
      expect(
        isAiQuestion("Great answer. Moving on, tell me about your experience with Docker containers.")
      ).toBe(true);
    });

    it("does not count standalone greetings and welcome messages as questions", () => {
      expect(isAiQuestion("Welcome to your interview today! Let's get started.")).toBe(false);
      expect(isAiQuestion("Hello! I'll be your technical interviewer today.")).toBe(false);
      expect(isAiQuestion("Good morning, thanks for joining.")).toBe(false);
      expect(isAiQuestion("Hi there!")).toBe(false);
      expect(isAiQuestion("Are you ready to begin?")).toBe(false);
      expect(isAiQuestion("Shall we start?")).toBe(false);
      expect(isAiQuestion("How are you doing today?")).toBe(false);
    });

    it("does not count instructions, thinking silence prompts, and acknowledgments as questions", () => {
      expect(isAiQuestion("Please speak clearly and feel free to take a moment before answering.")).toBe(false);
      expect(isAiQuestion("Take your time, let me know when you're ready.")).toBe(false);
      expect(isAiQuestion("No rush, feel free to think.")).toBe(false);
      expect(isAiQuestion("[the candidate is thinking; offer brief encouragement]")).toBe(false);
      expect(isAiQuestion("Understood.")).toBe(false);
      expect(isAiQuestion("Okay, got it.")).toBe(false);
      expect(isAiQuestion("Thank you.")).toBe(false);
    });

    it("does not count pure wrap-up or closing statements as questions", () => {
      expect(isAiQuestion("That concludes our interview. Thank you for your time!")).toBe(false);
      expect(isAiQuestion("Best of luck with your preparation.")).toBe(false);
      expect(isAiQuestion("The interview is now complete. Have a great day!")).toBe(false);
    });

    it("handles empty, null, and whitespace inputs safely", () => {
      expect(isAiQuestion("")).toBe(false);
      expect(isAiQuestion("   ")).toBe(false);
      expect(isAiQuestion(null)).toBe(false);
      expect(isAiQuestion(undefined)).toBe(false);
    });
  });

  describe("isCandidateAnswer", () => {
    it("returns true for candidate turns with non-empty text", () => {
      const turn: Turn = {
        id: "t1",
        sessionId: "s1",
        speaker: "CANDIDATE",
        text: "I used indexing and partitioning to speed up the query.",
        timestampSec: 25,
        turnIndex: 2,
        createdAt: "2026-11-17T10:00:25Z",
      };
      expect(isCandidateAnswer(turn)).toBe(true);
    });

    it("returns false for AI turns", () => {
      const turn: Turn = {
        id: "t0",
        sessionId: "s1",
        speaker: "AI",
        text: "Tell me about your database work.",
        timestampSec: 5,
        turnIndex: 1,
        createdAt: "2026-11-17T10:00:05Z",
      };
      expect(isCandidateAnswer(turn)).toBe(false);
    });

    it("returns false for candidate turns with empty or whitespace-only text", () => {
      const emptyTurn: Turn = {
        id: "t1",
        sessionId: "s1",
        speaker: "CANDIDATE",
        text: "   ",
        timestampSec: 25,
        turnIndex: 2,
        createdAt: "2026-11-17T10:00:25Z",
      };
      expect(isCandidateAnswer(emptyTurn)).toBe(false);
      expect(isCandidateAnswer(null)).toBe(false);
      expect(isCandidateAnswer(undefined)).toBe(false);
    });
  });

  describe("calculateDurationSeconds & formatDuration", () => {
    it("calculates exact duration for valid timestamps", () => {
      const start = "2026-11-17T10:00:00.000Z";
      const end = "2026-11-17T10:14:32.000Z";
      expect(calculateDurationSeconds(start, end, "ENDED")).toBe(872);
      expect(formatDuration(872)).toBe("14:32");
    });

    it("handles zero seconds correctly", () => {
      const start = "2026-11-17T10:00:00.000Z";
      expect(calculateDurationSeconds(start, start, "ENDED")).toBe(0);
      expect(formatDuration(0)).toBe("00:00");
    });

    it("returns null for still-running sessions (status LIVE or missing endedAt)", () => {
      const start = "2026-11-17T10:00:00.000Z";
      expect(calculateDurationSeconds(start, null, "LIVE")).toBeNull();
      expect(calculateDurationSeconds(start, "2026-11-17T10:10:00.000Z", "LIVE")).toBeNull();
    });

    it("returns null for missing, reversed, or invalid timestamps without inventing durations", () => {
      expect(calculateDurationSeconds(null, null, "ENDED")).toBeNull();
      expect(calculateDurationSeconds("invalid-date", "2026-11-17T10:00:00Z", "ENDED")).toBeNull();
      expect(calculateDurationSeconds("2026-11-17T10:00:00Z", "invalid-date", "ENDED")).toBeNull();
      // Reversed timestamps: end before start
      expect(
        calculateDurationSeconds("2026-11-17T10:15:00Z", "2026-11-17T10:00:00Z", "ENDED")
      ).toBeNull();
    });

    it("formatDuration returns '—' for null, undefined, NaN, or negative durations", () => {
      expect(formatDuration(null)).toBe("—");
      expect(formatDuration(undefined)).toBe("—");
      expect(formatDuration(NaN)).toBe("—");
      expect(formatDuration(-10)).toBe("—");
    });
  });

  describe("calculateSummaryStats", () => {
    it("returns null questionsAsked and answersGiven when turns are null or undefined (loading state)", () => {
      const stats = calculateSummaryStats(null, null);
      expect(stats.questionsAsked).toBeNull();
      expect(stats.answersGiven).toBeNull();
      expect(stats.durationSeconds).toBeNull();
      expect(stats.formattedDuration).toBe("—");
    });

    it("computes accurate stats for a completed interview with mixed AI messages", () => {
      const turns: Turn[] = [
        {
          id: "t1",
          sessionId: "s1",
          speaker: "AI",
          text: "Welcome to your mock interview! Let's get started.",
          timestampSec: 2,
          turnIndex: 1,
          createdAt: "2026-11-17T10:00:02Z",
        },
        {
          id: "t2",
          sessionId: "s1",
          speaker: "AI",
          text: "Can you explain how a hash table handles collisions?",
          timestampSec: 5,
          turnIndex: 2,
          createdAt: "2026-11-17T10:00:05Z",
        },
        {
          id: "t3",
          sessionId: "s1",
          speaker: "CANDIDATE",
          text: "They use separate chaining or open addressing.",
          timestampSec: 25,
          turnIndex: 3,
          createdAt: "2026-11-17T10:00:25Z",
        },
        {
          id: "t4",
          sessionId: "s1",
          speaker: "AI",
          text: "Take your time, let me know when you're ready.",
          timestampSec: 30,
          turnIndex: 4,
          createdAt: "2026-11-17T10:00:30Z",
        },
        {
          id: "t5",
          sessionId: "s1",
          speaker: "AI",
          text: "Tell me about a time you optimized a slow database query.",
          timestampSec: 40,
          turnIndex: 5,
          createdAt: "2026-11-17T10:00:40Z",
        },
        {
          id: "t6",
          sessionId: "s1",
          speaker: "CANDIDATE",
          text: "I added an index on customer_id and reduced scan time by 80%.",
          timestampSec: 75,
          turnIndex: 6,
          createdAt: "2026-11-17T10:01:15Z",
        },
        {
          id: "t7",
          sessionId: "s1",
          speaker: "AI",
          text: "That concludes our interview. Thank you for your time!",
          timestampSec: 90,
          turnIndex: 7,
          createdAt: "2026-11-17T10:01:30Z",
        },
      ];

      const session: Session = {
        id: "s1",
        userId: "u1",
        role: "software-engineer",
        status: "ENDED",
        startedAt: "2026-11-17T10:00:00.000Z",
        endedAt: "2026-11-17T10:10:00.000Z",
      };

      const stats = calculateSummaryStats(turns, session);
      expect(stats.questionsAsked).toBe(2); // Only t2 and t5 are questions
      expect(stats.answersGiven).toBe(2); // t3 and t6
      expect(stats.durationSeconds).toBe(600);
      expect(stats.formattedDuration).toBe("10:00");
    });
  });

  describe("getRoleLabel & generateMarkdownFilename", () => {
    it("formats known and unknown roles cleanly", () => {
      expect(getRoleLabel("software-engineer")).toBe("Software Engineer");
      expect(getRoleLabel("data-analyst")).toBe("Data Analyst");
      expect(getRoleLabel("backend-developer")).toBe("Backend Developer");
      expect(getRoleLabel("devops-engineer")).toBe("Devops Engineer");
      expect(getRoleLabel(null)).toBe("Interview");
    });

    it("generates safe, sensible filenames", () => {
      const session: Session = {
        id: "s1",
        userId: "u1",
        role: "software-engineer",
        status: "ENDED",
        startedAt: "2026-11-17T14:30:00.000Z",
        endedAt: "2026-11-17T14:45:00.000Z",
      };
      expect(generateMarkdownFilename(session)).toBe(
        "interview-report-software-engineer-2026-11-17.md"
      );
    });
  });

  describe("generateMarkdownReport", () => {
    const mockSession: Session = {
      id: "s1",
      userId: "u1",
      role: "software-engineer",
      company: "Acme Corp",
      focus: "System design",
      level: "mid",
      mode: "voice",
      status: "ENDED",
      startedAt: "2026-11-17T10:00:00.000Z",
      endedAt: "2026-11-17T10:12:30.000Z",
    };

    const mockFeedback: Feedback = {
      sessionId: "s1",
      status: "ready",
      summary: "Candidate demonstrated strong backend fundamentals and clear communication.",
      scores: [
        {
          category: "System Design",
          score: 5,
          comment: "Excellent distributed architecture breakdown.",
          strengths: ["Clear caching strategy", "Fault tolerance considerations"],
          improvements: ["Consider multi-region data replication"],
          quote: "I would place Redis as an LRU write-through cache in front of Postgres.",
        },
      ],
      perAnswer: [
        {
          question: "How would you design a rate limiter?",
          summary: "Proposed token bucket algorithm backed by Redis.",
          strengths: ["Good algorithm choice"],
          improvements: ["Discuss edge proxy implementation"],
        },
      ],
    };

    const mockTurns: Turn[] = [
      {
        id: "t2",
        sessionId: "s1",
        speaker: "CANDIDATE",
        text: "I would use a token bucket algorithm.",
        timestampSec: 30,
        turnIndex: 2,
        createdAt: "2026-11-17T10:00:30Z",
      },
      {
        id: "t1",
        sessionId: "s1",
        speaker: "AI",
        text: "How would you design a rate limiter?",
        timestampSec: 5,
        turnIndex: 1,
        createdAt: "2026-11-17T10:00:05Z",
      },
    ];

    it("generates complete Markdown with deterministic chronological transcript ordering", () => {
      const md = generateMarkdownReport({
        session: mockSession,
        feedback: mockFeedback,
        turns: mockTurns, // Note: passed out of order
      });

      expect(md).toContain("# Interview Report: Software Engineer");
      expect(md).toContain("- **Company:** Acme Corp");
      expect(md).toContain("- **Focus Area:** System design");
      expect(md).toContain("- **Experience Level:** mid");
      expect(md).toContain("- **Duration:** 12:30");
      expect(md).toContain("- **Questions Asked:** 1");
      expect(md).toContain("- **Answers Given:** 1");
      expect(md).toContain("## Performance Summary");
      expect(md).toContain("Candidate demonstrated strong backend fundamentals");
      expect(md).toContain("## Rubric Evaluation");
      expect(md).toContain("| System Design | 5 | 5 | Excellent distributed architecture breakdown. |");
      expect(md).toContain("## Feedback by Answer");
      expect(md).toContain("### Question 1");
      expect(md).toContain("## Transcript");

      // Verify deterministic chronological ordering: Turn 1 before Turn 2
      const turn1Pos = md.indexOf("Turn 1");
      const turn2Pos = md.indexOf("Turn 2");
      expect(turn1Pos).toBeGreaterThan(-1);
      expect(turn2Pos).toBeGreaterThan(-1);
      expect(turn1Pos).toBeLessThan(turn2Pos);

      // Verify security / confidentiality: no sensitive IDs or tokens
      expect(md).not.toContain("u1");
      expect(md).not.toContain("access_token");
      expect(md).not.toContain("apiKey");
    });

    it("handles pending or failed feedback states gracefully", () => {
      const pendingMd = generateMarkdownReport({
        session: mockSession,
        feedback: { sessionId: "s1", status: "pending" },
        turns: [],
      });
      expect(pendingMd).toContain("*Feedback is currently preparing.*");
      expect(pendingMd).toContain("*No transcript turns recorded.*");

      const failedMd = generateMarkdownReport({
        session: mockSession,
        feedback: { sessionId: "s1", status: "failed" },
        turns: [],
      });
      expect(failedMd).toContain("*Feedback generation was unavailable for this session.*");
    });
  });

  describe("downloadMarkdownFile", () => {
    let originalCreateObjectURL: typeof URL.createObjectURL;
    let originalRevokeObjectURL: typeof URL.revokeObjectURL;

    beforeEach(() => {
      originalCreateObjectURL = URL.createObjectURL;
      originalRevokeObjectURL = URL.revokeObjectURL;
      URL.createObjectURL = vi.fn().mockReturnValue("blob:http://localhost/test-blob-url");
      URL.revokeObjectURL = vi.fn();
    });

    afterEach(() => {
      URL.createObjectURL = originalCreateObjectURL;
      URL.revokeObjectURL = originalRevokeObjectURL;
      vi.restoreAllMocks();
    });

    it("creates blob, triggers download on an anchor element, and revokes object URL", () => {
      const appendSpy = vi.spyOn(document.body, "appendChild");
      const removeSpy = vi.spyOn(document.body, "removeChild");

      downloadMarkdownFile("# Test Content", "report.md");

      expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
      expect(appendSpy).toHaveBeenCalled();
      const appendedElement = appendSpy.mock.calls[0]?.[0] as HTMLAnchorElement;
      expect(appendedElement.tagName).toBe("A");
      expect(appendedElement.download).toBe("report.md");
      expect(appendedElement.href).toBe("blob:http://localhost/test-blob-url");
      expect(removeSpy).toHaveBeenCalledWith(appendedElement);
      expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:http://localhost/test-blob-url");
    });

    it("ensures URL.revokeObjectURL is cleaned up even if download click fails", () => {
      vi.spyOn(document.body, "appendChild").mockImplementation(() => {
        throw new Error("DOM Exception");
      });

      expect(() => downloadMarkdownFile("# Error Test", "err.md")).toThrow("DOM Exception");
      expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:http://localhost/test-blob-url");
    });
  });
});
