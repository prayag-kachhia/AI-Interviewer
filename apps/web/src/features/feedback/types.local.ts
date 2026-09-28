// types.local.ts
// TEMP — delete this file once packages/contracts/feedback lands (L1),
// and import the real type from there instead.

export type FeedbackStatus = "pending" | "ready" | "failed";

export interface Feedback {
  sessionId: string;
  status: FeedbackStatus;
  summary?: string;
  scores?: {
    category: string;
    score: number; // e.g. 1–5
    comment: string;
  }[];
}