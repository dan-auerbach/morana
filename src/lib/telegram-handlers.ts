/**
 * Direct AI module handlers for Telegram bot.
 *
 * Each handler: validates module access, sends typing/upload action,
 * calls the AI provider, logs usage, creates Run records, sends result.
 */

import { v4 as uuid } from "uuid";
import { prisma } from "./prisma";
import { Prisma } from "@/generated/prisma/client";
import {
  type ResolvedTelegramUser,
  type TelegramMessage,
  sendChatAction,
  sendLongMessage,
  sendVoice,
  sendPhoto,
  sendMessage,
  downloadFileById,
} from "./telegram";
import { type TgSettings } from "./telegram-settings";
import { runSTT } from "./providers/stt";
import { runTTS, listVoices } from "./providers/tts";
import { runLLMChat, type ChatMessage, type ImageAttachment } from "./providers/llm";
import { runImageGeneration } from "./providers/image";
import { getApprovedModelsAsync, type ModelEntry } from "./config";
import { logUsage } from "./usage";
import { isModuleAllowed } from "./rate-limit";
import { uploadToR2, getSignedDownloadUrl, deleteFromR2 } from "./storage";
import { detectMimeFromBytes } from "./mime-validate";

// ─── handleDirectSTT ──────────────────────────────────────────────────

export async function handleDirectSTT(
  chatId: string,
  fileInfo: { fileId: string; mimeType: string; type: "audio" | "video" },
  resolved: ResolvedTelegramUser,
  settings: TgSettings
): Promise<void> {
  // Check module access
  if (!(await isModuleAllowed(resolved.userId, "stt"))) {
    await sendMessage(chatId, "Nimas dostopa do STT modula.", null);
    return;
  }

  await sendChatAction(chatId, "typing");

  // Download file from Telegram
  const fileData = await downloadFileById(fileInfo.fileId);
  if (!fileData) {
    await sendMessage(chatId, "Napaka pri prenosu datoteke iz Telegrama.", null);
    return;
  }

  // Detect MIME
  const detectedMime = detectMimeFromBytes(fileData.buffer);
  const effectiveMime = detectedMime || fileInfo.mimeType;

  // Upload to R2 for STT (needs a URL)
  const ext = fileData.filePath.split(".").pop() || "bin";
  const storageKey = `telegram/stt/${uuid()}.${ext}`;
  await uploadToR2(storageKey, fileData.buffer, effectiveMime, fileData.buffer.length);

  // Create Run record
  const run = await prisma.run.create({
    data: {
      userId: resolved.userId,
      workspaceId: resolved.workspaceId,
      type: "stt",
      status: "running",
      provider: "soniox",
      model: "stt-async-v4",
    },
  });

  await prisma.runInput.create({
    data: {
      runId: run.id,
      payloadJson: {
        storageKey,
        mimeType: effectiveMime,
        language: settings.sttLanguage,
        diarize: settings.sttDiarize,
        translateTo: settings.sttTranslateTo,
        source: "telegram",
      } as unknown as Prisma.InputJsonValue,
    },
  });

  try {
    const audioUrl = await getSignedDownloadUrl(storageKey, 600);

    const result = await runSTT(
      { audioUrl },
      {
        language: settings.sttLanguage,
        diarize: settings.sttDiarize,
        translateTo: settings.sttTranslateTo || undefined,
      }
    );

    // Log usage
    await logUsage({
      runId: run.id,
      userId: resolved.userId,
      provider: "soniox",
      model: "stt-async-v4",
      units: { seconds: result.durationSeconds },
      latencyMs: result.latencyMs,
      workspaceId: resolved.workspaceId,
    });

    // Format result
    const lines: string[] = [];
    lines.push(`*Transkripcija* (${formatDuration(result.durationSeconds)})`);
    lines.push("");

    if (settings.sttDiarize && result.tokens?.some((t) => t.speaker)) {
      // Format with speaker labels
      const segments = groupBySpeaker(result.tokens || []);
      for (const seg of segments) {
        lines.push(`*${seg.speaker}:* ${seg.text}`);
      }
    } else {
      lines.push(result.text);
    }

    if (result.translatedText) {
      lines.push("");
      lines.push(`*Prevod (${settings.sttTranslateTo}):*`);
      lines.push(result.translatedText);
    }

    // Save output
    await prisma.runOutput.create({
      data: {
        runId: run.id,
        payloadJson: {
          text: result.text,
          durationSeconds: result.durationSeconds,
          translatedText: result.translatedText,
        } as unknown as Prisma.InputJsonValue,
      },
    });

    await prisma.run.update({
      where: { id: run.id },
      data: { status: "done", finishedAt: new Date() },
    });

    await sendLongMessage(chatId, lines.join("\n"));
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[Telegram STT] Error:", errMsg);

    await prisma.run.update({
      where: { id: run.id },
      data: { status: "error", errorMessage: errMsg, finishedAt: new Date() },
    });

    await sendMessage(chatId, `Napaka pri transkripciji: ${errMsg}`, null);
  } finally {
    deleteFromR2(storageKey);
  }
}

