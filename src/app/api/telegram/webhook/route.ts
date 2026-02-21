import { NextRequest, NextResponse, after } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { inngest } from "@/lib/inngest/client";
import { executeRecipe } from "@/lib/recipe-engine";
import { uploadToR2 } from "@/lib/storage";
import { checkRateLimit } from "@/lib/rate-limit";
import { detectMimeFromBytes } from "@/lib/mime-validate";
import { v4 as uuid } from "uuid";
import {
  type TelegramUpdate,
  type TelegramMessage,
  validateWebhookSecret,
  sendMessage,
  sendChatAction,
  resolveUser,
  extractFileInfo,
  downloadFileById,
  parseCommand,
  sendLongMessage,
} from "@/lib/telegram";
import { getSettings, updateSettings, type TgSettings, type TgMode } from "@/lib/telegram-settings";
import {
  handleDirectSTT,
  handleDirectTTS,
  handleDirectLLM,
  handleDirectImage,
  handleTranscribeAndChat,
} from "@/lib/telegram-handlers";
import { listVoices } from "@/lib/providers/tts";
import { getApprovedModelsAsync } from "@/lib/config";

// Allow long-running STT operations (up to 5 minutes)
export const maxDuration = 300;

// ─── Webhook Handler ─────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // 1. Validate webhook secret
  if (!validateWebhookSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Parse update
  let update: TelegramUpdate;
  try {
    update = await req.json();
  } catch {
    return NextResponse.json({ ok: true });
  }

  // 3. Only handle messages (not edited, channel posts, etc.)
  const msg = update.message;
  if (!msg) {
    return NextResponse.json({ ok: true });
  }

  // 4. Return 200 immediately, handle in after() for long operations
  after(async () => {
    try {
      await handleMessage(msg);
    } catch (err) {
      console.error("[Telegram webhook] Error handling message:", err instanceof Error ? err.message : err);
    }
  });

  return NextResponse.json({ ok: true });
}

// ─── Message Router ──────────────────────────────────────────────────

async function handleMessage(msg: TelegramMessage): Promise<void> {
  const chatId = String(msg.chat.id);

  // Check if it's a command (from text or caption)
  const cmdText = msg.text || msg.caption;
  if (cmdText) {
    const cmd = parseCommand(cmdText);
    if (cmd) {
      await handleCommand(msg, chatId, cmd.command, cmd.args);
      return;
    }
  }

  // Check if it's a file message (audio/video/document/photo)
  const fileInfo = extractFileInfo(msg);

  // Resolve user for mode-based routing
  const resolved = await resolveUser(chatId);
  if (!resolved) {
    // Not linked — only accept /start and /link
    if (fileInfo || msg.text) {
      await sendMessage(chatId, "Telegram ni povezan z MORANA. Uporabi /link KODA.");
      return;
    }
    return;
  }

  // Rate limit
  const rateCheck = await checkRateLimit(resolved.userId, resolved.workspaceId);
  if (!rateCheck.allowed) {
    await sendMessage(chatId, `${rateCheck.reason || "Dosezen limit."}`);
    return;
  }

  const settings = await getSettings(resolved.userId);

  // File message (audio/video/document)
  if (fileInfo && (fileInfo.type === "audio" || fileInfo.type === "video")) {
    const avFileInfo = fileInfo as { fileId: string; mimeType: string; type: "audio" | "video" };
    if (settings.mode === "stt") {
      await handleDirectSTT(chatId, avFileInfo, resolved, settings);
    } else if (settings.mode === "llm") {
      await handleTranscribeAndChat(chatId, avFileInfo, resolved, settings);
    } else {
      // recipe mode
      await handleRecipeFileMessage(msg, chatId, fileInfo, resolved);
    }
    return;
  }

  // Photo message
  if (fileInfo && fileInfo.type === "image") {
    if (settings.mode === "llm") {
      // Vision: extract caption or use default prompt
      const text = msg.caption || "Kaj vidis na tej sliki?";
      await handleDirectLLM(chatId, text, resolved, settings, msg);
    } else if (settings.mode === "recipe") {
      await handleRecipeFileMessage(msg, chatId, fileInfo, resolved);
    } else {
      await sendMessage(chatId, "V STT nacinu posiljaj audio/video. Za analizo slike preklopi: `/mode llm`");
    }
    return;
  }

  // Plain text (not a command)
  if (msg.text) {
    if (settings.mode === "llm") {
      await handleDirectLLM(chatId, msg.text, resolved, settings, msg);
    } else if (settings.mode === "recipe") {
      await sendMessage(chatId, "Uporabi `/run slug besedilo` za zagon recepta ali `/mode llm` za klepet.");
    } else {
      // stt mode
      await sendMessage(chatId, "Posiji audio/video za transkripcijo ali `/tts besedilo` za sintezo govora.");
    }
    return;
  }
}

