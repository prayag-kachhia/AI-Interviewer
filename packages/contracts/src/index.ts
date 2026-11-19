import { z } from "zod";

// A role the candidate can pick on the role picker (GET /api/sessions/roles).
export const Role = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string(),
  // Areas the candidate can ask the interviewer to concentrate on. The briefing quotes them as-is.
  focuses: z.array(z.string().min(1)),
});
export type Role = z.infer<typeof Role>;

export const RoleList = z.array(Role);
export type RoleList = z.infer<typeof RoleList>;

// STUB (content work, owner: lead): the one role list, shared by the API
// (which validates role ids against it) and the web app (which shows it),
// until roles and their briefings are stored in the database.
export const ROLES: RoleList = [
  {
    id: "software-engineer",
    label: "Software Engineer",
    description: "Full-stack architecture, system design, debugging, and engineering collaboration.",
    focuses: ["System design", "Data structures and algorithms", "Debugging", "Frontend"],
  },
  {
    id: "data-analyst",
    label: "Data Analyst",
    description: "SQL & data pipelines, exploratory analysis, metrics validation, and stakeholder insights.",
    focuses: ["SQL", "Statistics", "Data visualization", "Product metrics"],
  },
  {
    id: "backend-developer",
    label: "Backend Developer",
    description: "API design, database modeling, query optimization, and service reliability.",
    focuses: ["API design", "Databases", "Caching", "Reliability"],
  },
];

// Parsed candidate resume profile (POST /api/resume/analyze, GET /api/resume/latest).
const profileString = z.string().nullish().transform((v) => v ?? "").default("");
const profileStringArray = z.array(z.string()).nullish().transform((v) => v ?? []).default([]);

export const CandidateProfile = z.object({
  name: profileString,
  email: profileString,
  phone: profileString,
  summary: profileString,
  education: profileStringArray,
  skills: profileStringArray,
  projects: profileStringArray,
  experience: profileStringArray,
  certifications: profileStringArray,
  achievements: profileStringArray,
  languages: profileStringArray,
});
export type CandidateProfile = z.infer<typeof CandidateProfile>;

export const Level = z.enum(["entry", "mid", "senior"]);
export type Level = z.infer<typeof Level>;

export const InterviewMode = z.enum(["voice", "typed"]);
export type InterviewMode = z.infer<typeof InterviewMode>;

// What the candidate chose on the setup screen (POST /api/sessions).
// The role itself is checked by the API; a focus must belong to the chosen role.
export const CreateSessionInput = z
  .object({
    roleId: z.string().min(1, "required"),
    focus: z.string().optional(),
    // Free text that goes into the interviewer's briefing, so it is trimmed and capped.
    company: z
      .string()
      .trim()
      .max(100)
      .optional()
      .transform((c) => c || undefined),
    level: Level.optional(),
    mode: InterviewMode.default("voice"),
    // Candidate-supplied job description text (FR-11). Max 4,000 characters.
    jobContext: z
      .string()
      .trim()
      .max(4000, "Job description must not exceed 4,000 characters")
      .optional()
      .transform((jc) => jc || undefined),
  })
  .superRefine((input, ctx) => {
    const role = ROLES.find((r) => r.id === input.roleId);
    if (input.focus !== undefined && role && !role.focuses.includes(input.focus)) {
      ctx.addIssue({ code: "custom", path: ["focus"], message: `not a focus of ${role.label}` });
    }
  });
export type CreateSessionInput = z.infer<typeof CreateSessionInput>;

// Sessions and transcript turns. Dates travel as ISO strings.
export const SessionStatus = z.enum(["LIVE", "ENDED"]);
export type SessionStatus = z.infer<typeof SessionStatus>;

// Candidate reasons for ending an interview early (FR-19, K-10).
export const EndReason = z.enum([
  "finished_early",
  "technical_problem",
  "need_to_stop",
  "other",
]);
export type EndReason = z.infer<typeof EndReason>;

