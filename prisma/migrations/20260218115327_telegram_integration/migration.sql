-- CreateTable
CREATE TABLE "TelegramLink" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "telegramChatId" TEXT NOT NULL,
    "telegramUsername" TEXT,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TelegramLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TelegramLinkCode" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TelegramLinkCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TelegramExecutionMap" (
    "id" TEXT NOT NULL,
    "executionId" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "messageId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TelegramExecutionMap_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TelegramLink_userId_key" ON "TelegramLink"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "TelegramLink_telegramChatId_key" ON "TelegramLink"("telegramChatId");

-- CreateIndex
CREATE UNIQUE INDEX "TelegramLinkCode_code_key" ON "TelegramLinkCode"("code");

-- CreateIndex
CREATE INDEX "TelegramLinkCode_code_idx" ON "TelegramLinkCode"("code");

-- CreateIndex
CREATE INDEX "TelegramLinkCode_expiresAt_idx" ON "TelegramLinkCode"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "TelegramExecutionMap_executionId_key" ON "TelegramExecutionMap"("executionId");

-- CreateIndex
CREATE INDEX "TelegramExecutionMap_executionId_idx" ON "TelegramExecutionMap"("executionId");

-- AddForeignKey
ALTER TABLE "TelegramLink" ADD CONSTRAINT "TelegramLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelegramLinkCode" ADD CONSTRAINT "TelegramLinkCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelegramExecutionMap" ADD CONSTRAINT "TelegramExecutionMap_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "RecipeExecution"("id") ON DELETE CASCADE ON UPDATE CASCADE;
