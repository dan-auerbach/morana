/**
 * Per-user Telegram bot settings.
 *
 * Each linked Telegram user can configure their preferred mode
 * (STT / LLM / recipe), STT options, TTS voice, LLM model, etc.
 */

import { prisma } from "./prisma";

// ─── Types ──────────────────────────────────────────────────────────

export type TgMode = "stt" | "llm" | "recipe";

export type TgSettings = {
  mode: TgMode;
  sttLanguage: string;
  sttDiarize: boolean;
  sttTranslateTo: string | null;
  ttsVoiceId: string | null;
  llmModelId: string | null;
  llmSystemPrompt: string | null;
  imageProvider: "gemini" | "fal";
};

const DEFAULTS: TgSettings = {
  mode: "stt",
  sttLanguage: "sl",
  sttDiarize: false,
  sttTranslateTo: null,
  ttsVoiceId: null,
  llmModelId: null,
  llmSystemPrompt: null,
  imageProvider: "gemini",
};

// ─── Functions ──────────────────────────────────────────────────────

/**
 * Get settings for a user, creating defaults if none exist.
 */
export async function getSettings(userId: string): Promise<TgSettings> {
  const row = await prisma.telegramUserSettings.findUnique({
    where: { userId },
  });

  if (!row) return { ...DEFAULTS };

  return {
    mode: (row.mode as TgMode) || DEFAULTS.mode,
    sttLanguage: row.sttLanguage || DEFAULTS.sttLanguage,
    sttDiarize: row.sttDiarize,
    sttTranslateTo: row.sttTranslateTo,
    ttsVoiceId: row.ttsVoiceId,
    llmModelId: row.llmModelId,
    llmSystemPrompt: row.llmSystemPrompt,
    imageProvider: (row.imageProvider as "gemini" | "fal") || DEFAULTS.imageProvider,
  };
}

/**
 * Update settings for a user (upsert).
 */
export async function updateSettings(
  userId: string,
  updates: Partial<TgSettings>
): Promise<TgSettings> {
  const data: Record<string, unknown> = {};
  if (updates.mode !== undefined) data.mode = updates.mode;
  if (updates.sttLanguage !== undefined) data.sttLanguage = updates.sttLanguage;
  if (updates.sttDiarize !== undefined) data.sttDiarize = updates.sttDiarize;
  if (updates.sttTranslateTo !== undefined) data.sttTranslateTo = updates.sttTranslateTo;
  if (updates.ttsVoiceId !== undefined) data.ttsVoiceId = updates.ttsVoiceId;
  if (updates.llmModelId !== undefined) data.llmModelId = updates.llmModelId;
  if (updates.llmSystemPrompt !== undefined) data.llmSystemPrompt = updates.llmSystemPrompt;
  if (updates.imageProvider !== undefined) data.imageProvider = updates.imageProvider;

  await prisma.telegramUserSettings.upsert({
    where: { userId },
    create: { userId, ...DEFAULTS, ...data },
    update: data,
  });

  return getSettings(userId);
}