// ─── handleDirectTTS ──────────────────────────────────────────────────

export async function handleDirectTTS(
  chatId: string,
  text: string,
  resolved: ResolvedTelegramUser,
  settings: TgSettings
): Promise<void> {
  if (!(await isModuleAllowed(resolved.userId, "tts"))) {
    await sendMessage(chatId, "Nimas dostopa do TTS modula.", null);
    return;
  }

  if (!text.trim()) {
    await sendMessage(chatId, "Vnesi besedilo za sintezo: `/tts Tvoje besedilo`");
    return;
  }

  await sendChatAction(chatId, "upload_audio");

  // Resolve voice
  let voiceId = settings.ttsVoiceId;
  if (!voiceId) {
    const voices = await listVoices();
    if (voices.length === 0) {
      await sendMessage(chatId, "Ni konfiguriraneh glasov za TTS.", null);
      return;
    }
    voiceId = voices[0].id;
  }

  // Create Run
  const run = await prisma.run.create({
    data: {
      userId: resolved.userId,
      workspaceId: resolved.workspaceId,
      type: "tts",
      status: "running",
      provider: "elevenlabs",
      model: "eleven_v3",
    },
  });

  await prisma.runInput.create({
    data: {
      runId: run.id,
      payloadJson: {
        text,
        voiceId,
        language: settings.sttLanguage,
        source: "telegram",
      } as unknown as Prisma.InputJsonValue,
    },
  });

  try {
    const result = await runTTS(text, voiceId, {
      languageCode: settings.sttLanguage,
    });

    await logUsage({
      runId: run.id,
      userId: resolved.userId,
      provider: "elevenlabs",
      model: "eleven_v3",
      units: { chars: result.chars },
      latencyMs: result.latencyMs,
      workspaceId: resolved.workspaceId,
    });

    await prisma.runOutput.create({
      data: {
        runId: run.id,
        payloadJson: {
          chars: result.chars,
          mimeType: result.mimeType,
        } as unknown as Prisma.InputJsonValue,
      },
    });

    await prisma.run.update({
      where: { id: run.id },
      data: { status: "done", finishedAt: new Date() },
    });

    await sendVoice(chatId, result.audioBuffer, `TTS (${result.chars} znakov)`);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[Telegram TTS] Error:", errMsg);

    await prisma.run.update({
      where: { id: run.id },
      data: { status: "error", errorMessage: errMsg, finishedAt: new Date() },
    });

    await sendMessage(chatId, `Napaka pri sintezi govora: ${errMsg}`, null);
  }
}

// ─── handleDirectLLM ──────────────────────────────────────────────────

