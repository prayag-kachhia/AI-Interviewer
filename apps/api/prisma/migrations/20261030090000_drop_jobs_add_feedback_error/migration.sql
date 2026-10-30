-- DropForeignKey
ALTER TABLE "jobs" DROP CONSTRAINT IF EXISTS "jobs_sessionId_fkey";

-- DropTable
DROP TABLE IF EXISTS "jobs";

-- AlterTable
ALTER TABLE "feedback" ADD COLUMN "error" TEXT;

