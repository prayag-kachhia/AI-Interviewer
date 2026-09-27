CREATE TABLE IF NOT EXISTS "jobs" (
  "id" text PRIMARY KEY,
  "type" text NOT NULL,
  "sessionId" text,
  "payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "status" text DEFAULT 'queued' NOT NULL,
  "lockedBy" text,
  "lockedAt" timestamp with time zone,
  "attempts" integer DEFAULT 0 NOT NULL,
  "lastError" text,
  "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
  "updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "sessionId" text;
ALTER TABLE "jobs" ALTER COLUMN "sessionId" DROP NOT NULL;
ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "payload" jsonb DEFAULT '{}'::jsonb NOT NULL;
ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "lockedBy" text;
ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "lockedAt" timestamp with time zone;
ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "attempts" integer DEFAULT 0 NOT NULL;
ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "lastError" text;
ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "updatedAt" timestamp with time zone DEFAULT now() NOT NULL;

CREATE INDEX IF NOT EXISTS "jobs_status_createdAt_idx" ON "jobs" ("status", "createdAt");

CREATE TABLE IF NOT EXISTS "feedback" (
  "id" text PRIMARY KEY,
  "sessionId" text NOT NULL,
  "userId" text,
  "status" text DEFAULT 'pending' NOT NULL,
  "summary" text,
  "scores" jsonb,
  "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
  "updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "feedback_sessionId_idx" ON "feedback" ("sessionId");