export const END_REASONS: { id: EndReason; label: string }[] = [
  { id: "finished_early", label: "Finished early" },
  { id: "technical_problem", label: "Technical problem" },
  { id: "need_to_stop", label: "Need to stop" },
  { id: "other", label: "Other" },
];

export function formatEndReason(reason?: string | null): string {
  if (!reason) return "";
  const match = END_REASONS.find((r) => r.id === reason);
  return match ? match.label : reason;
}

export const TurnSpeaker = z.enum(["AI", "CANDIDATE"]);
export type TurnSpeaker = z.infer<typeof TurnSpeaker>;

export const Turn = z.object({
  id: z.string(),
  sessionId: z.string(),
  speaker: TurnSpeaker,
  text: z.string(),
  timestampSec: z.number(),
  turnIndex: z.number().int(),
  createdAt: z.string(),
});
export type Turn = z.infer<typeof Turn>;

// Written feedback for one session (GET /api/sessions/:id/feedback).
export const FeedbackStatus = z.enum(["pending", "ready", "failed"]);
export type FeedbackStatus = z.infer<typeof FeedbackStatus>;

export const CategoryScore = z.object({
  category: z.string().min(1),
  score: z.number().min(1).max(5),
});
export type CategoryScore = z.infer<typeof CategoryScore>;

export const Session = z.object({
  id: z.string(),
  userId: z.string(),
  resumeId: z.string().nullable().optional(),
  role: z.string(),
  company: z.string().nullable().optional(),
  level: Level.nullable().optional(),
  focus: z.string().nullable().optional(),
  mode: InterviewMode.optional(),
  jobContext: z.string().nullable().optional(),
  status: SessionStatus,
  keep: z.boolean().optional(),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  endReason: EndReason.nullable().optional(),
  createdAt: z.string().optional(),
  turns: z.array(Turn).optional(),
  feedbackStatus: FeedbackStatus.nullable().optional(),
  overallScore: z.number().nullable().optional(),
  endedEarly: z.boolean().optional(),
  categoryScores: z.array(CategoryScore).nullable().optional(),
});
export type Session = z.infer<typeof Session>;

// Short-lived voice provider token (POST /api/sessions/:id/voice-token).
export const VoiceToken = z.object({
  token: z.string().min(1),
});
export type VoiceToken = z.infer<typeof VoiceToken>;

export const FeedbackScore = z.object({
  category: z.string().min(1),
  score: z.number().int().min(1).max(5),
  comment: z.string(),
  strengths: z.array(z.string()),
  improvements: z.array(z.string()),
  quote: z.string(),
});
export type FeedbackScore = z.infer<typeof FeedbackScore>;

// Per-answer feedback for each candidate response (PN-9, FR-21, FR-26).
export const PerAnswerFeedback = z.object({
  question: z.string().min(1),
  summary: z.string().min(1),
  strengths: z.array(z.string()),
  improvements: z.array(z.string()),
});
export type PerAnswerFeedback = z.infer<typeof PerAnswerFeedback>;

export const Feedback = z.object({
  sessionId: z.string(),
  status: FeedbackStatus,
  summary: z.string().optional(),
  scores: z.array(FeedbackScore).optional(),
  perAnswer: z.array(PerAnswerFeedback).optional(),
});
export type Feedback = z.infer<typeof Feedback>;

// Topics for improvement plan and candidate insights (V-2, V-3, V-4).
export const INSIGHT_TOPICS = [
  "DBMS",
  "OOP",
  "OS",
  "CN",
  "DSA",
  "SQL",
  "System Design",
] as const;

export const InsightTopic = z.enum(INSIGHT_TOPICS);
export type InsightTopic = z.infer<typeof InsightTopic>;

export const TopicScore = z.object({
  topic: InsightTopic,
  score: z.number().int().min(1).max(5),
  summary: z.string().optional(),
});
export type TopicScore = z.infer<typeof TopicScore>;

export const LearningResourceType = z.enum([
  "documentation",
  "tutorial",
  "interactive",
  "guide",
]);
export type LearningResourceType = z.infer<typeof LearningResourceType>;

