/**
 * Telegram inline keyboard builders for the settings panel.
 *
 * Pure functions — no DB calls, no side effects.
 * Builds inline keyboards and text for settings, model picker, and voice picker.
 */

import type { InlineKeyboardButton, InlineKeyboardMarkup } from "./telegram";
import type { TgSettings } from "./telegram-settings";
import type { ModelEntry } from "./config";
import type { Voice } from "./providers/tts";

// ─── Callback Data Encoding ─────────────────────────────────────────

/**
 * Callback data format: `{domain}:{action}:{value?}`
 * Max 64 bytes (Telegram limit).
 */
export function encodeCallback(domain: string, action: string, value?: string): string {
  const raw = value ? `${domain}:${action}:${value}` : `${domain}:${action}`;
  if (new TextEncoder().encode(raw).length > 64) {
    throw new Error(`Callback data exceeds 64 bytes: ${raw}`);
  }
  return raw;
}

export function parseCallback(raw: string | undefined): { domain: string; action: string; value?: string } | null {
  if (!raw) return null;
  const parts = raw.split(":");
  if (parts.length < 2) return null;
  return {
    domain: parts[0],
    action: parts[1],
    value: parts.slice(2).join(":") || undefined,
  };
}

// ─── Button Helpers ──────────────────────────────────────────────────

function btn(text: string, callbackData: string): InlineKeyboardButton {
  return { text, callback_data: callbackData };
}

function check(label: string, isActive: boolean): string {
  return isActive ? `${label} \u2705` : label;
}

// ─── Settings Keyboard ──────────────────────────────────────────────

const ITEMS_PER_PAGE = 6;

export function buildSettingsKeyboard(settings: TgSettings): InlineKeyboardMarkup {
  const mode = settings.mode;
  const lang = settings.sttLanguage;
  const translateTo = settings.sttTranslateTo;
  const imgProvider = settings.imageProvider;

  return {
    inline_keyboard: [
      // Row 1: Mode
      [
        btn(check("STT", mode === "stt"), encodeCallback("mode", "set", "stt")),
        btn(check("LLM", mode === "llm"), encodeCallback("mode", "set", "llm")),
        btn(check("Recipe", mode === "recipe"), encodeCallback("mode", "set", "recipe")),
      ],
      // Row 2: Model & Voice sub-panels
      [
        btn("Model\u2026", encodeCallback("model", "page", "0")),
        btn("Voice\u2026", encodeCallback("voice", "page", "0")),
      ],
      // Row 3: STT language
      [
        btn(check("Auto", lang === "auto"), encodeCallback("lang", "set", "auto")),
        btn(check("Sloven\u0161\u010dina", lang === "sl"), encodeCallback("lang", "set", "sl")),
        btn(check("English", lang === "en"), encodeCallback("lang", "set", "en")),
      ],
      // Row 4: Toggles
      [
        btn(`Diarize: ${settings.sttDiarize ? "ON" : "OFF"}`, encodeCallback("diarize", "toggle")),
        btn(`Translate: ${translateTo || "OFF"}`, encodeCallback("translate", "cycle")),
      ],
      // Row 5: Translation target
      [
        btn(check("EN", translateTo === "en"), encodeCallback("translate", "set", "en")),
        btn(check("SL", translateTo === "sl"), encodeCallback("translate", "set", "sl")),
        btn(check("OFF", !translateTo), encodeCallback("translate", "set", "off")),
      ],
      // Row 6: Image provider
      [
        btn(check("Gemini", imgProvider === "gemini"), encodeCallback("image", "set", "gemini")),
        btn(check("FAL", imgProvider === "fal"), encodeCallback("image", "set", "fal")),
      ],
    ],
  };
}

// ─── Model Keyboard (paginated) ──────────────────────────────────────

