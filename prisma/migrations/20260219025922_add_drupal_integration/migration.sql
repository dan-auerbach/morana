-- CreateTable
CREATE TABLE "IntegrationDrupal" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Drupal',
    "baseUrl" TEXT NOT NULL,
    "adapterType" TEXT NOT NULL DEFAULT 'jsonapi',
    "authType" TEXT NOT NULL DEFAULT 'bearer_token',
    "credentialsEnc" TEXT,
    "defaultContentType" TEXT NOT NULL DEFAULT 'article',
    "fieldMap" JSONB,
    "bodyFormat" TEXT NOT NULL DEFAULT 'full_html',
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegrationDrupal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IntegrationDrupal_workspaceId_idx" ON "IntegrationDrupal"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationDrupal_workspaceId_key" ON "IntegrationDrupal"("workspaceId");

-- AddForeignKey
ALTER TABLE "IntegrationDrupal" ADD CONSTRAINT "IntegrationDrupal_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
