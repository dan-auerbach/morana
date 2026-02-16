-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "webSearchEnabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "citationsJson" JSONB;
