import { z } from "zod";

// A role the candidate can pick on the role picker (GET /api/sessions/roles).
export const Role = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string(),
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
  },
  {
    id: "data-analyst",
    label: "Data Analyst",
    description: "SQL & data pipelines, exploratory analysis, metrics validation, and stakeholder insights.",
  },
  {
    id: "backend-developer",
    label: "Backend Developer",
    description: "API design, database modeling, query optimization, and service reliability.",
  },
];

// Sessions and transcript turns. Dates travel as ISO strings.
export const SessionStatus = z.enum(["LIVE", "ENDED"]);
export type SessionStatus = z.infer<typeof SessionStatus>;

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

export const Session = z.object({
  id: z.string(),
  userId: z.string(),
  resumeId: z.string().nullable().optional(),
  role: z.string(),
  status: SessionStatus,
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  createdAt: z.string().optional(),
  turns: z.array(Turn).optional(),
  feedbackStatus: FeedbackStatus.nullable().optional(),
  endedEarly: z.boolean().optional(),
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

export const Feedback = z.object({
  sessionId: z.string(),
  status: FeedbackStatus,
  summary: z.string().optional(),
  scores: z.array(FeedbackScore).optional(),
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

export const PlanAction = z.object({
  id: z.string(),
  action: z.string(),
  resourceId: z.string(),
  completed: z.boolean().default(false),
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
});
export type RoadmapItem = z.infer<typeof RoadmapItem>;

export const ImprovementPlan = z.object({
  id: z.string().optional(),
  userId: z.string(),
  topics: z.array(TopicScore),
  plan: z.array(TopicPlan).default([]),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});
export type ImprovementPlan = z.infer<typeof ImprovementPlan>;

