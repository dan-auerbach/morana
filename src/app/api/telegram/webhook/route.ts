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
  sendTypingAction,
  resolveUser,
  extractFileInfo,
  downloadFileById,
  parseCommand,
} from "@/lib/telegram";

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

  // 4. Dispatch — wrapped in try/catch to always return 200
  try {
    await handleMessage(msg);
  } catch (err) {
    console.error("[Telegram webhook] Error handling message:", err instanceof Error ? err.message : err);
  }

  // Always return 200 to prevent Telegram retries
  return NextResponse.json({ ok: true });
}

// ─── Message Router ──────────────────────────────────────────────────

async function handleMessage(msg: TelegramMessage): Promise<void> {
  const chatId = String(msg.chat.id);

  // Check if it's a command
  if (msg.text) {
    const cmd = parseCommand(msg.text);
    if (cmd) {
      await handleCommand(msg, chatId, cmd.command, cmd.args);
      return;
    }
  }

  // Check if it's a file message
  const fileInfo = extractFileInfo(msg);
  if (fileInfo) {
    await handleFileMessage(msg, chatId, fileInfo);
    return;
  }

  // Plain text (not a command) — hint
  if (msg.text) {
    await sendMessage(chatId, "Uporabi /help za seznam ukazov ali pošlji audio/fotografijo za obdelavo.", null);
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
  switch (command) {
    case "start":
      await handleStart(chatId);
      break;
    case "link":
      await handleLink(msg, chatId, args);
      break;
    case "run":
      await handleRun(msg, chatId, args);
      break;
    case "status":
      await handleStatus(chatId);
      break;
    case "help":
      await handleHelp(chatId);
      break;
    case "unlink":
      await handleUnlink(chatId);
      break;
    default:
      await sendMessage(chatId, `Neznan ukaz /${command}. Uporabi /help za pomoč.`, null);
  }
}

// ─── /start ──────────────────────────────────────────────────────────

async function handleStart(chatId: string): Promise<void> {
  const text = [
    "🤖 *MORANA AI Bot*",
    "",
    "Poveži svoj Telegram račun z MORANA platformo in poganjaj AI recepte neposredno iz Telegrama.",
    "",
    "📋 *Kako začeti:*",
    "1. Odpri MORANA in klikni LINK TELEGRAM",
    "2. Pošlji `/link KODA` sem",
    "3. Pošlji `/run slug-recepta` za zagon",
    "",
    "📎 Lahko tudi pošlješ *audio datoteko* ali *fotografijo* in jo bot obdela z ustreznim receptom.",
    "",
    "Uporabi /help za seznam vseh ukazov.",
  ].join("\n");
  await sendMessage(chatId, text);
}

// ─── /link CODE ──────────────────────────────────────────────────────

async function handleLink(msg: TelegramMessage, chatId: string, code: string): Promise<void> {
  if (!code || code.length !== 6) {
    await sendMessage(chatId, "❌ Vnesi 6-mestno kodo: `/link XXXXXX`");
    return;
  }

  // Find valid link code
  const linkCode = await prisma.telegramLinkCode.findUnique({
    where: { code },
    include: { user: { select: { id: true, name: true, email: true } } },
  });

  if (!linkCode || linkCode.usedAt || linkCode.expiresAt < new Date()) {
    await sendMessage(chatId, "❌ Koda je neveljavna ali potečena. Generiraj novo v MORANA.");
    return;
  }

  // Check if user already has a Telegram link
  const existingLink = await prisma.telegramLink.findUnique({
    where: { userId: linkCode.userId },
  });
  if (existingLink) {
    // Update existing link to new chat
    await prisma.telegramLink.update({
      where: { userId: linkCode.userId },
      data: {
        telegramChatId: chatId,
        telegramUsername: msg.from?.username || null,
      },
    });
  } else {
    // Check if this chat is already linked to another user
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

  // Mark code as used
  await prisma.telegramLinkCode.update({
    where: { id: linkCode.id },
    data: { usedAt: new Date() },
  });

  const displayName = linkCode.user.name || linkCode.user.email;
  await sendMessage(chatId, `✅ Povezano z *${displayName}*! Uporabi /run za zagon receptov.`);
}

// ─── /run [SLUG] [text] ─────────────────────────────────────────────

async function handleRun(msg: TelegramMessage, chatId: string, args: string): Promise<void> {
  // Resolve user
  const resolved = await resolveUser(chatId);
  if (!resolved) {
    await sendMessage(chatId, "❌ Telegram ni povezan z MORANA. Uporabi /link KODA.");
    return;
  }

  // Rate limit check
  const rateCheck = await checkRateLimit(resolved.userId, resolved.workspaceId);
  if (!rateCheck.allowed) {
    await sendMessage(chatId, `⛔ ${rateCheck.reason || "Dosežen limit."}`);
    return;
  }

  // No args → list available recipes
  if (!args) {
    await listRecipes(chatId, resolved.workspaceId);
    return;
  }

  // Parse: first word is slug, rest is input text
  const parts = args.split(/\s+/);
  const slug = parts[0];
  const inputText = parts.slice(1).join(" ").trim();

  // Find recipe by slug
  const recipe = await prisma.recipe.findUnique({
    where: { slug },
    include: { steps: { orderBy: { stepIndex: "asc" } } },
  });

  if (!recipe || recipe.status !== "active") {
    await sendMessage(chatId, `❌ Recept \`${slug}\` ne obstaja ali ni aktiven. Uporabi /run za seznam.`);
    return;
  }

  // Check if recipe requires input
  const needsInput = recipe.inputKind !== "none";
  if (needsInput && !inputText && recipe.inputKind === "text") {
    await sendMessage(chatId, `📝 Recept zahteva besedilo: \`/run ${slug} tvoje besedilo...\``);
    return;
  }

  // Build inputData
  const inputData: Record<string, unknown> = {};
  if (inputText) inputData.text = inputText;
  if (recipe.defaultLang) inputData.language = recipe.defaultLang;

  // Execute
  await executeFromTelegram(chatId, msg.message_id, recipe, resolved, inputData);
}

// ─── /status ─────────────────────────────────────────────────────────

async function handleStatus(chatId: string): Promise<void> {
  const resolved = await resolveUser(chatId);
  if (!resolved) {
    await sendMessage(chatId, "❌ Telegram ni povezan z MORANA. Uporabi /link KODA.");
    return;
  }

  const executions = await prisma.recipeExecution.findMany({
    where: { userId: resolved.userId },
    orderBy: { startedAt: "desc" },
    take: 5,
    include: { recipe: { select: { name: true, slug: true } } },
  });

  if (executions.length === 0) {
    await sendMessage(chatId, "📭 Ni nedavnih izvršitev.");
    return;
  }

  const statusIcon = (s: string) => {
    if (s === "done") return "✅";
    if (s === "running" || s === "pending") return "⏳";
    if (s === "error") return "❌";
    return "⏸";
  };

  const lines = executions.map((e) => {
    const icon = statusIcon(e.status);
    const name = e.recipe.name;
    const time = e.startedAt.toLocaleString("sl-SI", { timeZone: "Europe/Ljubljana" });
    const cost = e.totalCostCents > 0 ? ` • $${(e.totalCostCents / 100).toFixed(3)}` : "";
    const preview = e.previewUrl && e.status === "done" ? ` • [preview](${process.env.NEXTAUTH_URL || ""}${e.previewUrl})` : "";
    return `${icon} *${name}* — ${time}${cost}${preview}`;
  });

  await sendMessage(chatId, `📊 *Zadnjih 5 izvršitev:*\n\n${lines.join("\n")}`);
}

// ─── /help ───────────────────────────────────────────────────────────

async function handleHelp(chatId: string): Promise<void> {
  const text = [
    "📖 *MORANA Bot — Ukazi*",
    "",
    "`/start` — Pozdrav in navodila",
    "`/link KODA` — Poveži Telegram z MORANA",
    "`/run` — Seznam aktivnih receptov",
    "`/run slug besedilo` — Zaženi recept z besedilom",
    "`/status` — Zadnjih 5 izvršitev",
    "`/unlink` — Prekini povezavo",
    "`/help` — Ta pomoč",
    "",
    "📎 *Datoteke:*",
    "Pošlji *audio* → avtomatska transkripcija (NOVINAR)",
    "Pošlji *fotografijo* + opis → video generacija (STORY > VIDEO)",
  ].join("\n");
  await sendMessage(chatId, text);
}

// ─── /unlink ─────────────────────────────────────────────────────────

async function handleUnlink(chatId: string): Promise<void> {
  const deleted = await prisma.telegramLink.deleteMany({
    where: { telegramChatId: chatId },
  });
  if (deleted.count > 0) {
    await sendMessage(chatId, "✅ Povezava prekinjena. Uporabi /link za ponovno povezavo.", null);
  } else {
    await sendMessage(chatId, "ℹ️ Telegram ni bil povezan.", null);
  }
}

// ─── File Message Handler ────────────────────────────────────────────

async function handleFileMessage(
  msg: TelegramMessage,
  chatId: string,
  fileInfo: { fileId: string; mimeType: string; type: "audio" | "image" }
): Promise<void> {
  // Resolve user
  const resolved = await resolveUser(chatId);
  if (!resolved) {
    await sendMessage(chatId, "❌ Telegram ni povezan z MORANA. Uporabi /link KODA.");
    return;
  }

  // Rate limit
  const rateCheck = await checkRateLimit(resolved.userId, resolved.workspaceId);
  if (!rateCheck.allowed) {
    await sendMessage(chatId, `⛔ ${rateCheck.reason || "Dosežen limit."}`);
    return;
  }

  await sendTypingAction(chatId);

  // Download file from Telegram
  const fileData = await downloadFileById(fileInfo.fileId);
  if (!fileData) {
    await sendMessage(chatId, "❌ Napaka pri prenosu datoteke iz Telegrama.", null);
    return;
  }

  // Validate MIME with magic bytes
  const detectedMime = detectMimeFromBytes(fileData.buffer);
  const effectiveMime = detectedMime || fileInfo.mimeType;

  // Upload to R2
  const ext = fileData.filePath.split(".").pop() || "bin";
  const storageKey = `telegram/${uuid()}/${uuid()}.${ext}`;
  await uploadToR2(storageKey, fileData.buffer, effectiveMime, fileData.buffer.length);

  // Find appropriate recipe
  let recipe;
  if (fileInfo.type === "audio") {
    // Default audio recipe: NOVINAR AUTO 1
    recipe = await prisma.recipe.findFirst({
      where: {
        presetKey: "NOVINAR_AUTO_1",
        status: "active",
        ...(resolved.workspaceId ? { workspaceId: resolved.workspaceId } : {}),
      },
      include: { steps: { orderBy: { stepIndex: "asc" } } },
    });
  } else {
    // Default image recipe: STORY_VIDEO
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
    // Fallback: find any active recipe that accepts this input type
    const inputKind = fileInfo.type === "audio" ? "audio" : "image";
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
    await sendMessage(chatId, `❌ Ni aktivnega recepta za ${fileInfo.type === "audio" ? "audio" : "sliko"}.`, null);
    return;
  }

  // Build inputData
  const inputData: Record<string, unknown> = {};
  if (fileInfo.type === "audio") {
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
  // Create execution record
  const execution = await prisma.recipeExecution.create({
    data: {
      recipeId: recipe.id,
      userId: resolved.userId,
      totalSteps: recipe.steps.length,
      recipeVersion: recipe.currentVersion,
      inputData: inputData as Prisma.InputJsonValue,
    },
  });

  // Send "processing" message
  const statusMsgId = await sendMessage(
    chatId,
    `⏳ *${recipe.name}* — procesiranje... (${recipe.steps.length} korakov)`,
  );

  // Save execution ↔ message mapping for later updates
  if (statusMsgId) {
    await prisma.telegramExecutionMap.create({
      data: {
        executionId: execution.id,
        chatId,
        messageId: statusMsgId,
      },
    });
  }

  // Fire execution — Inngest first, direct fallback
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
    after(async () => {
      try {
        await executeRecipe(execution.id);
      } catch (err) {
        console.error(`[Telegram] Direct execution failed for ${execution.id}:`, err);
      }
    });
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
    await sendMessage(chatId, "📭 Ni aktivnih receptov.", null);
    return;
  }

  const inputIcon = (kind: string) => {
    if (kind === "audio") return "🎤";
    if (kind === "image" || kind === "image_text") return "📷";
    if (kind === "text") return "📝";
    return "⚙️";
  };

  const lines = recipes.map(
    (r) => `${inputIcon(r.inputKind)} \`${r.slug}\` — ${r.name}`
  );

  await sendMessage(
    chatId,
    `📋 *Aktivni recepti:*\n\n${lines.join("\n")}\n\nUporabi: \`/run slug besedilo\``
  );
}
