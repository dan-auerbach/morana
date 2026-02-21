/**
 * Telegram Bot API utility library.
 *
 * Provides typed wrappers for Telegram Bot API calls:
 * - sendMessage / editMessage / sendChatAction
 * - getFile / downloadFile (for receiving user files)
 * - validateWebhookSecret (X-Telegram-Bot-Api-Secret-Token)
 * - resolveUser (TelegramLink → userId + workspaceId)
 */

import { NextRequest } from "next/server";
import { prisma } from "./prisma";
import { getActiveWorkspaceId } from "./workspace";

// ─── Config ──────────────────────────────────────────────────────────

function getBotToken(): string {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not configured");
  return token;
}

function apiUrl(method: string): string {
  return `https://api.telegram.org/bot${getBotToken()}/${method}`;
}

function fileUrl(filePath: string): string {
  return `https://api.telegram.org/file/bot${getBotToken()}/${filePath}`;
}

// ─── Types ───────────────────────────────────────────────────────────

export type TelegramUser = {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
};

export type TelegramChat = {
  id: number;
  type: "private" | "group" | "supergroup" | "channel";
};

export type TelegramPhotoSize = {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  file_size?: number;
};

export type TelegramAudio = {
  file_id: string;
  file_unique_id: string;
  duration: number;
  mime_type?: string;
  file_size?: number;
  file_name?: string;
};

export type TelegramVoice = {
  file_id: string;
  file_unique_id: string;
  duration: number;
  mime_type?: string;
  file_size?: number;
};

export type TelegramDocument = {
  file_id: string;
  file_unique_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
};

export type TelegramVideo = {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  duration: number;
  mime_type?: string;
  file_size?: number;
};

export type TelegramVideoNote = {
  file_id: string;
  file_unique_id: string;
  length: number;
  duration: number;
  file_size?: number;
};

export type TelegramMessage = {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  date: number;
  text?: string;
  caption?: string;
  audio?: TelegramAudio;
  voice?: TelegramVoice;
  document?: TelegramDocument;
  photo?: TelegramPhotoSize[];
  video?: TelegramVideo;
  video_note?: TelegramVideoNote;
};

export type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
};

// ─── API Calls ───────────────────────────────────────────────────────

/**
 * Send a text message to a Telegram chat.
 * Returns the message_id of the sent message.
 */
export async function sendMessage(
  chatId: string | number,
  text: string,
  parseMode: "Markdown" | "MarkdownV2" | "HTML" | null = "Markdown"
): Promise<number> {
  const body: Record<string, unknown> = {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
  };
  if (parseMode) body.parse_mode = parseMode;

  const resp = await fetch(apiUrl("sendMessage"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await resp.json();
  if (!data.ok) {
    console.error("[Telegram] sendMessage failed:", data.description);
    // Fallback: retry without parse mode in case of formatting errors
    if (parseMode) {
      return sendMessage(chatId, text, null);
    }
    return 0;
  }
  return data.result?.message_id || 0;
}

/**
 * Edit an existing Telegram message.
 */
export async function editMessage(
  chatId: string | number,
  messageId: number,
  text: string,
  parseMode: "Markdown" | "MarkdownV2" | "HTML" | null = "Markdown",
  disablePreview: boolean = true,
): Promise<boolean> {
  const body: Record<string, unknown> = {
    chat_id: chatId,
    message_id: messageId,
    text,
    disable_web_page_preview: disablePreview,
  };
  if (parseMode) body.parse_mode = parseMode;

  const resp = await fetch(apiUrl("editMessageText"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await resp.json();
  if (!data.ok) {
    console.error("[Telegram] editMessage failed:", data.description, `chatId=${chatId} msgId=${messageId}`);
    // Fallback: retry without parse mode
    if (parseMode) {
      return editMessage(chatId, messageId, text, null, disablePreview);
    }
    return false;
  }
  return true;
}

/**
 * Send "typing..." indicator to a chat.
 */
export async function sendTypingAction(chatId: string | number): Promise<void> {
  try {
    await fetch(apiUrl("sendChatAction"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, action: "typing" }),
    });
  } catch {
    // Non-critical, ignore
  }
}

// ─── File Handling ───────────────────────────────────────────────────

/**
 * Get file path from Telegram servers using file_id.
 */
export async function getFilePath(fileId: string): Promise<string | null> {
  const resp = await fetch(apiUrl("getFile"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_id: fileId }),
  });
  const data = await resp.json();
  if (!data.ok) {
    console.error("[Telegram] getFile failed:", data.description);
    return null;
  }
  return data.result?.file_path || null;
}