export async function handleDirectLLM(
  chatId: string,
  text: string,
  resolved: ResolvedTelegramUser,
  settings: TgSettings,
  msg?: TelegramMessage
): Promise<void> {
  if (!(await isModuleAllowed(resolved.userId, "llm"))) {
    await sendMessage(chatId, "Nimas dostopa do LLM modula.", null);
    return;
  }

  await sendChatAction(chatId, "typing");

  // Resolve model
  const models = await getApprovedModelsAsync();
  let modelEntry: ModelEntry | undefined;
  if (settings.llmModelId) {
    modelEntry = models.find((m) => m.id === settings.llmModelId);
  }
  if (!modelEntry) {
    modelEntry = models[0];
  }
  if (!modelEntry) {
    await sendMessage(chatId, "Ni konfiguriraneh LLM modelov.", null);
    return;
  }

  // Load or create conversation
  const convTitle = `telegram:${chatId}:${resolved.userId}`;
  let conversation = await prisma.conversation.findFirst({
    where: { userId: resolved.userId, title: convTitle },
    include: { messages: { orderBy: { createdAt: "asc" }, take: 40 } },
  });

  if (!conversation) {
    conversation = await prisma.conversation.create({
      data: {
        userId: resolved.userId,
        workspaceId: resolved.workspaceId,
        title: convTitle,
        modelId: modelEntry.id,
      },
      include: { messages: { orderBy: { createdAt: "asc" }, take: 40 } },
    });
  }

  // Build images array if photo attached
  let images: ImageAttachment[] | undefined;
  if (msg?.photo && msg.photo.length > 0) {
    const largest = msg.photo[msg.photo.length - 1];
    const photoData = await downloadFileById(largest.file_id);
    if (photoData) {
      const base64 = photoData.buffer.toString("base64");
      images = [{ base64, mimeType: "image/jpeg" }];
    }
  }

  // Save user message to conversation
  await prisma.message.create({
    data: {
      conversationId: conversation.id,
      role: "user",
      content: text,
    },
  });

  // Build chat messages from history (last 20 message pairs)
  const historyMessages = conversation.messages.slice(-20);
  const chatMessages: ChatMessage[] = historyMessages.map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));
  // Add current message
  const currentMsg: ChatMessage = { role: "user", content: text };
  if (images) currentMsg.images = images;
  chatMessages.push(currentMsg);

  // Create Run
  const run = await prisma.run.create({
    data: {
      userId: resolved.userId,
      workspaceId: resolved.workspaceId,
      type: "llm",
      status: "running",
      provider: modelEntry.provider,
      model: modelEntry.id,
    },
  });

  await prisma.runInput.create({
    data: {
      runId: run.id,
      payloadJson: {
        text,
        hasImages: !!images,
        modelId: modelEntry.id,
        source: "telegram",
      } as unknown as Prisma.InputJsonValue,
    },
  });

  try {
    const result = await runLLMChat(
      modelEntry,
      chatMessages,
      settings.llmSystemPrompt || undefined
    );

    // Save assistant message
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: "assistant",
        content: result.text,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        latencyMs: result.latencyMs,
        runId: run.id,
      },
    });

    await logUsage({
      runId: run.id,
      userId: resolved.userId,
      provider: modelEntry.provider,
      model: modelEntry.id,
      units: {
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
      },
      latencyMs: result.latencyMs,
      workspaceId: resolved.workspaceId,
    });

    await prisma.runOutput.create({
      data: {
        runId: run.id,
        payloadJson: {
          text: result.text,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          responseId: result.responseId,
        } as unknown as Prisma.InputJsonValue,
      },
    });

    await prisma.run.update({
      where: { id: run.id },
      data: { status: "done", finishedAt: new Date() },
    });

    await sendLongMessage(chatId, result.text);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[Telegram LLM] Error:", errMsg);

    await prisma.run.update({
      where: { id: run.id },
      data: { status: "error", errorMessage: errMsg, finishedAt: new Date() },
    });

    await sendMessage(chatId, `Napaka pri LLM: ${errMsg}`, null);
  }
}

// ─── handleDirectImage ────────────────────────────────────────────────

export async function handleDirectImage(
  chatId: string,
  prompt: string,
  resolved: ResolvedTelegramUser,
  settings: TgSettings
): Promise<void> {
  if (!(await isModuleAllowed(resolved.userId, "image"))) {
    await sendMessage(chatId, "Nimas dostopa do Image modula.", null);
    return;
  }

  if (!prompt.trim()) {
    await sendMessage(chatId, "Vnesi opis slike: `/image opis slike`");
    return;
  }

  await sendChatAction(chatId, "upload_photo");

  const run = await prisma.run.create({
    data: {
      userId: resolved.userId,
      workspaceId: resolved.workspaceId,
      type: "image",
      status: "running",
      provider: settings.imageProvider,
      model: settings.imageProvider === "gemini" ? "gemini-2.5-flash-image" : "fal-ai/flux/schnell",
    },
  });

  await prisma.runInput.create({
    data: {
      runId: run.id,
      payloadJson: {
        prompt,
        provider: settings.imageProvider,
        source: "telegram",
      } as unknown as Prisma.InputJsonValue,
    },
  });

  try {
    const result = await runImageGeneration(prompt);

    await logUsage({
      runId: run.id,
      userId: resolved.userId,
      provider: settings.imageProvider,
      model: settings.imageProvider === "gemini" ? "gemini-2.5-flash-image" : "fal-ai/flux/schnell",
      units: { images: 1 },
      latencyMs: result.latencyMs,
      workspaceId: resolved.workspaceId,
    });

    if (!result.imageBase64) {
      // Text-only response (model declined image)
      await prisma.runOutput.create({
        data: {
          runId: run.id,
          payloadJson: { text: result.text } as unknown as Prisma.InputJsonValue,
        },
      });

      await prisma.run.update({
        where: { id: run.id },
        data: { status: "done", finishedAt: new Date() },
      });

      await sendMessage(chatId, result.text || "Model ni generiral slike.", null);
      return;
    }

    const buffer = Buffer.from(result.imageBase64, "base64");
    const ext = result.mimeType === "image/png" ? "png" : "jpg";

    await prisma.runOutput.create({
      data: {
        runId: run.id,
        payloadJson: {
          mimeType: result.mimeType,
          sizeBytes: buffer.length,
        } as unknown as Prisma.InputJsonValue,
      },
    });

    await prisma.run.update({
      where: { id: run.id },
      data: { status: "done", finishedAt: new Date() },
    });

    await sendPhoto(chatId, buffer, `image.${ext}`, prompt);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[Telegram Image] Error:", errMsg);

    await prisma.run.update({
      where: { id: run.id },
      data: { status: "error", errorMessage: errMsg, finishedAt: new Date() },
    });

    await sendMessage(chatId, `Napaka pri generiranju slike: ${errMsg}`, null);
  }
}

