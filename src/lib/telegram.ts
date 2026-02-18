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
  parseMode: "Markdown" | "MarkdownV2" | "HTML" | null = "Markdown"
): Promise<boolean> {
  const body: Record<string, unknown> = {
    chat_id: chatId,
    message_id: messageId,
    text,
    disable_web_page_preview: true,
  };
  if (parseMode) body.parse_mode = parseMode;

  const resp = await fetch(apiUrl("editMessageText"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await resp.json();
  if (!data.ok) {
    console.error("[Telegram] editMessage failed:", data.description);
    // Fallback: retry without parse mode
    if (parseMode) {
      return editMessage(chatId, messageId, text, null);
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
  type: "audio" | "image";
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

  // Document (check if it's audio or image)
  if (msg.document) {
    const mime = (msg.document.mime_type || "").toLowerCase();
    if (mime.startsWith("audio/")) {
      return { fileId: msg.document.file_id, mimeType: mime, type: "audio" };
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