// ─── Command Handlers ────────────────────────────────────────────────

async function handleCommand(
  msg: TelegramMessage,
  chatId: string,
  command: string,
  args: string
): Promise<void> {
  // Commands that don't require auth
  switch (command) {
    case "start":
      await handleStart(chatId);
      return;
    case "link":
      await handleLink(msg, chatId, args);
      return;
    case "help":
      await handleHelp(chatId);
      return;
  }

  // All other commands require linked account
  const resolved = await resolveUser(chatId);
  if (!resolved) {
    await sendMessage(chatId, "Telegram ni povezan z MORANA. Uporabi /link KODA.");
    return;
  }

  const settings = await getSettings(resolved.userId);

  switch (command) {
    case "run":
      await handleRun(msg, chatId, args, resolved);
      break;
    case "status":
      await handleStatus(chatId, resolved);
      break;
    case "unlink":
      await handleUnlink(chatId);
      break;

    // ─── Mode & Settings ───────────
    case "mode":
      await handleMode(chatId, args, resolved.userId);
      break;
    case "settings":
      await handleSettings(chatId, settings);
      break;

    // ─── STT Settings ──────────────
    case "lang":
      await handleLang(chatId, args, resolved.userId);
      break;
    case "diarize":
      await handleDiarize(chatId, args, resolved.userId);
      break;
    case "translate":
      await handleTranslate(chatId, args, resolved.userId);
      break;

    // ─── TTS ───────────────────────
    case "tts":
      await handleTTSCommand(chatId, args, resolved, settings);
      break;
    case "voice":
      await handleVoiceList(chatId);
      break;
    case "setvoice":
      await handleSetVoice(chatId, args, resolved.userId);
      break;

    // ─── LLM ───────────────────────
    case "model":
      await handleModelList(chatId);
      break;
    case "setmodel":
      await handleSetModel(chatId, args, resolved.userId);
      break;
    case "system":
      await handleSystemPrompt(chatId, args, resolved.userId);
      break;
    case "clear":
      await handleClear(chatId, resolved.userId);
      break;

    // ─── Image ─────────────────────
    case "image":
      await handleImageCommand(chatId, args, resolved, settings);
      break;

    default:
      await sendMessage(chatId, `Neznan ukaz /${command}. Uporabi /help za pomoc.`, null);
  }
}

// ─── /start ──────────────────────────────────────────────────────────

async function handleStart(chatId: string): Promise<void> {
  const text = [
    "*MORANA AI Bot*",
    "",
    "Povezi svoj Telegram racun z MORANA platformo za dostop do AI modulov.",
    "",
    "*Kako zaceti:*",
    "1. Odpri MORANA in klikni LINK TELEGRAM",
    "2. Poslji `/link KODA` sem",
    "",
    "*Nacini delovanja:*",
    "`/mode stt` — Posiljaj audio/video, dobi transkript",
    "`/mode llm` — Klepetaj z AI, poslji slike za analizo",
    "`/mode recipe` — Klasicni recepti (NOVINAR itd.)",
    "",
    "*Direktni ukazi (delujejo v vseh nacinih):*",
    "`/tts besedilo` — Sinteza govora",
    "`/image opis` — Generiranje slike",
    "",
    "Uporabi /help za vse ukaze.",
  ].join("\n");
  await sendMessage(chatId, text);
}

// ─── /link CODE ──────────────────────────────────────────────────────

