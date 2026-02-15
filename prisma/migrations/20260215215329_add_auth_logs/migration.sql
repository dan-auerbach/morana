/*
  Warnings:

  - You are about to drop the column `embedding` on the `DocumentChunk` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "DocumentChunk_embedding_idx";

-- AlterTable
ALTER TABLE "DocumentChunk" DROP COLUMN "embedding";

-- CreateTable
CREATE TABLE "AuthLog" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'google',
    "ip" TEXT,
    "userAgent" TEXT,
    "country" TEXT,
    "city" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuthLog_email_idx" ON "AuthLog"("email");

-- CreateIndex
CREATE INDEX "AuthLog_createdAt_idx" ON "AuthLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuthLog_event_idx" ON "AuthLog"("event");