export const LearningResource = z.object({
  id: z.string(),
  topic: InsightTopic,
  title: z.string(),
  url: z.string(),
  description: z.string(),
  type: LearningResourceType,
});
export type LearningResource = z.infer<typeof LearningResource>;

export const PlanAction = z.object({
  id: z.string(),
  action: z.string(),
  resourceId: z.string(),
  completed: z.boolean().default(false),
  resource: LearningResource.optional(),
});
export type PlanAction = z.infer<typeof PlanAction>;

export const TopicPlan = z.object({
  id: z.string().optional(),
  topic: InsightTopic,
  score: z.number().int().min(1).max(5),
  summary: z.string().optional(),
  action: z.string().optional(),
  resourceId: z.string().optional(),
  actions: z.array(PlanAction).default([]),
});
export type TopicPlan = z.infer<typeof TopicPlan>;

export const RoadmapItem = z.object({
  id: z.string(),
  topic: InsightTopic,
  score: z.number().int().min(1).max(5),
  action: z.string(),
  resourceId: z.string(),
  completed: z.boolean().default(false),
  resource: LearningResource.optional(),
});
export type RoadmapItem = z.infer<typeof RoadmapItem>;

export const ImprovementPlan = z.object({
  id: z.string().optional(),
  userId: z.string(),
  topics: z.array(TopicScore),
  plan: z.array(TopicPlan).default([]),
  resources: z.array(LearningResource).optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});
export type ImprovementPlan = z.infer<typeof ImprovementPlan>;

// Input for updating roadmap progress (V-6, PATCH /api/insights/progress)
export const UpdateRoadmapProgressInput = z.object({
  actionId: z.string().min(1, 'actionId is required'),
  completed: z.boolean().default(true),
});
export type UpdateRoadmapProgressInput = z.infer<typeof UpdateRoadmapProgressInput>;

// ---------------------------------------------------------------------------
// Owner Dashboard & Admin Platform Statistics (FR-32, Issue #201)
// ---------------------------------------------------------------------------

export const AdminDailyInterview = z.object({
  date: z.string(), // YYYY-MM-DD
  count: z.number().int().min(0),
});
export type AdminDailyInterview = z.infer<typeof AdminDailyInterview>;

export const AdminFeedbackCounts = z.object({
  ready: z.number().int().min(0),
  failed: z.number().int().min(0),
});
export type AdminFeedbackCounts = z.infer<typeof AdminFeedbackCounts>;

export const AdminRoleAverageScore = z.object({
  role: z.string(),
  roleLabel: z.string(),
  averageScore: z.number().nullable(),
  sessionCount: z.number().int().min(0),
});
export type AdminRoleAverageScore = z.infer<typeof AdminRoleAverageScore>;

export const AdminStats = z.object({
  totalUsers: z.number().int().min(0),
  interviewsPast14Days: z.array(AdminDailyInterview),
  feedbackCounts: AdminFeedbackCounts,
  averageScoresByRole: z.array(AdminRoleAverageScore),
});
export type AdminStats = z.infer<typeof AdminStats>;

// ---------------------------------------------------------------------------
// Resume Match (FR-34, Issue #292 / RJ-14)
// ---------------------------------------------------------------------------

export const JOB_DESCRIPTION_MAX = 4000;

export const CreateResumeMatchInput = z.object({
  jobDescription: z
    .string()
    .trim()
    .min(1, "Job description is required")
    .max(
      JOB_DESCRIPTION_MAX,
      `Job description must not exceed ${JOB_DESCRIPTION_MAX} characters`
    ),
});
export type CreateResumeMatchInput = z.infer<typeof CreateResumeMatchInput>;

export const ResumeMatchSource = z.enum(["ai", "keywords"]);
export type ResumeMatchSource = z.infer<typeof ResumeMatchSource>;

export const RESUME_MATCH_CATEGORIES = [
  { category: "Skills match", weight: 0.4 },
  { category: "Experience relevance", weight: 0.3 },
  { category: "Keyword coverage", weight: 0.2 },
  { category: "Education and credentials", weight: 0.1 },
] as const;

export type ResumeMatchCategory = (typeof RESUME_MATCH_CATEGORIES)[number]["category"];