async function handleLink(msg: TelegramMessage, chatId: string, code: string): Promise<void> {
  if (!code || code.length !== 6) {
    await sendMessage(chatId, "Vnesi 6-mestno kodo: `/link XXXXXX`");
    return;
  }

  const linkCode = await prisma.telegramLinkCode.findUnique({
    where: { code },
    include: { user: { select: { id: true, name: true, email: true } } },
  });

  if (!linkCode || linkCode.usedAt || linkCode.expiresAt < new Date()) {
    await sendMessage(chatId, "Koda je neveljavna ali potecena. Generiraj novo v MORANA.");
    return;
  }

  const existingLink = await prisma.telegramLink.findUnique({
    where: { userId: linkCode.userId },
  });
  if (existingLink) {
    await prisma.telegramLink.update({
      where: { userId: linkCode.userId },
      data: {
        telegramChatId: chatId,
        telegramUsername: msg.from?.username || null,
      },
    });
  } else {
    const existingChat = await prisma.telegramLink.findUnique({
      where: { telegramChatId: chatId },
    });
    if (existingChat) {
      await prisma.telegramLink.delete({ where: { telegramChatId: chatId } });
    }

    await prisma.telegramLink.create({
      data: {
        userId: linkCode.userId,
        telegramChatId: chatId,
        telegramUsername: msg.from?.username || null,
      },
    });
  }

  await prisma.telegramLinkCode.update({
    where: { id: linkCode.id },
    data: { usedAt: new Date() },
  });

  const displayName = linkCode.user.name || linkCode.user.email;
  await sendMessage(chatId, `Povezano z *${displayName}*! Uporabi /help za ukaze.`);
}

// ─── /run [SLUG] [text] ─────────────────────────────────────────────

async function handleRun(
  msg: TelegramMessage,
  chatId: string,
  args: string,
  resolved: { userId: string; workspaceId: string | null }
): Promise<void> {
  const rateCheck = await checkRateLimit(resolved.userId, resolved.workspaceId);
  if (!rateCheck.allowed) {
    await sendMessage(chatId, `${rateCheck.reason || "Dosezen limit."}`);
    return;
  }

  if (!args) {
    await listRecipes(chatId, resolved.workspaceId);
    return;
  }

  const parts = args.split(/\s+/);
  const slug = parts[0];
  const inputText = parts.slice(1).join(" ").trim();

  const recipe = await prisma.recipe.findUnique({
    where: { slug },
    include: { steps: { orderBy: { stepIndex: "asc" } } },
  });

  if (!recipe || recipe.status !== "active") {
    await sendMessage(chatId, `Recept \`${slug}\` ne obstaja ali ni aktiven. Uporabi /run za seznam.`);
    return;
  }

  const needsInput = recipe.inputKind !== "none";
  if (needsInput && !inputText && recipe.inputKind === "text") {
    await sendMessage(chatId, `Recept zahteva besedilo: \`/run ${slug} tvoje besedilo...\``);
    return;
  }

  const inputData: Record<string, unknown> = {};
  if (inputText) inputData.text = inputText;
  if (recipe.defaultLang) inputData.language = recipe.defaultLang;

  await executeFromTelegram(chatId, msg.message_id, recipe, resolved, inputData);
}

// ─── /status ─────────────────────────────────────────────────────────

async function handleStatus(
  chatId: string,
  resolved: { userId: string; workspaceId: string | null }
): Promise<void> {
  const executions = await prisma.recipeExecution.findMany({
    where: { userId: resolved.userId },
    orderBy: { startedAt: "desc" },
    take: 5,
    include: { recipe: { select: { name: true, slug: true } } },
  });

  // Also show recent direct runs
  const directRuns = await prisma.run.findMany({
    where: { userId: resolved.userId },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: { type: true, status: true, provider: true, createdAt: true },
  });

  const lines: string[] = [];

  if (executions.length > 0) {
    lines.push("*Recepti:*");
    const statusIcon = (s: string) => {
      if (s === "done") return "done";
      if (s === "running" || s === "pending") return "...";
      if (s === "error") return "ERR";
      return "?";
    };
    for (const e of executions) {
      const icon = statusIcon(e.status);
      const time = e.startedAt.toLocaleString("sl-SI", { timeZone: "Europe/Ljubljana" });
      const cost = e.totalCostCents > 0 ? ` | $${(e.totalCostCents / 100).toFixed(3)}` : "";
      lines.push(`[${icon}] *${e.recipe.name}* — ${time}${cost}`);
    }
  }

  if (directRuns.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push("*Direktne operacije:*");
    for (const r of directRuns) {
      const time = r.createdAt.toLocaleString("sl-SI", { timeZone: "Europe/Ljubljana" });
      lines.push(`[${r.status}] ${r.type.toUpperCase()} (${r.provider}) — ${time}`);
    }
  }

  if (lines.length === 0) {
    await sendMessage(chatId, "Ni nedavnih operacij.", null);
    return;
  }

  await sendMessage(chatId, `*Zadnje operacije:*\n\n${lines.join("\n")}`);
}

