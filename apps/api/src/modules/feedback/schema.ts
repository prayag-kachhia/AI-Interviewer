import { pgTable, text, timestamp, integer, jsonb, index } from "drizzle-orm/pg-core";

export const jobs = pgTable(
  "jobs",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    type: text("type").notNull(),
    sessionId: text("sessionId"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    status: text("status").notNull().default("queued"),
    lockedBy: text("lockedBy"),
    lockedAt: timestamp("lockedAt", { withTimezone: true }),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("lastError"),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("jobs_status_createdAt_idx").on(table.status, table.createdAt),
  ]
);

export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;

export const feedback = pgTable(
  "feedback",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    sessionId: text("sessionId").notNull(),
    userId: text("userId"),
    status: text("status", { enum: ["pending", "ready", "failed"] })
      .notNull()
      .default("pending"),
    summary: text("summary"),
    scores: jsonb("scores").$type<
      Array<{
        category: string;
        score: number;
        comment: string;
      }>
    >(),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("feedback_sessionId_idx").on(table.sessionId),
  ]
);

export type Feedback = typeof feedback.$inferSelect;
export type NewFeedback = typeof feedback.$inferInsert;
