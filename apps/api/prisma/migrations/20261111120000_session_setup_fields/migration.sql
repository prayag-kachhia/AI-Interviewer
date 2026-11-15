-- AlterTable
ALTER TABLE "sessions" ADD COLUMN     "company" TEXT,
ADD COLUMN     "focus" TEXT,
ADD COLUMN     "level" TEXT,
ADD COLUMN     "mode" TEXT NOT NULL DEFAULT 'voice';