// ─── /help ───────────────────────────────────────────────────────────

async function handleHelp(chatId: string): Promise<void> {
  const text = [
    "*MORANA Bot — Ukazi*",
    "",
    "*Povezava:*",
    "`/start` — Pozdrav in navodila",
    "`/link KODA` — Povezi Telegram z MORANA",
    "`/unlink` — Prekini povezavo",
    "",
    "*Nacin:*",
    "`/mode stt|llm|recipe` — Preklopi nacin",
    "`/settings` — Prikazi nastavitve",
    "",
    "*STT (transkripcija):*",
    "`/lang sl|en|auto` — Jezik transkripcije",
    "`/diarize on|off` — Oznacevanje govorcev",
    "`/translate en|sl|off` — Prevod transkripcije",
    "",
    "*TTS (sinteza govora):*",
    "`/tts besedilo` — Generiraj govor",
    "`/voice` — Seznam glasov",
    "`/setvoice ID` — Nastavi glas",
    "",
    "*LLM (klepet):*",
    "`/model` — Seznam modelov",
    "`/setmodel ID` — Nastavi model",
    "`/system prompt` — Nastavi system prompt",
    "`/clear` — Zbrisi zgodovino klepeta",
    "",
    "*Slika:*",
    "`/image opis` — Generiraj sliko",
    "",
    "*Recepti:*",
    "`/run` — Seznam receptov",
    "`/run slug besedilo` — Zazeni recept",
    "`/status` — Zadnje operacije",
    "",
    "*Nacini delovanja:*",
    "STT: posiljaj audio/video -> transkript",
    "LLM: posiljaj besedilo/slike -> AI odgovor",
    "Recipe: posiljaj datoteke -> izvrsitev recepta",
  ].join("\n");
  await sendMessage(chatId, text);
}

// ─── /unlink ─────────────────────────────────────────────────────────

async function handleUnlink(chatId: string): Promise<void> {
  const deleted = await prisma.telegramLink.deleteMany({
    where: { telegramChatId: chatId },
  });
  if (deleted.count > 0) {
    await sendMessage(chatId, "Povezava prekinjena. Uporabi /link za ponovno povezavo.", null);
  } else {
    await sendMessage(chatId, "Telegram ni bil povezan.", null);
  }
}

// ─── /mode ───────────────────────────────────────────────────────────

async function handleMode(chatId: string, args: string, userId: string): Promise<void> {
  const validModes: TgMode[] = ["stt", "llm", "recipe"];
  const mode = args.toLowerCase().trim();

  if (!mode || !validModes.includes(mode as TgMode)) {
    await sendMessage(chatId, "Uporaba: `/mode stt|llm|recipe`");
    return;
  }

  const updated = await updateSettings(userId, { mode: mode as TgMode });
  const descriptions: Record<string, string> = {
    stt: "STT — posiljaj audio/video za transkripcijo",
    llm: "LLM — klepetaj z AI, posiljaj slike",
    recipe: "Recipe — klasicni recepti",
  };
  await sendMessage(chatId, `Nacin: *${mode.toUpperCase()}*\n${descriptions[mode]}`, null);
}

// ─── /settings ───────────────────────────────────────────────────────

