-- CreateTable
CREATE TABLE "improvement_plans" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "topics" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "improvement_plans_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "improvement_plans_userId_key" ON "improvement_plans"("userId");

-- AddForeignKey
ALTER TABLE "improvement_plans" ADD CONSTRAINT "improvement_plans_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

