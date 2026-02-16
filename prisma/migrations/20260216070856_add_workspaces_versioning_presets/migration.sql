-- CreateEnum
CREATE TYPE "WorkspaceRole" AS ENUM ('member', 'admin');

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "KnowledgeBase" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "PromptTemplate" ADD COLUMN     "currentVersion" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "Recipe" ADD COLUMN     "isPreset" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "presetKey" TEXT,
ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "Run" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "UsageEvent" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "activeWorkspaceId" TEXT;

-- CreateTable
CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "maxMonthlyCostCents" INTEGER,
    "allowedModels" JSONB,

    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceMember" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "WorkspaceRole" NOT NULL DEFAULT 'member',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkspaceMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromptTemplateVersion" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "systemPrompt" TEXT NOT NULL,
    "userPromptTemplate" TEXT,
    "knowledgeText" TEXT,
    "category" TEXT NOT NULL DEFAULT 'general',
    "description" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromptTemplateVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Workspace_slug_key" ON "Workspace"("slug");

-- CreateIndex
CREATE INDEX "Workspace_slug_idx" ON "Workspace"("slug");

-- CreateIndex
CREATE INDEX "WorkspaceMember_userId_idx" ON "WorkspaceMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceMember_workspaceId_userId_key" ON "WorkspaceMember"("workspaceId", "userId");

-- CreateIndex
CREATE INDEX "PromptTemplateVersion_templateId_idx" ON "PromptTemplateVersion"("templateId");

-- CreateIndex
CREATE UNIQUE INDEX "PromptTemplateVersion_templateId_versionNumber_key" ON "PromptTemplateVersion"("templateId", "versionNumber");

-- CreateIndex
CREATE INDEX "Conversation_workspaceId_idx" ON "Conversation"("workspaceId");

-- CreateIndex
CREATE INDEX "KnowledgeBase_workspaceId_idx" ON "KnowledgeBase"("workspaceId");

-- CreateIndex
CREATE INDEX "PromptTemplate_workspaceId_idx" ON "PromptTemplate"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "Recipe_presetKey_key" ON "Recipe"("presetKey");

-- CreateIndex
CREATE INDEX "Recipe_workspaceId_idx" ON "Recipe"("workspaceId");

-- CreateIndex
CREATE INDEX "Run_workspaceId_idx" ON "Run"("workspaceId");

-- CreateIndex
CREATE INDEX "UsageEvent_workspaceId_createdAt_idx" ON "UsageEvent"("workspaceId", "createdAt");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_activeWorkspaceId_fkey" FOREIGN KEY ("activeWorkspaceId") REFERENCES "Workspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Run" ADD CONSTRAINT "Run_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageEvent" ADD CONSTRAINT "UsageEvent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromptTemplate" ADD CONSTRAINT "PromptTemplate_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromptTemplateVersion" ADD CONSTRAINT "PromptTemplateVersion_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "PromptTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromptTemplateVersion" ADD CONSTRAINT "PromptTemplateVersion_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeBase" ADD CONSTRAINT "KnowledgeBase_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recipe" ADD CONSTRAINT "Recipe_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed: Create default workspace and assign all existing users
INSERT INTO "Workspace" ("id", "name", "slug", "isActive", "createdAt", "updatedAt")
VALUES ('default-workspace', 'Default', 'default', true, NOW(), NOW())
ON CONFLICT ("slug") DO NOTHING;

-- Add all existing users as members of default workspace (admins as workspace admins)
INSERT INTO "WorkspaceMember" ("id", "workspaceId", "userId", "role", "createdAt")
SELECT
  'wm-' || "id",
  'default-workspace',
  "id",
  CASE WHEN "role" = 'admin' THEN 'admin'::"WorkspaceRole" ELSE 'member'::"WorkspaceRole" END,
  NOW()
FROM "User"
ON CONFLICT ("workspaceId", "userId") DO NOTHING;

-- Set default workspace as active for all users
UPDATE "User" SET "activeWorkspaceId" = 'default-workspace' WHERE "activeWorkspaceId" IS NULL;

-- Assign all existing records to default workspace
UPDATE "Conversation" SET "workspaceId" = 'default-workspace' WHERE "workspaceId" IS NULL;
UPDATE "Run" SET "workspaceId" = 'default-workspace' WHERE "workspaceId" IS NULL;
UPDATE "UsageEvent" SET "workspaceId" = 'default-workspace' WHERE "workspaceId" IS NULL;
UPDATE "PromptTemplate" SET "workspaceId" = 'default-workspace' WHERE "workspaceId" IS NULL;
UPDATE "KnowledgeBase" SET "workspaceId" = 'default-workspace' WHERE "workspaceId" IS NULL;
UPDATE "Recipe" SET "workspaceId" = 'default-workspace' WHERE "workspaceId" IS NULL;

-- Create initial version snapshots for existing templates
INSERT INTO "PromptTemplateVersion" ("id", "templateId", "versionNumber", "systemPrompt", "userPromptTemplate", "knowledgeText", "category", "description", "createdBy", "createdAt")
SELECT
  'ptv-' || "id",
  "id",
  1,
  "systemPrompt",
  "userPromptTemplate",
  "knowledgeText",
  "category",
  "description",
  "createdBy",
  "createdAt"
FROM "PromptTemplate"
ON CONFLICT ("templateId", "versionNumber") DO NOTHING;