// ─── handleTranscribeAndChat ──────────────────────────────────────────

export async function handleTranscribeAndChat(
  chatId: string,
  fileInfo: { fileId: string; mimeType: string; type: "audio" | "video" },
  resolved: ResolvedTelegramUser,
  settings: TgSettings
): Promise<void> {
  // Check both modules
  if (!(await isModuleAllowed(resolved.userId, "stt"))) {
    await sendMessage(chatId, "Nimas dostopa do STT modula.", null);
    return;
  }
  if (!(await isModuleAllowed(resolved.userId, "llm"))) {
    await sendMessage(chatId, "Nimas dostopa do LLM modula.", null);
    return;
  }

  await sendChatAction(chatId, "typing");

  // Download file
  const fileData = await downloadFileById(fileInfo.fileId);
  if (!fileData) {
    await sendMessage(chatId, "Napaka pri prenosu datoteke.", null);
    return;
  }

  const detectedMime = detectMimeFromBytes(fileData.buffer);
  const effectiveMime = detectedMime || fileInfo.mimeType;
  const ext = fileData.filePath.split(".").pop() || "bin";
  const storageKey = `telegram/stt/${uuid()}.${ext}`;
  await uploadToR2(storageKey, fileData.buffer, effectiveMime, fileData.buffer.length);

  try {
    // Step 1: STT
    const audioUrl = await getSignedDownloadUrl(storageKey, 600);
    const sttResult = await runSTT(
      { audioUrl },
      {
        language: settings.sttLanguage,
        diarize: settings.sttDiarize,
        translateTo: settings.sttTranslateTo || undefined,
      }
    );

    // Log STT usage
    const sttRun = await prisma.run.create({
      data: {
        userId: resolved.userId,
        workspaceId: resolved.workspaceId,
        type: "stt",
        status: "done",
        provider: "soniox",
        model: "stt-async-v4",
        finishedAt: new Date(),
      },
    });

    await logUsage({
      runId: sttRun.id,
      userId: resolved.userId,
      provider: "soniox",
      model: "stt-async-v4",
      units: { seconds: sttResult.durationSeconds },
      latencyMs: sttResult.latencyMs,
      workspaceId: resolved.workspaceId,
    });

    // Send transcript
    const transcriptText = sttResult.text;
    await sendLongMessage(
      chatId,
      `*Transkripcija* (${formatDuration(sttResult.durationSeconds)}):\n\n${transcriptText}`
    );

    // Step 2: Feed to LLM
    await sendChatAction(chatId, "typing");
    await handleDirectLLM(chatId, transcriptText, resolved, settings);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[Telegram Transcribe+Chat] Error:", errMsg);
    await sendMessage(chatId, `Napaka: ${errMsg}`, null);
  } finally {
    deleteFromR2(storageKey);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  if (m === 0) return `${s}s`;
  return `${m}m ${s}s`;
}

type SpeakerSegment = { speaker: string; text: string };

function groupBySpeaker(
  tokens: { text: string; speaker?: string }[]
): SpeakerSegment[] {
  const segments: SpeakerSegment[] = [];
  let current: SpeakerSegment | null = null;

  for (const t of tokens) {
    const speaker = t.speaker || "Speaker";
    if (!current || current.speaker !== speaker) {
      if (current) segments.push(current);
      current = { speaker, text: t.text };
    } else {
      current.text += t.text;
    }
  }
  if (current) segments.push(current);
  return segments;
}