export function buildModelKeyboard(
  models: ModelEntry[],
  currentId: string | null,
  page: number
): InlineKeyboardMarkup {
  const totalPages = Math.max(1, Math.ceil(models.length / ITEMS_PER_PAGE));
  const safePage = Math.min(page, totalPages - 1);
  const start = safePage * ITEMS_PER_PAGE;
  const pageModels = models.slice(start, start + ITEMS_PER_PAGE);

  const rows: InlineKeyboardButton[][] = [];

  // 2 columns per row
  for (let i = 0; i < pageModels.length; i += 2) {
    const row: InlineKeyboardButton[] = [];
    for (let j = i; j < Math.min(i + 2, pageModels.length); j++) {
      const m = pageModels[j];
      const label = check(m.label, m.id === currentId);
      row.push(btn(label, encodeCallback("model", "pick", m.id)));
    }
    rows.push(row);
  }

  // Pagination row
  if (totalPages > 1) {
    const navRow: InlineKeyboardButton[] = [];
    if (safePage > 0) {
      navRow.push(btn("\u25C0 Prev", encodeCallback("model", "page", String(safePage - 1))));
    }
    navRow.push(btn(`${safePage + 1}/${totalPages}`, encodeCallback("model", "page", String(safePage))));
    if (safePage < totalPages - 1) {
      navRow.push(btn("Next \u25B6", encodeCallback("model", "page", String(safePage + 1))));
    }
    rows.push(navRow);
  }

  // Back button
  rows.push([btn("\u2190 Back to Settings", encodeCallback("nav", "settings"))]);

  return { inline_keyboard: rows };
}

// ─── Voice Keyboard (paginated) ──────────────────────────────────────

export function buildVoiceKeyboard(
  voices: Voice[],
  currentId: string | null,
  page: number
): InlineKeyboardMarkup {
  const totalPages = Math.max(1, Math.ceil(voices.length / ITEMS_PER_PAGE));
  const safePage = Math.min(page, totalPages - 1);
  const start = safePage * ITEMS_PER_PAGE;
  const pageVoices = voices.slice(start, start + ITEMS_PER_PAGE);

  const rows: InlineKeyboardButton[][] = [];

  // 2 columns per row
  for (let i = 0; i < pageVoices.length; i += 2) {
    const row: InlineKeyboardButton[] = [];
    for (let j = i; j < Math.min(i + 2, pageVoices.length); j++) {
      const v = pageVoices[j];
      const label = check(v.name, v.id === currentId);
      row.push(btn(label, encodeCallback("voice", "pick", v.id)));
    }
    rows.push(row);
  }

  // Pagination row
  if (totalPages > 1) {
    const navRow: InlineKeyboardButton[] = [];
    if (safePage > 0) {
      navRow.push(btn("\u25C0 Prev", encodeCallback("voice", "page", String(safePage - 1))));
    }
    navRow.push(btn(`${safePage + 1}/${totalPages}`, encodeCallback("voice", "page", String(safePage))));
    if (safePage < totalPages - 1) {
      navRow.push(btn("Next \u25B6", encodeCallback("voice", "page", String(safePage + 1))));
    }
    rows.push(navRow);
  }

  // Back button
  rows.push([btn("\u2190 Back to Settings", encodeCallback("nav", "settings"))]);

  return { inline_keyboard: rows };
}

// ─── Text Builders (HTML) ────────────────────────────────────────────

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function buildSettingsText(settings: TgSettings): string {
  const lines = [
    "<b>Nastavitve</b>",
    "",
    `<b>Nacin:</b> ${settings.mode.toUpperCase()}`,
    `<b>Jezik STT:</b> ${escapeHtml(settings.sttLanguage)}`,
    `<b>Diarizacija:</b> ${settings.sttDiarize ? "DA" : "NE"}`,
    `<b>Prevod:</b> ${settings.sttTranslateTo || "izklopljeno"}`,
    `<b>TTS glas:</b> ${escapeHtml(settings.ttsVoiceId || "privzeti")}`,
    `<b>LLM model:</b> ${escapeHtml(settings.llmModelId || "privzeti")}`,
    `<b>Image:</b> ${settings.imageProvider}`,
  ];
  return lines.join("\n");
}

export function buildModelListText(currentModelId: string | null): string {
  const lines = [
    "<b>Izberi LLM model</b>",
    "",
    `Trenutni: <code>${escapeHtml(currentModelId || "privzeti")}</code>`,
  ];
  return lines.join("\n");
}

export function buildVoiceListText(currentVoiceId: string | null): string {
  const lines = [
    "<b>Izberi TTS glas</b>",
    "",
    `Trenutni: <code>${escapeHtml(currentVoiceId || "privzeti")}</code>`,
  ];
  return lines.join("\n");
}