/**
 * Download a file from Telegram servers.
 * Returns the file content as a Buffer.
 */
export async function downloadFile(filePath: string): Promise<Buffer> {
  const resp = await fetch(fileUrl(filePath));
  if (!resp.ok) throw new Error(`Failed to download Telegram file: ${resp.status}`);
  const arrayBuffer = await resp.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Download a file by file_id in one step.
 * Returns { buffer, filePath } or null on error.
 */
export async function downloadFileById(fileId: string): Promise<{ buffer: Buffer; filePath: string } | null> {
  const filePath = await getFilePath(fileId);
  if (!filePath) return null;
  const buffer = await downloadFile(filePath);
  return { buffer, filePath };
}

// ─── Security ────────────────────────────────────────────────────────

/**
 * Validate the Telegram webhook secret token header.
 * Returns true if the secret matches.
 */
export function validateWebhookSecret(req: NextRequest): boolean {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[Telegram] TELEGRAM_WEBHOOK_SECRET is not configured");
    return false;
  }
  const headerSecret = req.headers.get("x-telegram-bot-api-secret-token");
  return headerSecret === secret;
}

// ─── User Resolution ─────────────────────────────────────────────────

export type ResolvedTelegramUser = {
  userId: string;
  workspaceId: string | null;
};

/**
 * Resolve a Telegram chat ID to a MORANA user + workspace.
 * Returns null if the chat is not linked.
 */
export async function resolveUser(chatId: string | number): Promise<ResolvedTelegramUser | null> {
  const link = await prisma.telegramLink.findUnique({
    where: { telegramChatId: String(chatId) },
    select: { userId: true },
  });
  if (!link) return null;

  const workspaceId = await getActiveWorkspaceId(link.userId);
  return { userId: link.userId, workspaceId };
}

// ─── Helpers ─────────────────────────────────────────────────────────

/**
 * Extract file_id from a Telegram message based on content type.
 * Returns { fileId, mimeType, type } or null.
 */
export function extractFileInfo(msg: TelegramMessage): {
  fileId: string;
  mimeType: string;
  type: "audio" | "image" | "video";
} | null {
  // Audio message
  if (msg.audio) {
    return {
      fileId: msg.audio.file_id,
      mimeType: msg.audio.mime_type || "audio/mpeg",
      type: "audio",
    };
  }

  // Voice note
  if (msg.voice) {
    return {
      fileId: msg.voice.file_id,
      mimeType: msg.voice.mime_type || "audio/ogg",
      type: "audio",
    };
  }

  // Video message
  if (msg.video) {
    return {
      fileId: msg.video.file_id,
      mimeType: msg.video.mime_type || "video/mp4",
      type: "video",
    };
  }

  // Video note (round video)
  if (msg.video_note) {
    return {
      fileId: msg.video_note.file_id,
      mimeType: "video/mp4",
      type: "video",
    };
  }

  // Document (check if it's audio, video, or image)
  if (msg.document) {
    const mime = (msg.document.mime_type || "").toLowerCase();
    if (mime.startsWith("audio/")) {
      return { fileId: msg.document.file_id, mimeType: mime, type: "audio" };
    }
    if (mime.startsWith("video/")) {
      return { fileId: msg.document.file_id, mimeType: mime, type: "video" };
    }
    if (mime.startsWith("image/")) {
      return { fileId: msg.document.file_id, mimeType: mime, type: "image" };
    }
  }

  // Photo (array of sizes — pick largest)
  if (msg.photo && msg.photo.length > 0) {
    const largest = msg.photo[msg.photo.length - 1];
    return {
      fileId: largest.file_id,
      mimeType: "image/jpeg", // Telegram compresses photos to JPEG
      type: "image",
    };
  }

  return null;
}

/**
 * Parse a command from message text.
 * Returns { command, args } or null if not a command.
 * E.g. "/run novinar-auto-1 Hello" → { command: "run", args: "novinar-auto-1 Hello" }
 */
export function parseCommand(text: string): { command: string; args: string } | null {
  // Match /command[@botname] [args...] — use [\s\S]* instead of /s flag for compat
  const match = text.trim().match(/^\/(\w+)(?:@\w+)?\s*([\s\S]*)?$/);
  if (!match) return null;
  return { command: match[1].toLowerCase(), args: (match[2] || "").trim() };
}

