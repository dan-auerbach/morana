-- AlterTable
ALTER TABLE "Recipe" ADD COLUMN     "defaultLang" TEXT,
ADD COLUMN     "inputKind" TEXT NOT NULL DEFAULT 'text',
ADD COLUMN     "inputModes" JSONB,
ADD COLUMN     "uiHints" JSONB;

-- Update NOVINAR preset with audio input config
UPDATE "Recipe"
SET "inputKind" = 'audio',
    "inputModes" = '["file","url","text"]'::jsonb,
    "defaultLang" = 'sl',
    "uiHints" = '{"acceptAudio":"audio/mpeg,audio/mp3,audio/wav,audio/ogg,audio/flac,audio/m4a,audio/aac,audio/webm","maxFileSizeMB":100}'::jsonb
WHERE "presetKey" = 'novinar';
