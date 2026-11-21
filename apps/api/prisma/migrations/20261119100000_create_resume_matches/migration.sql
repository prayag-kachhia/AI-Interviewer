-- CreateTable
CREATE TABLE "resume_matches" (
    "id" UUID NOT NULL,
    "resumeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "jobDescription" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "resume_matches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "resume_matches_userId_createdAt_idx" ON "resume_matches"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "resume_matches_resumeId_idx" ON "resume_matches"("resumeId");

-- AddForeignKey
ALTER TABLE "resume_matches" ADD CONSTRAINT "resume_matches_resumeId_fkey" FOREIGN KEY ("resumeId") REFERENCES "Resume"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resume_matches" ADD CONSTRAINT "resume_matches_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
