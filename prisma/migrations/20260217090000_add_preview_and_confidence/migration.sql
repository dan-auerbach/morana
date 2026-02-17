-- AlterTable
ALTER TABLE "RecipeExecution" ADD COLUMN "confidenceScore" INTEGER;
ALTER TABLE "RecipeExecution" ADD COLUMN "warningFlag" TEXT;
ALTER TABLE "RecipeExecution" ADD COLUMN "previewHash" TEXT;
ALTER TABLE "RecipeExecution" ADD COLUMN "previewUrl" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "RecipeExecution_previewHash_key" ON "RecipeExecution"("previewHash");
