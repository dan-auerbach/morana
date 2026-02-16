-- AlterTable
ALTER TABLE "Recipe" ADD COLUMN     "currentVersion" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "RecipeExecution" ADD COLUMN     "costBreakdownJson" JSONB,
ADD COLUMN     "recipeVersion" INTEGER,
ADD COLUMN     "totalCostCents" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "RecipeStepResult" ADD COLUMN     "inputHash" TEXT,
ADD COLUMN     "outputHash" TEXT,
ADD COLUMN     "providerResponseId" TEXT;

-- CreateTable
CREATE TABLE "RecipeVersion" (
    "id" TEXT NOT NULL,
    "recipeId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "stepsSnapshot" JSONB NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "changedBy" TEXT NOT NULL,
    "changeNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecipeVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIModel" (
    "id" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "pricingInput" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "pricingOutput" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "pricingUnit" TEXT NOT NULL DEFAULT '1M_tokens',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AIModel_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RecipeVersion_recipeId_idx" ON "RecipeVersion"("recipeId");

-- CreateIndex
CREATE UNIQUE INDEX "RecipeVersion_recipeId_versionNumber_key" ON "RecipeVersion"("recipeId", "versionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "AIModel_modelId_key" ON "AIModel"("modelId");

-- CreateIndex
CREATE INDEX "AIModel_isEnabled_sortOrder_idx" ON "AIModel"("isEnabled", "sortOrder");

-- AddForeignKey
ALTER TABLE "RecipeVersion" ADD CONSTRAINT "RecipeVersion_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "Recipe"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipeVersion" ADD CONSTRAINT "RecipeVersion_changedBy_fkey" FOREIGN KEY ("changedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