async function handleSettings(chatId: string, settings: TgSettings): Promise<void> {
  const lines = [
    "*Nastavitve:*",
    "",
    `Nacin: *${settings.mode.toUpperCase()}*`,
    `Jezik STT: \`${settings.sttLanguage}\``,
    `Diarizacija: ${settings.sttDiarize ? "DA" : "NE"}`,
    `Prevod: ${settings.sttTranslateTo || "izklopljeno"}`,
    `TTS glas: ${settings.ttsVoiceId || "privzeti"}`,
    `LLM model: ${settings.llmModelId || "privzeti"}`,
    `System prompt: ${settings.llmSystemPrompt ? settings.llmSystemPrompt.slice(0, 50) + "..." : "privzeti"}`,
    `Image provider: ${settings.imageProvider}`,
  ];
  await sendMessage(chatId, lines.join("\n"));
}

// ─── /lang ───────────────────────────────────────────────────────────

async function handleLang(chatId: string, args: string, userId: string): Promise<void> {
  const lang = args.toLowerCase().trim();
  if (!lang) {
    await sendMessage(chatId, "Uporaba: `/lang sl|en|auto`");
    return;
  }

  await updateSettings(userId, { sttLanguage: lang });
  await sendMessage(chatId, `Jezik STT: *${lang}*`, null);
}

// ─── /diarize ────────────────────────────────────────────────────────

async function handleDiarize(chatId: string, args: string, userId: string): Promise<void> {
  const val = args.toLowerCase().trim();
  if (val !== "on" && val !== "off") {
    await sendMessage(chatId, "Uporaba: `/diarize on|off`");
    return;
  }

  await updateSettings(userId, { sttDiarize: val === "on" });
  await sendMessage(chatId, `Diarizacija: *${val === "on" ? "VKLOPLJENO" : "IZKLOPLJENO"}*`, null);
}

// ─── /translate ──────────────────────────────────────────────────────

async function handleTranslate(chatId: string, args: string, userId: string): Promise<void> {
  const val = args.toLowerCase().trim();
  if (!val) {
    await sendMessage(chatId, "Uporaba: `/translate en|sl|off`");
    return;
  }

  if (val === "off") {
    await updateSettings(userId, { sttTranslateTo: null });
    await sendMessage(chatId, "Prevod: *IZKLOPLJEN*", null);
  } else {
    await updateSettings(userId, { sttTranslateTo: val });
    await sendMessage(chatId, `Prevod v: *${val}*`, null);
  }
}

// ─── /tts ────────────────────────────────────────────────────────────

async function handleTTSCommand(
  chatId: string,
  text: string,
  resolved: { userId: string; workspaceId: string | null },
  settings: TgSettings
): Promise<void> {
  const rateCheck = await checkRateLimit(resolved.userId, resolved.workspaceId);
  if (!rateCheck.allowed) {
    await sendMessage(chatId, `${rateCheck.reason || "Dosezen limit."}`);
    return;
  }

  await handleDirectTTS(chatId, text, resolved, settings);
}

// ─── /voice ──────────────────────────────────────────────────────────

async function handleVoiceList(chatId: string): Promise<void> {
  try {
    const voices = await listVoices();
    if (voices.length === 0) {
      await sendMessage(chatId, "Ni konfiguriraneh glasov.", null);
      return;
    }

    const lines = voices.map((v) => `\`${v.id}\` — ${v.name}`);
    await sendLongMessage(chatId, `*Glasovi:*\n\n${lines.join("\n")}\n\nUporabi: \`/setvoice ID\``);
  } catch (err) {
    await sendMessage(chatId, "Napaka pri pridobivanju glasov.", null);
  }
}

// ─── /setvoice ───────────────────────────────────────────────────────

async function handleSetVoice(chatId: string, args: string, userId: string): Promise<void> {
  const voiceId = args.trim();
  if (!voiceId) {
    await sendMessage(chatId, "Uporaba: `/setvoice ID` — uporabi /voice za seznam");
    return;
  }

  await updateSettings(userId, { ttsVoiceId: voiceId });
  await sendMessage(chatId, `TTS glas: \`${voiceId}\``, null);
}

// ─── /model ──────────────────────────────────────────────────────────

async function handleModelList(chatId: string): Promise<void> {
  try {
    const models = await getApprovedModelsAsync();
    if (models.length === 0) {
      await sendMessage(chatId, "Ni konfiguriraneh modelov.", null);
      return;
    }

    const lines = models.map((m) => `\`${m.id}\` — ${m.label} (${m.provider})`);
    await sendLongMessage(chatId, `*LLM modeli:*\n\n${lines.join("\n")}\n\nUporabi: \`/setmodel ID\``);
  } catch (err) {
    await sendMessage(chatId, "Napaka pri pridobivanju modelov.", null);
  }
}