// ─── Media Sending ────────────────────────────────────────────────────

/**
 * Send a chat action indicator (typing, upload_audio, upload_photo, etc.)
 */
export async function sendChatAction(
  chatId: string | number,
  action: "typing" | "upload_audio" | "upload_photo" | "upload_video" | "upload_document"
): Promise<void> {
  try {
    await fetch(apiUrl("sendChatAction"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, action }),
    });
  } catch {
    // Non-critical
  }
}

/**
 * Send a voice message (OGG opus, displayed as voice bubble in Telegram).
 */
export async function sendVoice(
  chatId: string | number,
  buffer: Buffer,
  caption?: string,
  duration?: number,
  parseMode: "Markdown" | "HTML" | null = "Markdown"
): Promise<number> {
  const form = new FormData();
  form.append("chat_id", String(chatId));
  form.append("voice", new Blob([new Uint8Array(buffer)], { type: "audio/ogg" }), "voice.ogg");
  if (caption) form.append("caption", caption);
  if (duration) form.append("duration", String(duration));
  if (parseMode) form.append("parse_mode", parseMode);

  const resp = await fetch(apiUrl("sendVoice"), { method: "POST", body: form });
  const data = await resp.json();
  if (!data.ok) {
    console.error("[Telegram] sendVoice failed:", data.description);
    return 0;
  }
  return data.result?.message_id || 0;
}

/**
 * Send an audio file to a Telegram chat.
 */
export async function sendAudio(
  chatId: string | number,
  buffer: Buffer,
  filename: string,
  caption?: string,
  duration?: number,
  parseMode: "Markdown" | "HTML" | null = "Markdown"
): Promise<number> {
  const form = new FormData();
  form.append("chat_id", String(chatId));
  form.append("audio", new Blob([new Uint8Array(buffer)]), filename);
  if (caption) form.append("caption", caption);
  if (duration) form.append("duration", String(duration));
  if (parseMode) form.append("parse_mode", parseMode);

  const resp = await fetch(apiUrl("sendAudio"), { method: "POST", body: form });
  const data = await resp.json();
  if (!data.ok) {
    console.error("[Telegram] sendAudio failed:", data.description);
    return 0;
  }
  return data.result?.message_id || 0;
}

/**
 * Send a photo from a buffer.
 */
export async function sendPhoto(
  chatId: string | number,
  buffer: Buffer,
  filename: string,
  caption?: string,
  parseMode: "Markdown" | "HTML" | null = "Markdown"
): Promise<number> {
  const form = new FormData();
  form.append("chat_id", String(chatId));
  form.append("photo", new Blob([new Uint8Array(buffer)]), filename);
  if (caption) form.append("caption", caption);
  if (parseMode) form.append("parse_mode", parseMode);

  const resp = await fetch(apiUrl("sendPhoto"), { method: "POST", body: form });
  const data = await resp.json();
  if (!data.ok) {
    console.error("[Telegram] sendPhoto failed:", data.description);
    return 0;
  }
  return data.result?.message_id || 0;
}

/**
 * Split long text into Telegram-safe chunks (max 4096 chars).
 * Splits at newline boundaries when possible.
 */
export function splitMessage(text: string, maxLen = 4096): string[] {
  if (text.length <= maxLen) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }

    // Try to split at a newline within the last 20% of the chunk
    let splitAt = remaining.lastIndexOf("\n", maxLen);
    if (splitAt < maxLen * 0.8) {
      // No good newline break — split at space
      splitAt = remaining.lastIndexOf(" ", maxLen);
    }
    if (splitAt <= 0) {
      // No good break point — hard split
      splitAt = maxLen;
    }

    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).replace(/^\n/, ""); // trim leading newline
  }

  return chunks;
}

/**
 * Send a long message, automatically splitting into multiple messages if needed.
 * Returns array of message IDs.
 */
export async function sendLongMessage(
  chatId: string | number,
  text: string,
  parseMode: "Markdown" | "MarkdownV2" | "HTML" | null = "Markdown"
): Promise<number[]> {
  const chunks = splitMessage(text);
  const ids: number[] = [];
  for (const chunk of chunks) {
    const id = await sendMessage(chatId, chunk, parseMode);
    ids.push(id);
  }
  return ids;
}
