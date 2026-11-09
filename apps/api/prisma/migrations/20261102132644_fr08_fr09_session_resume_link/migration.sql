-- AlterTable
ALTER TABLE "sessions" ADD COLUMN     "resumeId" TEXT;

-- CreateIndex
CREATE INDEX "sessions_resumeId_idx" ON "sessions"("resumeId");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_resumeId_fkey" FOREIGN KEY ("resumeId") REFERENCES "Resume"("id") ON DELETE SET NULL ON UPDATE CASCADE;