// ─── /setmodel ───────────────────────────────────────────────────────

async function handleSetModel(chatId: string, args: string, userId: string): Promise<void> {
  const modelId = args.trim();
  if (!modelId) {
    await sendMessage(chatId, "Uporaba: `/setmodel ID` — uporabi /model za seznam");
    return;
  }

  // Validate model exists
  const models = await getApprovedModelsAsync();
  const found = models.find((m) => m.id === modelId);
  if (!found) {
    await sendMessage(chatId, `Model \`${modelId}\` ni na voljo. Uporabi /model za seznam.`);
    return;
  }

  await updateSettings(userId, { llmModelId: modelId });
  await sendMessage(chatId, `LLM model: *${found.label}* (\`${modelId}\`)`, null);
}

// ─── /system ─────────────────────────────────────────────────────────

async function handleSystemPrompt(chatId: string, args: string, userId: string): Promise<void> {
  if (!args.trim()) {
    // Clear system prompt
    await updateSettings(userId, { llmSystemPrompt: null });
    await sendMessage(chatId, "System prompt pobrisan (privzeti).", null);
    return;
  }

  await updateSettings(userId, { llmSystemPrompt: args });
  await sendMessage(chatId, `System prompt nastavljen (${args.length} znakov).`, null);
}

// ─── /clear ──────────────────────────────────────────────────────────

async function handleClear(chatId: string, userId: string): Promise<void> {
  const convTitle = `telegram:${chatId}:${userId}`;
  const conv = await prisma.conversation.findFirst({
    where: { userId, title: convTitle },
  });

  if (conv) {
    await prisma.conversation.delete({ where: { id: conv.id } });
    await sendMessage(chatId, "Zgodovina klepeta zbrisana.", null);
  } else {
    await sendMessage(chatId, "Ni aktivnega klepeta za brisanje.", null);
  }
}

// ─── /image ──────────────────────────────────────────────────────────

async function handleImageCommand(
  chatId: string,
  prompt: string,
  resolved: { userId: string; workspaceId: string | null },
  settings: TgSettings
): Promise<void> {
  const rateCheck = await checkRateLimit(resolved.userId, resolved.workspaceId);
  if (!rateCheck.allowed) {
    await sendMessage(chatId, `${rateCheck.reason || "Dosezen limit."}`);
    return;
  }

  await handleDirectImage(chatId, prompt, resolved, settings);
}

// ─── Recipe File Message Handler (mode=recipe) ──────────────────────