export const RESUME_MATCH_CATEGORY_WEIGHTS: Record<ResumeMatchCategory, number> = {
  "Skills match": 0.4,
  "Experience relevance": 0.3,
  "Keyword coverage": 0.2,
  "Education and credentials": 0.1,
};

export const ResumeMatchCategoryScore = z.object({
  category: z.string().min(1),
  score: z.number().int().min(0).max(100),
  comment: z.string(),
});
export type ResumeMatchCategoryScore = z.infer<typeof ResumeMatchCategoryScore>;

export const ResumeMatchResult = z.object({
  score: z.number().int().min(0).max(100),
  source: ResumeMatchSource,
  categories: z.array(ResumeMatchCategoryScore),
  matchedKeywords: z.array(z.string()),
  missingKeywords: z.array(z.string()),
  strengths: z.array(z.string()),
  gaps: z.array(z.string()),
  suggestions: z.array(z.string()),
});
export type ResumeMatchResult = z.infer<typeof ResumeMatchResult>;

export const ResumeMatch = z.object({
  id: z.string(),
  resumeId: z.string(),
  jobDescription: z.string(),
  score: z.number().int().min(0).max(100),
  source: ResumeMatchSource,
  categories: z.array(ResumeMatchCategoryScore),
  matchedKeywords: z.array(z.string()),
  missingKeywords: z.array(z.string()),
  strengths: z.array(z.string()),
  gaps: z.array(z.string()),
  suggestions: z.array(z.string()),
  createdAt: z.string(),
});
export type ResumeMatch = z.infer<typeof ResumeMatch>;

/**
 * Calculates the overall resume match score from the four weighted categories (RJ-14, FR-34):
 * overall = round(0.40 * skills + 0.30 * experience + 0.20 * keywords + 0.10 * education)
 *
 * Each category score is clamped to [0, 100] before calculating.
 * Requires exactly the four configured categories, rejecting missing or duplicate entries.
 */
export function calculateResumeMatchOverallScore(
  categories: Array<{ category: string; score: number }>
): number {
  if (!Array.isArray(categories)) {
    throw new TypeError("Categories must be an array");
  }

  const seen = new Set<string>();
  const scoresByCategory = new Map<string, number>();

  for (const item of categories) {
    if (!item || typeof item !== "object" || typeof item.category !== "string") {
      throw new TypeError(
        "Each category score must be an object with string category and numeric score"
      );
    }

    const cat = item.category;

    if (seen.has(cat)) {
      throw new Error(`Duplicate category: "${cat}"`);
    }
    seen.add(cat);

    if (typeof item.score !== "number" || !Number.isFinite(item.score)) {
      throw new TypeError(
        `Category score for "${cat}" must be a finite number, received: ${item.score}`
      );
    }

    // Clamp each category score to 0–100 before calculating
    const clamped = Math.min(100, Math.max(0, item.score));
    scoresByCategory.set(cat, clamped);
  }

  // Require the four expected categories; do not silently produce misleading results for missing/duplicate categories.
  for (const expected of RESUME_MATCH_CATEGORIES) {
    if (!scoresByCategory.has(expected.category)) {
      throw new Error(`Missing required category: "${expected.category}"`);
    }
  }

  if (scoresByCategory.size !== RESUME_MATCH_CATEGORIES.length) {
    const unexpected = Array.from(scoresByCategory.keys()).filter(
      (k) => !RESUME_MATCH_CATEGORIES.some((c) => c.category === k)
    );
    throw new Error(`Unexpected category: "${unexpected.join(", ")}"`);
  }

  const skills = scoresByCategory.get("Skills match")!;
  const experience = scoresByCategory.get("Experience relevance")!;
  const keywords = scoresByCategory.get("Keyword coverage")!;
  const education = scoresByCategory.get("Education and credentials")!;

  const weightedSum =
    0.4 * skills +
    0.3 * experience +
    0.2 * keywords +
    0.1 * education;

  const rounded = Math.round(weightedSum);
  return Math.min(100, Math.max(0, rounded));
}