async function handleRecipeFileMessage(
  msg: TelegramMessage,
  chatId: string,
  fileInfo: { fileId: string; mimeType: string; type: "audio" | "image" | "video" },
  resolved: { userId: string; workspaceId: string | null }
): Promise<void> {
  const rateCheck = await checkRateLimit(resolved.userId, resolved.workspaceId);
  if (!rateCheck.allowed) {
    await sendMessage(chatId, `${rateCheck.reason || "Dosezen limit."}`);
    return;
  }

  await sendChatAction(chatId, "typing");

  // Download file from Telegram
  const fileData = await downloadFileById(fileInfo.fileId);
  if (!fileData) {
    await sendMessage(chatId, "Napaka pri prenosu datoteke iz Telegrama.", null);
    return;
  }

  // Validate MIME
  const detectedMime = detectMimeFromBytes(fileData.buffer);
  const effectiveMime = detectedMime || fileInfo.mimeType;

  // Upload to R2
  const ext = fileData.filePath.split(".").pop() || "bin";
  const storageKey = `telegram/${uuid()}/${uuid()}.${ext}`;
  await uploadToR2(storageKey, fileData.buffer, effectiveMime, fileData.buffer.length);

  // Find appropriate recipe
  let recipe;
  const isAudioLike = fileInfo.type === "audio" || fileInfo.type === "video";

  if (isAudioLike) {
    recipe = await prisma.recipe.findFirst({
      where: {
        presetKey: "NOVINAR_AUTO_1",
        status: "active",
        ...(resolved.workspaceId ? { workspaceId: resolved.workspaceId } : {}),
      },
      include: { steps: { orderBy: { stepIndex: "asc" } } },
    });
  } else {
    recipe = await prisma.recipe.findFirst({
      where: {
        presetKey: "STORY_VIDEO",
        status: "active",
        ...(resolved.workspaceId ? { workspaceId: resolved.workspaceId } : {}),
      },
      include: { steps: { orderBy: { stepIndex: "asc" } } },
    });
  }

  if (!recipe) {
    const inputKind = isAudioLike ? "audio" : "image";
    recipe = await prisma.recipe.findFirst({
      where: {
        status: "active",
        inputKind: { in: [inputKind, "image_text"] },
        ...(resolved.workspaceId ? { workspaceId: resolved.workspaceId } : {}),
      },
      include: { steps: { orderBy: { stepIndex: "asc" } } },
    });
  }

  if (!recipe || recipe.steps.length === 0) {
    await sendMessage(chatId, `Ni aktivnega recepta za ${isAudioLike ? "audio" : "sliko"}.`, null);
    return;
  }

  // Build inputData
  const inputData: Record<string, unknown> = {};
  if (isAudioLike) {
    inputData.audioStorageKey = storageKey;
    inputData.audioMimeType = effectiveMime;
    inputData.language = recipe.defaultLang || "sl";
  } else {
    inputData.imageStorageKey = storageKey;
    inputData.imageMimeType = effectiveMime;
    inputData.text = msg.caption || "";
  }

  await executeFromTelegram(chatId, msg.message_id, recipe, resolved, inputData);
}

// ─── Shared: Execute Recipe from Telegram ────────────────────────────

async function executeFromTelegram(
  chatId: string,
  triggerMessageId: number,
  recipe: { id: string; name: string; steps: { stepIndex: number }[]; currentVersion: number },
  resolved: { userId: string; workspaceId: string | null },
  inputData: Record<string, unknown>
): Promise<void> {
  const execution = await prisma.recipeExecution.create({
    data: {
      recipeId: recipe.id,
      userId: resolved.userId,
      totalSteps: recipe.steps.length,
      recipeVersion: recipe.currentVersion,
      inputData: inputData as Prisma.InputJsonValue,
    },
  });

  const statusMsgId = await sendMessage(
    chatId,
    `*${recipe.name}* — procesiranje... (${recipe.steps.length} korakov)`,
  );

  if (statusMsgId) {
    await prisma.telegramExecutionMap.create({
      data: {
        executionId: execution.id,
        chatId,
        messageId: statusMsgId,
      },
    });
  }

  try {
    await inngest.send({
      name: "recipe/execute",
      data: { executionId: execution.id, userId: resolved.userId },
    });
  } catch (inngestError) {
    console.warn(
      `[Telegram] Inngest unavailable, using direct execution:`,
      inngestError instanceof Error ? inngestError.message : inngestError
    );
    // Direct execution is already deferred since handleMessage runs in after()
    try {
      await executeRecipe(execution.id);
    } catch (err) {
      console.error(`[Telegram] Direct execution failed for ${execution.id}:`, err);
    }
  }
}

// ─── Helper: List Recipes ────────────────────────────────────────────

async function listRecipes(chatId: string, workspaceId: string | null): Promise<void> {
  const recipes = await prisma.recipe.findMany({
    where: {
      status: "active",
      ...(workspaceId ? { workspaceId } : {}),
    },
    orderBy: { name: "asc" },
    select: { slug: true, name: true, description: true, inputKind: true },
  });

  if (recipes.length === 0) {
    await sendMessage(chatId, "Ni aktivnih receptov.", null);
    return;
  }

  const inputIcon = (kind: string) => {
    if (kind === "audio") return "[audio]";
    if (kind === "image" || kind === "image_text") return "[slika]";
    if (kind === "text") return "[text]";
    return "[auto]";
  };

  const lines = recipes.map(
    (r) => `${inputIcon(r.inputKind)} \`${r.slug}\` — ${r.name}`
  );

  await sendMessage(
    chatId,
    `*Aktivni recepti:*\n\n${lines.join("\n")}\n\nUporabi: \`/run slug besedilo\``
  );
}
