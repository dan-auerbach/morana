import { prisma } from "./prisma";
import { getApprovedModels } from "./config";
import { runLLMChat, runLLMWebSearch, type ImageAttachment } from "./providers/llm";
import { runSTT } from "./providers/stt";
import { logUsage } from "./usage";
import { getObjectFromR2, uploadToR2, getSignedDownloadUrl, getObjectAsBase64 } from "./storage";
import {
  submitVideoJob,
  getVideoJobStatus,
  getVideoJobResult,
  downloadFalVideo,
  type VideoSubmitParams,
  type VideoResolution,
} from "./providers/fal-video";
import { createHash, randomUUID } from "crypto";
import { decryptCredentials } from "./drupal/crypto";
import { sanitizeHtml } from "./drupal/sanitize";
import { DrupalClient } from "./drupal/client";
import {
  submitImageJob,
  getImageJobStatus,
  getImageJobResult,
  downloadFalImage,
  type FalImageSize,
} from "./providers/fal-image";

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

// ─── Types ────────────────────────────────────────────────────────────────

type CostEntry = { stepIndex: number; model: string; costCents: number };

type StepConfig = {
  modelId?: string;
  systemPrompt?: string;
  userPromptTemplate?: string;
  language?: string;
  provider?: string;
  voiceId?: string;
  promptTemplate?: string;
  formats?: string[];
  knowledgeBaseIds?: string[];
  templateId?: string;
  description?: string;
  // Engine v2: conditional execution
  condition?: {
    stepIndex: number;
    field: string;
    operator: "eq" | "neq" | "in";
    value: unknown;
  };
  // Engine v2: dynamic model selection
  modelStrategy?: "auto";
  modelStrategySource?: { stepIndex: number; field: string };
  modelStrategyMap?: Record<string, string>;
  // Engine v2: web search in recipe steps
  webSearch?: boolean;
  // Engine v2: URL content fetching (extracts page content and injects into prompt)
  fetchUrls?: boolean;
  // Engine v2: video step configuration
  videoOperation?: "text2video" | "img2video" | "video2video";
  videoDuration?: number;       // seconds (1-15)
  videoResolution?: "480p" | "720p";
  videoAspectRatio?: string;    // "16:9", "9:16", etc.
  // Engine v2: image step configuration
  imageModel?: string;    // fal.ai model ID (default: fal-ai/flux/schnell)
  imageSize?: string;     // fal.ai image size preset or {width, height}
  // Engine v2: drupal publish configuration
  mode?: "draft" | "publish";
  integrationId?: string;
  sourceStepIndex?: number;
};

type InputData = {
  text?: string;
  transcriptText?: string;
  audioStorageKey?: string;
  audioMimeType?: string;
  audioUrl?: string;
  language?: string;
  // Image input for video recipes
  imageStorageKey?: string;
  imageMimeType?: string;
} | null;

type StepOutput = {
  text: string;
  runId: string | null;
  providerResponseId: string | null;
  citations?: { url: string; title: string }[];
};

/**
 * StepContext — accumulated results from all executed steps.
 * Enables cross-step references, conditional logic, and dynamic model selection.
 */
type StepContextEntry = { text: string; json?: unknown };

type StepContext = {
  previousOutput: string;
  steps: Record<number, StepContextEntry>;
  input: InputData;
};

// ─── Helpers ──────────────────────────────────────────────────────────────

/**
 * Attempt to parse JSON from text. Looks for first `{ ... }` block.
 * Returns null if not valid JSON.
 */
function tryParseJson(text: string): unknown | null {
  try {
    const match = text.match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : null;
  } catch {
    return null;
  }
}

/**
 * Evaluate a step condition against accumulated context.
 */
function evaluateCondition(actual: unknown, op: string, expected: unknown): boolean {
  if (op === "eq") return actual === expected;
  if (op === "neq") return actual !== expected;
  if (op === "in" && Array.isArray(expected)) return expected.includes(actual);
  return true; // default: run
}

/**
 * Resolve model ID — supports fixed modelId or dynamic modelStrategy.
 */
function resolveModelId(config: StepConfig, context: StepContext): string {
  if (config.modelStrategy === "auto" && config.modelStrategySource && config.modelStrategyMap) {
    const source = context.steps[config.modelStrategySource.stepIndex];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sourceJson = source?.json as Record<string, any> | null;
    const key = String(sourceJson?.[config.modelStrategySource.field] || "");
    const resolved = config.modelStrategyMap[key];
    if (resolved) return resolved;
  }
  return config.modelId || "";
}

/**
 * Interpolate prompt template with context references.
 * Supports: {{input}}, {{step.N.text}}, {{step.N.json}}
 */
function interpolatePrompt(template: string, context: StepContext): string {
  // {{original_input}} — always the user's original input (never overwritten by step outputs)
  const originalInput = context.input?.text || context.input?.transcriptText || "";
  let result = template.replace(/\{\{original_input\}\}/g, originalInput);

  // {{input}} — previousOutput from last executed step (backward compat for NOVINAR v1)
  result = result.replace(/\{\{input\}\}/g, context.previousOutput);

  result = result.replace(/\{\{step\.(\d+)\.text\}\}/g, (_, idx) =>
    context.steps[Number(idx)]?.text || ""
  );
  result = result.replace(/\{\{step\.(\d+)\.json\}\}/g, (_, idx) => {
    const j = context.steps[Number(idx)]?.json;
    return j ? JSON.stringify(j) : "";
  });
  return result;
}

/**
 * Get a nested field from a JSON-like object using a simple dot-free field name.
 */
function getField(obj: unknown, field: string): unknown {
  if (obj && typeof obj === "object" && field in (obj as Record<string, unknown>)) {
    return (obj as Record<string, unknown>)[field];
  }
  return undefined;
}

// ─── Main Execution ───────────────────────────────────────────────────────

/**
 * Execute a recipe, processing steps sequentially.
 * Each step's output becomes the next step's input.
 *
 * Engine v2 features:
 * - StepContext: accumulated results accessible by any subsequent step
 * - Conditional execution: steps can be skipped based on previous output
 * - Dynamic model selection: model chosen at runtime from classifier output
 * - Web search: LLM steps can use OpenAI Responses API web search
 * - Context-aware interpolation: {{step.N.text}} and {{step.N.json}}
 * - Post-execution metadata: confidence score, warning flags, preview
 */
export async function executeRecipe(executionId: string): Promise<void> {
  const execution = await prisma.recipeExecution.findUnique({
    where: { id: executionId },
    include: {
      recipe: {
        include: { steps: { orderBy: { stepIndex: "asc" } } },
      },
    },
  });

  if (!execution) throw new Error("Execution not found");

  // Mark as running
  await prisma.recipeExecution.update({
    where: { id: executionId },
    data: { status: "running" },
  });

  // Initialize context
  const inputData = execution.inputData as InputData;
  const context: StepContext = {
    previousOutput: "",
    steps: {},
    input: inputData,
  };

  if (inputData?.text) {
    context.previousOutput = inputData.text;
  }
  if (inputData?.transcriptText) {
    context.previousOutput = inputData.transcriptText;
  }

  const steps = execution.recipe.steps;
  const workspaceId = execution.recipe.workspaceId || null;
  const costBreakdown: CostEntry[] = [];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const config = step.config as StepConfig;

    // Check if execution was cancelled
    const currentExec = await prisma.recipeExecution.findUnique({
      where: { id: executionId },
      select: { status: true },
    });
    if (currentExec?.status === "cancelled") {
      await writeCostToExecution(executionId, costBreakdown);
      return;
    }

    // Create step result record
    const stepResult = await prisma.recipeStepResult.create({
      data: {
        executionId,
        stepIndex: step.stepIndex,
        status: "running",
        inputPreview: context.previousOutput.substring(0, 500) || "[audio input]",
        startedAt: new Date(),
      },
    });

    // Update execution progress
    await prisma.recipeExecution.update({
      where: { id: executionId },
      data: {
        currentStep: i,
        progress: Math.round((i / steps.length) * 100),
      },
    });

    // ── Condition evaluation: skip step if condition is false ──
    if (config.condition) {
      const sourceStep = context.steps[config.condition.stepIndex];
      const fieldValue = getField(sourceStep?.json, config.condition.field);
      const shouldRun = evaluateCondition(fieldValue, config.condition.operator, config.condition.value);

      if (!shouldRun) {
        await prisma.recipeStepResult.update({
          where: { id: stepResult.id },
          data: {
            status: "skipped",
            outputPreview: "[Skipped by condition]",
            finishedAt: new Date(),
          },
        });
        // Do NOT update previousOutput — keep it from last executed step
        continue;
      }
    }

    try {
      let stepOut: StepOutput;

      if (step.type === "stt") {
        stepOut = await executeSTTStep(execution.userId, workspaceId, config, inputData, context.previousOutput);
      } else if (step.type === "llm") {
        stepOut = await executeLLMStep(execution.userId, workspaceId, config, context);
      } else if (step.type === "video") {
        stepOut = await executeVideoStep(execution.userId, workspaceId, config, context);
      } else if (step.type === "output_format") {
        stepOut = { text: formatOutput(context, config.formats || ["markdown"]), runId: null, providerResponseId: null };
      } else if (step.type === "image") {
        stepOut = await executeImageStep(execution.userId, workspaceId, config, context);
      } else if (step.type === "drupal_publish") {
        stepOut = await executeDrupalPublishStep(execution.userId, workspaceId, config, context);
      } else {
        // TTS — not yet implemented
        stepOut = { text: context.previousOutput || `[Step ${step.name}: ${step.type} processing not implemented]`, runId: null, providerResponseId: null };
      }

      // Compute audit hashes
      const inputHashVal = context.previousOutput ? sha256(context.previousOutput) : null;
      const outputHashVal = stepOut.text ? sha256(stepOut.text) : null;

      // Build outputFull — include citations if present (web search)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const outputFull: Record<string, any> = { text: stepOut.text };
      if (stepOut.citations && stepOut.citations.length > 0) {
        outputFull.citations = stepOut.citations;
      }

      // Update step result with output, hashes, and run link
      await prisma.recipeStepResult.update({
        where: { id: stepResult.id },
        data: {
          status: "done",
          outputPreview: stepOut.text.substring(0, 500),
          outputFull,
          runId: stepOut.runId,
          inputHash: inputHashVal,
          outputHash: outputHashVal,
          providerResponseId: stepOut.providerResponseId,
          finishedAt: new Date(),
        },
      });

      // Aggregate step cost from UsageEvent linked to Run
      if (stepOut.runId) {
        const usageEvents = await prisma.usageEvent.findMany({
          where: { runId: stepOut.runId },
          select: { costEstimateCents: true, model: true },
        });
        const stepCost = usageEvents.reduce((sum, u) => sum + u.costEstimateCents, 0);
        costBreakdown.push({
          stepIndex: step.stepIndex,
          model: usageEvents[0]?.model || config.modelId || "unknown",
          costCents: stepCost,
        });
      }

      // Update context
      context.steps[step.stepIndex] = {
        text: stepOut.text,
        json: tryParseJson(stepOut.text),
      };
      context.previousOutput = stepOut.text;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Step failed";

      await prisma.recipeStepResult.update({
        where: { id: stepResult.id },
        data: {
          status: "error",
          errorMessage: msg,
          finishedAt: new Date(),
        },
      });

      // Mark execution as error with accumulated cost
      await writeCostToExecution(executionId, costBreakdown);
      await prisma.recipeExecution.update({
        where: { id: executionId },
        data: {
          status: "error",
          errorMessage: `Step ${i + 1} (${step.name}) failed: ${msg}`,
          finishedAt: new Date(),
        },
      });

      // Notify Telegram if applicable
      try { await notifyTelegramCompletion(executionId); } catch (e) {
        console.error("[Telegram notify] error:", e instanceof Error ? e.message : e);
      }
      return;
    }
  }

  // ── Post-execution: extract metadata (confidence, warnings) ──
  await extractExecutionMetadata(executionId, context);

  // ── Post-execution: generate public preview ──
  const hasOutputFormat = steps.some((s) => s.type === "output_format");
  if (hasOutputFormat) {
    try {
      await generateAndSavePreview(executionId, context);
    } catch {
      // Preview generation failed — non-critical, continue
    }
  }

  // All steps completed — write final cost and mark done
  await writeCostToExecution(executionId, costBreakdown);
  await prisma.recipeExecution.update({
    where: { id: executionId },
    data: {
      status: "done",
      progress: 100,
      currentStep: steps.length,
      finishedAt: new Date(),
    },
  });

  // Notify Telegram if applicable
  try { await notifyTelegramCompletion(executionId); } catch (e) {
    console.error("[Telegram notify] error:", e instanceof Error ? e.message : e);
  }
}

// ─── Cost ─────────────────────────────────────────────────────────────────

async function writeCostToExecution(executionId: string, breakdown: CostEntry[]): Promise<void> {
  const totalCostCents = breakdown.reduce((sum, e) => sum + e.costCents, 0);
  await prisma.recipeExecution
    .update({
      where: { id: executionId },
      data: {
        totalCostCents,
        costBreakdownJson: { steps: breakdown },
      },
    })
    .catch(() => {});
}

// ─── Metadata Extraction ──────────────────────────────────────────────────

/**
 * Scan step outputs for fact-check results (confidence_score, overall_verdict).
 * Write to RecipeExecution.confidenceScore and warningFlag.
 */
async function extractExecutionMetadata(executionId: string, context: StepContext): Promise<void> {
  try {
    for (const stepData of Object.values(context.steps)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const json = stepData.json as Record<string, any> | null;
      if (json && typeof json.confidence_score === "number") {
        const verdict = json.overall_verdict as string | undefined;
        await prisma.recipeExecution.update({
          where: { id: executionId },
          data: {
            confidenceScore: Math.round(json.confidence_score),
            warningFlag: verdict === "safe" ? null : verdict || null,
          },
        });
        break;
      }
    }
  } catch {
    // Non-critical — metadata extraction failure doesn't stop execution
  }
}

// ─── Preview Generation ───────────────────────────────────────────────────

/**
 * Generate a public preview from execution output.
 * Stores previewHash on RecipeExecution for public access.
 */
async function generateAndSavePreview(executionId: string, context: StepContext): Promise<void> {
  // Find the last output_format step result
  const lastOutputStep = Object.entries(context.steps)
    .reverse()
    .find(([, entry]) => entry.json && typeof entry.json === "object");

  if (!lastOutputStep) return;

  const hash = randomUUID().replace(/-/g, "").substring(0, 12);

  await prisma.recipeExecution.update({
    where: { id: executionId },
    data: {
      previewHash: hash,
      previewUrl: `/preview/${hash}`,
    },
  });
}

// ─── STT Step ─────────────────────────────────────────────────────────────

async function executeSTTStep(
  userId: string,
  workspaceId: string | null,
  config: StepConfig,
  inputData: InputData,
  previousOutput: string
): Promise<StepOutput> {
  // SKIP: transcript already provided by user
  if (inputData?.transcriptText) {
    return { text: inputData.transcriptText, runId: null, providerResponseId: null };
  }

  // SKIP: previous output has text (text input mode, no audio)
  if (previousOutput && previousOutput.length > 10) {
    return { text: previousOutput, runId: null, providerResponseId: null };
  }

  // Determine language
  const language = (inputData?.language || config.language || "sl") as "sl" | "en";

  let audioBuffer: Buffer;
  let mimeType: string;

  if (inputData?.audioStorageKey) {
    const r2Resp = await getObjectFromR2(inputData.audioStorageKey);
    if (!r2Resp.Body) throw new Error("Audio file not found in storage");
    const arrayBuffer = await r2Resp.Body.transformToByteArray();
    audioBuffer = Buffer.from(arrayBuffer);
    mimeType = inputData.audioMimeType || "audio/mpeg";
  } else if (inputData?.audioUrl) {
    const resp = await fetch(inputData.audioUrl);
    if (!resp.ok) throw new Error(`Failed to fetch audio from URL: ${resp.status}`);
    const arrayBuffer = await resp.arrayBuffer();
    audioBuffer = Buffer.from(arrayBuffer);
    mimeType = resp.headers.get("content-type") || "audio/mpeg";
  } else {
    throw new Error("No audio source provided for STT step. Provide an audio file, URL, or transcript text.");
  }

  const run = await prisma.run.create({
    data: {
      userId,
      workspaceId: workspaceId || undefined,
      type: "stt",
      status: "running",
      provider: "soniox",
      model: "stt-async-v4",
    },
  });

  try {
    const result = await runSTT({ buffer: audioBuffer, mimeType }, { language });

    await prisma.run.update({
      where: { id: run.id },
      data: { status: "done", finishedAt: new Date() },
    });

    const durationMinutes = Math.ceil(result.durationSeconds / 60);
    await logUsage({
      runId: run.id,
      userId,
      workspaceId: workspaceId || undefined,
      provider: "soniox",
      model: "stt-async-v4",
      units: { durationSeconds: result.durationSeconds, durationMinutes },
      latencyMs: result.latencyMs,
    });

    if (!result.text || result.text.trim().length === 0) {
      throw new Error("STT returned empty transcript. The audio may be silent or in an unsupported format.");
    }

    return { text: result.text, runId: run.id, providerResponseId: null };
  } catch (err) {
    await prisma.run.update({
      where: { id: run.id },
      data: { status: "error", errorMessage: err instanceof Error ? err.message : "STT failed", finishedAt: new Date() },
    });
    throw err;
  }
}

// ─── LLM Step ─────────────────────────────────────────────────────────────

/**
 * Execute a single LLM step. Supports:
 * - Fixed modelId or dynamic modelStrategy
 * - Context-aware prompt interpolation ({{step.N.text}}, {{step.N.json}})
 * - Web search via OpenAI Responses API (config.webSearch: true)
 */
async function executeLLMStep(
  userId: string,
  workspaceId: string | null,
  config: StepConfig,
  context: StepContext
): Promise<StepOutput> {
  // Resolve model (fixed or dynamic)
  const modelId = resolveModelId(config, context);
  const models = getApprovedModels();
  const modelEntry = models.find((m) => m.id === modelId) || models[0];

  if (!modelEntry) throw new Error("No LLM model available");

  // Build prompt with context-aware interpolation
  let userContent = context.previousOutput;
  if (config.userPromptTemplate) {
    userContent = interpolatePrompt(config.userPromptTemplate, context);
  }

  // URL fetching: extract URLs from prompt, fetch page content, prepend to user message
  if (config.fetchUrls) {
    const { fetchURLsFromMessage } = await import("./url-fetcher");
    const urlContext = await fetchURLsFromMessage(userContent);
    if (urlContext) {
      userContent = urlContext + "\n\n" + userContent;
    }
  }

  // Multimodal: load image from R2 if present (for image_text recipes like STORY_VIDEO)
  let imageAttachments: ImageAttachment[] | undefined;
  if (context.input?.imageStorageKey) {
    try {
      const { base64, contentType } = await getObjectAsBase64(context.input.imageStorageKey as string);
      const mimeType = (context.input.imageMimeType as string) || contentType;
      const MAX_IMAGE_BASE64_SIZE = 4 * 1024 * 1024; // 4MB base64 ≈ 3MB raw — safe for all providers
      if (base64.length > MAX_IMAGE_BASE64_SIZE) {
        console.warn(`[LLM] Image too large for multimodal (${(base64.length / 1024 / 1024).toFixed(1)}MB base64), skipping image`);
      } else {
        imageAttachments = [{ base64, mimeType }];
      }
    } catch (err) {
      console.warn("[LLM] Failed to load image for multimodal:", err instanceof Error ? err.message : err);
    }
  }

  // Create a run for cost tracking
  const run = await prisma.run.create({
    data: {
      userId,
      workspaceId: workspaceId || undefined,
      type: "llm",
      status: "running",
      provider: modelEntry.provider,
      model: modelEntry.id,
    },
  });

  try {
    // Web search mode: use OpenAI Responses API with web_search_preview
    if (config.webSearch && modelEntry.provider === "openai") {
      const wsResult = await runLLMWebSearch(
        [{ role: "user", content: userContent, images: imageAttachments }],
        config.systemPrompt
      );

      await prisma.run.update({
        where: { id: run.id },
        data: { status: "done", finishedAt: new Date() },
      });

      await logUsage({
        runId: run.id,
        userId,
        workspaceId: workspaceId || undefined,
        provider: modelEntry.provider,
        model: modelEntry.id,
        units: { inputTokens: wsResult.inputTokens, outputTokens: wsResult.outputTokens },
        latencyMs: wsResult.latencyMs,
      });

      return {
        text: wsResult.text,
        runId: run.id,
        providerResponseId: wsResult.responseId || null,
        citations: wsResult.citations,
      };
    }

    // Standard LLM chat
    const result = await runLLMChat(
      modelEntry,
      [{ role: "user", content: userContent, images: imageAttachments }],
      config.systemPrompt
    );

    await prisma.run.update({
      where: { id: run.id },
      data: { status: "done", finishedAt: new Date() },
    });

    await logUsage({
      runId: run.id,
      userId,
      workspaceId: workspaceId || undefined,
      provider: modelEntry.provider,
      model: modelEntry.id,
      units: { inputTokens: result.inputTokens, outputTokens: result.outputTokens },
      latencyMs: result.latencyMs,
    });

    return {
      text: result.text,
      runId: run.id,
      providerResponseId: result.responseId || null,
    };
  } catch (err) {
    await prisma.run.update({
      where: { id: run.id },
      data: { status: "error", errorMessage: err instanceof Error ? err.message : "LLM failed", finishedAt: new Date() },
    });
    throw err;
  }
}

// ─── Video Step ──────────────────────────────────────────────────────────

/**
 * Execute a video generation step using fal.ai.
 * Supports img2video (photo → video), text2video, and video2video.
 * The video prompt comes from context.previousOutput (typically from an LLM step).
 * For img2video, the source image comes from context.input.imageStorageKey.
 */
async function executeVideoStep(
  userId: string,
  workspaceId: string | null,
  config: StepConfig,
  context: StepContext
): Promise<StepOutput> {
  const operation = config.videoOperation || "img2video";
  const duration = Math.max(1, Math.min(15, config.videoDuration || 5));
  const resolution: VideoResolution = config.videoResolution || "480p";
  const aspectRatio = config.videoAspectRatio || "16:9";

  // Video prompt from previous step (the LLM-generated prompt)
  const prompt = context.previousOutput?.trim();
  if (!prompt) throw new Error("Video step requires a prompt from the previous step");

  // Build fal.ai params
  const falParams: VideoSubmitParams = { prompt, duration, resolution };

  // Set aspect ratio: img2video uses "auto" (derives from image), text2video uses explicit
  if (operation === "img2video") {
    falParams.aspect_ratio = "auto";

    // Get the source image from R2
    const imageKey = context.input?.imageStorageKey;
    if (!imageKey) throw new Error("img2video requires an image (imageStorageKey in input)");
    const signedUrl = await getSignedDownloadUrl(imageKey, 600);
    falParams.image_url = signedUrl;
  } else {
    falParams.aspect_ratio = aspectRatio;
  }

  // Create Run record for cost tracking
  const pricingModel = `grok-imagine-video-${resolution}`;
  const run = await prisma.run.create({
    data: {
      userId,
      type: "video",
      status: "queued",
      provider: "fal",
      model: pricingModel,
      workspaceId: workspaceId || undefined,
    },
  });

  await prisma.runInput.create({
    data: {
      runId: run.id,
      payloadJson: {
        operation,
        prompt: prompt.slice(0, 500),
        duration,
        aspectRatio,
        resolution,
        imageStorageKey: context.input?.imageStorageKey || null,
      },
    },
  });

  try {
    // Submit to fal.ai queue
    const queueResult = await submitVideoJob(operation, falParams);
    const statusUrl = queueResult.status_url;
    const responseUrl = queueResult.response_url;

    await prisma.run.update({
      where: { id: run.id },
      data: { status: "running", providerJobId: queueResult.request_id },
    });

    // Poll for completion (video gen takes 30-180s)
    const start = Date.now();
    const MAX_POLL_MS = 280_000;
    let pollInterval = 2000;
    let completed = false;

    while (Date.now() - start < MAX_POLL_MS) {
      await new Promise((r) => setTimeout(r, pollInterval));
      pollInterval = Math.min(pollInterval * 1.2, 8000);

      const status = await getVideoJobStatus(statusUrl);
      if (status.status === "COMPLETED") {
        completed = true;
        break;
      }
    }

    if (!completed) {
      await prisma.run.update({
        where: { id: run.id },
        data: { status: "error", errorMessage: "Video generation timed out", finishedAt: new Date() },
      });
      throw new Error("Video generation timed out. Try shorter duration or lower resolution.");
    }

    // Download result
    const result = await getVideoJobResult(responseUrl);
    const latencyMs = Date.now() - start;
    const video = result.video;

    const { buffer, contentType: videoContentType } = await downloadFalVideo(video.url);
    const storageKey = `video/output/${run.id}/${randomUUID()}.mp4`;
    await uploadToR2(storageKey, buffer, videoContentType, buffer.length);

    // Create File record
    const file = await prisma.file.create({
      data: {
        userId,
        runId: run.id,
        kind: "output",
        mime: videoContentType,
        size: buffer.length,
        storageKey,
      },
    });

    // Create RunOutput
    await prisma.runOutput.create({
      data: {
        runId: run.id,
        payloadJson: {
          width: video.width,
          height: video.height,
          fps: video.fps,
          duration: video.duration,
          numFrames: video.num_frames,
          latencyMs,
        },
      },
    });

    await prisma.run.update({
      where: { id: run.id },
      data: { status: "done", finishedAt: new Date() },
    });

    await logUsage({
      runId: run.id,
      userId,
      provider: "fal",
      model: pricingModel,
      units: { videoSeconds: video.duration },
      latencyMs,
      workspaceId: workspaceId || undefined,
    });

    // Return structured JSON so execution detail page can render video player
    const outputJson = {
      videoFileId: file.id,
      videoUrl: `/api/files/${file.id}`,
      storageKey,
      width: video.width,
      height: video.height,
      duration: video.duration,
      fps: video.fps,
    };

    return {
      text: JSON.stringify(outputJson),
      runId: run.id,
      providerResponseId: null,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Video generation failed";
    await prisma.run.update({
      where: { id: run.id },
      data: { status: "error", errorMessage: msg, finishedAt: new Date() },
    });
    throw err;
  }
}

// ─── Image Step ──────────────────────────────────────────────────────────

/**
 * Execute an image generation step using fal.ai.
 * Uses the previous step output as the prompt (typically from an LLM prompt-generator step).
 * Supports config: imageModel (default flux/schnell), imageSize (default landscape_16_9).
 */
async function executeImageStep(
  userId: string,
  workspaceId: string | null,
  config: StepConfig,
  context: StepContext
): Promise<StepOutput> {
  const prompt = context.previousOutput?.trim();
  if (!prompt) throw new Error("Image step requires a prompt from the previous step");

  const modelId = config.imageModel || "fal-ai/flux/schnell";
  const imageSize: FalImageSize = (config.imageSize as FalImageSize) || "landscape_16_9";

  // Create Run record for cost tracking
  const run = await prisma.run.create({
    data: {
      userId,
      type: "image",
      status: "queued",
      provider: "fal",
      model: modelId,
      workspaceId: workspaceId || undefined,
    },
  });

  try {
    // Submit to fal.ai queue
    const queueResult = await submitImageJob(modelId, {
      prompt,
      image_size: imageSize,
      num_images: 1,
      output_format: "jpeg",
      enable_safety_checker: true,
    });

    await prisma.run.update({
      where: { id: run.id },
      data: { status: "running", providerJobId: queueResult.request_id },
    });

    // Poll for completion (schnell: ~2-5s, dev: ~10-20s)
    const start = Date.now();
    const MAX_POLL_MS = 60_000;
    let pollInterval = 1000;
    let completed = false;

    while (Date.now() - start < MAX_POLL_MS) {
      await new Promise((r) => setTimeout(r, pollInterval));
      pollInterval = Math.min(pollInterval * 1.3, 5000);

      const status = await getImageJobStatus(modelId, queueResult.request_id, queueResult.status_url);
      if (status.status === "COMPLETED") {
        completed = true;
        break;
      }
    }

    if (!completed) {
      await prisma.run.update({
        where: { id: run.id },
        data: { status: "error", errorMessage: "Image generation timed out", finishedAt: new Date() },
      });
      throw new Error("Image generation timed out");
    }

    // Get result
    const result = await getImageJobResult(modelId, queueResult.request_id, queueResult.response_url);
    const latencyMs = Date.now() - start;

    if (!result.images || result.images.length === 0) {
      throw new Error("No image returned from generation");
    }

    const img = result.images[0];
    const { buffer, contentType } = await downloadFalImage(img.url);
    const ext = contentType.includes("png") ? "png" : "jpg";
    const storageKey = `image/output/${run.id}/${randomUUID()}.${ext}`;
    await uploadToR2(storageKey, buffer, contentType, buffer.length);

    const file = await prisma.file.create({
      data: {
        userId,
        runId: run.id,
        kind: "output",
        mime: contentType,
        size: buffer.length,
        storageKey,
      },
    });

    await prisma.run.update({
      where: { id: run.id },
      data: { status: "done", finishedAt: new Date() },
    });

    await logUsage({
      runId: run.id,
      userId,
      provider: "fal",
      model: modelId,
      units: { images: 1 },
      latencyMs,
      workspaceId: workspaceId || undefined,
    });

    const outputJson = {
      imageFileId: file.id,
      imageUrl: `/api/files/${file.id}`,
      storageKey,
      width: img.width,
      height: img.height,
    };

    return {
      text: JSON.stringify(outputJson),
      runId: run.id,
      providerResponseId: null,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Image generation failed";
    await prisma.run.update({
      where: { id: run.id },
      data: { status: "error", errorMessage: msg, finishedAt: new Date() },
    });
    throw err;
  }
}

// ─── Drupal Publish Step ──────────────────────────────────────────────────

/**
 * Execute a drupal_publish step: find the drupal_json output from a previous step,
 * load the workspace's Drupal integration, and publish directly.
 * Gracefully skips if no integration is configured.
 */
async function executeDrupalPublishStep(
  userId: string,
  workspaceId: string | null,
  config: StepConfig,
  context: StepContext
): Promise<StepOutput> {
  if (!workspaceId) {
    return { text: "[Skipped: no workspace — Drupal integration requires a workspace]", runId: null, providerResponseId: null };
  }

  // Load Drupal integration for workspace
  const integration = await prisma.integrationDrupal.findUnique({
    where: { workspaceId },
  });
  if (!integration || !integration.isEnabled) {
    return { text: "[Skipped: no Drupal integration configured for this workspace]", runId: null, providerResponseId: null };
  }
  if (!integration.credentialsEnc) {
    return { text: "[Skipped: Drupal integration has no credentials configured]", runId: null, providerResponseId: null };
  }

  // Find drupal_json payload from previous steps
  let drupalPayload: { title?: string; body?: string; summary?: string; featuredImage?: { storageKey?: string; fileId?: string } } | null = null;

  // Look for output with format: "drupal_article" (from formatDrupalOutput)
  for (const [, stepData] of Object.entries(context.steps)) {
    try {
      const parsed = typeof stepData.json === "object" && stepData.json !== null
        ? stepData.json as Record<string, unknown>
        : JSON.parse(stepData.text);
      if (parsed && parsed.format === "drupal_article" && parsed.title) {
        drupalPayload = {
          title: parsed.title as string,
          body: parsed.body as string,
          summary: (parsed.summary || parsed.subtitle || "") as string,
          featuredImage: parsed.featuredImage as { storageKey?: string; fileId?: string } | undefined,
        };
      }
    } catch {
      // Not parseable JSON, skip
    }
  }

  if (!drupalPayload || !drupalPayload.title || !drupalPayload.body) {
    return { text: "[Skipped: no drupal_json output found in previous steps]", runId: null, providerResponseId: null };
  }

  // Determine mode from config (explicit mode field, fallback to draft)
  const mode = (config.mode === "publish" ? "publish" : "draft") as "draft" | "publish";

  // Decrypt credentials and build client
  const credentials = decryptCredentials(integration.credentialsEnc);
  const client = new DrupalClient({
    baseUrl: integration.baseUrl,
    adapterType: integration.adapterType as "jsonapi" | "custom_rest",
    authType: integration.authType as "basic" | "bearer_token",
    credentials,
    defaultContentType: integration.defaultContentType,
    bodyFormat: integration.bodyFormat,
    fieldMap: integration.fieldMap as Record<string, string> | null,
  });

  const sanitizedBody = sanitizeHtml(drupalPayload.body);

  // Download featured image from R2 if available
  let featuredImageData: { buffer: Buffer; filename: string; contentType: string } | undefined;
  if (drupalPayload.featuredImage?.storageKey) {
    try {
      const r2Obj = await getObjectFromR2(drupalPayload.featuredImage.storageKey);
      if (r2Obj.Body) {
        const bytes = await r2Obj.Body.transformToByteArray();
        const ext = drupalPayload.featuredImage.storageKey.split(".").pop() || "jpg";
        featuredImageData = {
          buffer: Buffer.from(bytes),
          filename: `featured-image.${ext}`,
          contentType: r2Obj.ContentType || `image/${ext === "jpg" ? "jpeg" : ext}`,
        };
      }
    } catch (err) {
      console.error("[drupal_publish] Failed to download featured image from R2:", err instanceof Error ? err.message : err);
    }
  }

  const result = await client.publish({
    title: drupalPayload.title,
    body_html: sanitizedBody,
    summary: drupalPayload.summary,
    status: mode,
    featuredImage: featuredImageData ? {
      buffer: featuredImageData.buffer,
      filename: featuredImageData.filename,
      contentType: featuredImageData.contentType,
      alt: drupalPayload.title,
    } : undefined,
  });

  const outputJson = {
    nodeId: result.nodeId,
    nodeUuid: result.nodeUuid,
    url: result.url,
    drupalStatus: result.status,
    imageUploaded: result.imageUploaded || false,
    imageError: result.imageError || undefined,
    publishedAt: new Date().toISOString(),
  };

  return {
    text: JSON.stringify(outputJson),
    runId: null,
    providerResponseId: null,
  };
}

// ─── Output Formatting ────────────────────────────────────────────────────

/**
 * Format output in requested formats.
 * Enhanced: receives full StepContext for richer Drupal output.
 */
function formatOutput(context: StepContext, formats: string[]): string {
  const text = context.previousOutput;
  const sections: string[] = [];

  for (const fmt of formats) {
    if (fmt === "markdown") {
      sections.push(`## Markdown\n\n${text}`);
    } else if (fmt === "html") {
      const html = text
        .split("\n\n")
        .map((p) => `<p>${p}</p>`)
        .join("\n");
      sections.push(`## HTML\n\n${html}`);
    } else if (fmt === "json") {
      sections.push(
        `## JSON\n\n\`\`\`json\n${JSON.stringify({ content: text, generatedAt: new Date().toISOString() }, null, 2)}\n\`\`\``
      );
    } else if (fmt === "drupal_json") {
      sections.push(formatDrupalOutput(context));
    }
  }

  return sections.join("\n\n---\n\n");
}

/**
 * Enhanced Drupal-ready output format.
 * Uses full StepContext to pull article, SEO, research sources, and confidence.
 */
function formatDrupalOutput(context: StepContext): string {
  const text = context.previousOutput;

  // Try to find article text from a writing step (look for longest non-JSON text)
  let articleText = "";
  let seoJson: Record<string, unknown> = {};
  let confidenceScore: number | null = null;
  let sources: { url: string; title: string }[] = [];

  // Scan all steps for relevant data
  for (const [, stepData] of Object.entries(context.steps)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const json = stepData.json as Record<string, any> | null;

    // SEO step: has meta_title or titles
    if (json && (json.meta_title || json.titles)) {
      seoJson = json;
    }

    // Fact-check step: has confidence_score
    if (json && typeof json.confidence_score === "number") {
      confidenceScore = json.confidence_score;
    }

    // Research step: has facts/sources arrays
    if (json && Array.isArray(json.sources)) {
      sources = json.sources;
    }

    // Article detection: prefer text with markdown headings (# or ##),
    // which indicates a structured article vs raw transcript/research.
    // Among texts WITH headings, keep the last one (article comes after STT).
    // Only use text WITHOUT headings if no heading-text was found at all.
    if (!json && stepData.text.length > 50) {
      const hasHeadings = /^#{1,3}\s+.+/m.test(stepData.text);
      const currentHasHeadings = articleText ? /^#{1,3}\s+.+/m.test(articleText) : false;
      if (hasHeadings) {
        // This step has headings — always prefer it (last one wins)
        articleText = stepData.text;
      } else if (!currentHasHeadings && !articleText) {
        // No candidate yet and no headings — use as fallback
        articleText = stepData.text;
      }
    }
  }

  // Fallback: use previousOutput if no article found
  if (!articleText) articleText = text;

  // Legacy SEO extraction from text (backward compat for old NOVINAR preset)
  if (Object.keys(seoJson).length === 0) {
    const jsonMatch = text.match(/\{[\s\S]*"titles"[\s\S]*\}/);
    if (jsonMatch) {
      try {
        seoJson = JSON.parse(jsonMatch[0]);
        // Strip SEO JSON from article text
        articleText = text.replace(/```json[\s\S]*?```/g, "").replace(/\{[\s\S]*"titles"[\s\S]*\}/, "").trim();
      } catch {
        // Not valid JSON
      }
    }
  }

  // Extract title and lead FIRST, then strip them from body
  const titleMatch = articleText.match(/^#\s+(.+)/m);
  const rawTitle = titleMatch?.[1] || (seoJson.meta_title as string) || (seoJson.titles as { text: string }[])?.[0]?.text || "Untitled";
  // Strip markdown bold/italic from title (LLMs sometimes wrap titles in **)
  const mainTitle = rawTitle.replace(/\*+/g, "").trim();

  const leadMatch = articleText.match(/^#\s+.+\n\n(.+)/m);
  const lead = leadMatch?.[1] || (seoJson.meta_description as string) || (seoJson.metaDescription as string) || "";

  // Strip title line and lead paragraph from article text so they don't duplicate in body
  // (preview page renders title and lead separately above the body)
  let bodyArticleText = articleText;
  if (titleMatch) {
    bodyArticleText = bodyArticleText.replace(/^#\s+.+\n*/m, "");
  }
  if (leadMatch?.[1]) {
    // Remove the lead paragraph — first paragraph after the title
    const leadEscaped = leadMatch[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    bodyArticleText = bodyArticleText.replace(new RegExp(leadEscaped + "\\n*"), "");
  }
  bodyArticleText = bodyArticleText.trim();

  // Convert markdown-ish article to HTML (using stripped body text)
  const inline = (s: string) => {
    let r = s;
    // Links: [text](url) → <a href="url">text</a>
    r = r.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
    // Bold: **text** → <strong>text</strong>
    r = r.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    // Italic: *text* → <em>text</em>  (but not already-processed <strong>)
    r = r.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "<em>$1</em>");
    return r;
  };
  const bodyHtml = bodyArticleText
    ? bodyArticleText
        .split("\n\n")
        .map((block) => {
          const trimmed = block.trim();
          if (!trimmed) return "";
          if (trimmed.startsWith("# ")) return `<h1>${inline(trimmed.slice(2))}</h1>`;
          if (trimmed.startsWith("## ")) return `<h2>${inline(trimmed.slice(3))}</h2>`;
          if (trimmed.startsWith("### ")) return `<h3>${inline(trimmed.slice(4))}</h3>`;
          // Lists: handle blocks where lines start with - or *
          if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
            const items = trimmed.split("\n").map((l) => `<li>${inline(l.replace(/^[-*]\s*/, ""))}</li>`);
            return `<ul>${items.join("\n")}</ul>`;
          }
          // Numbered lists: lines starting with 1. 2. etc.
          if (/^\d+\.\s/.test(trimmed)) {
            const items = trimmed.split("\n").map((l) => `<li>${inline(l.replace(/^\d+\.\s*/, ""))}</li>`);
            return `<ol>${items.join("\n")}</ol>`;
          }
          if (trimmed.startsWith("> ")) {
            const quoteLines = trimmed.split("\n").map((l) => inline(l.replace(/^>\s*/, ""))).join("<br>");
            return `<blockquote>${quoteLines}</blockquote>`;
          }
          return `<p>${inline(trimmed)}</p>`;
        })
        .filter(Boolean)
        .join("\n")
    : `<p>${inline(text)}</p>`;

  // Scan for featured image (from image generation step)
  let featuredImage: { fileId?: string; url?: string; storageKey?: string; width?: number; height?: number } | null = null;
  for (const [, stepData] of Object.entries(context.steps)) {
    try {
      const parsed = (typeof stepData.json === "object" && stepData.json !== null
        ? stepData.json
        : JSON.parse(stepData.text)) as Record<string, unknown>;
      if (parsed && parsed.imageFileId) {
        featuredImage = {
          fileId: parsed.imageFileId as string,
          url: parsed.imageUrl as string,
          storageKey: parsed.storageKey as string,
          width: parsed.width as number,
          height: parsed.height as number,
        };
      }
    } catch {
      // Not JSON
    }
  }

  const drupalPayload = {
    title: mainTitle,
    subtitle: lead,
    body: bodyHtml,
    summary: lead,
    meta: {
      meta_title: (seoJson.meta_title as string) || mainTitle,
      meta_description: (seoJson.meta_description as string) || (seoJson.metaDescription as string) || lead,
      keywords: (seoJson.keywords as string[]) || [],
      slug: (seoJson.slug as string) || "",
      social_title: (seoJson.social_title as string) || mainTitle,
      social_description: (seoJson.social_description as string) || lead,
      category_suggestion: (seoJson.category_suggestion as string) || "",
      titleVariants: (seoJson.titles as unknown[]) || [],
      tags: (seoJson.tags as string[]) || [],
    },
    sources: sources.map((s) => ({ title: s.title, url: s.url })),
    featuredImage: featuredImage || undefined,
    author: "AI uredništvo",
    status: "draft",
    confidence_score: confidenceScore,
    format: "drupal_article",
    generatedAt: new Date().toISOString(),
  };

  return JSON.stringify(drupalPayload, null, 2);
}

// ─── Telegram Notification ───────────────────────────────────────────

/**
 * Escape special characters for Telegram HTML parse mode.
 */
function escHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Extract article title + subtitle from step results (output_format JSON).
 */
function extractArticleInfo(
  stepResults: { outputFull: unknown; status: string }[]
): { title?: string; subtitle?: string } | null {
  for (const sr of [...stepResults].reverse()) {
    if (sr.status !== "done" || !sr.outputFull) continue;
    const full = sr.outputFull as { text?: string };
    if (!full.text) continue;
    try {
      const parsed = JSON.parse(full.text);
      if (parsed.title || parsed.body) {
        return {
          title: parsed.title?.substring(0, 100),
          subtitle: (parsed.subtitle || parsed.summary || "")?.substring(0, 150),
        };
      }
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Build the HTML completion text for a Telegram notification.
 */
function buildCompletionText(
  execution: {
    status: string;
    recipe: { name: string };
    finishedAt: Date | null;
    startedAt: Date;
    totalCostCents: number;
    confidenceScore: number | null;
    warningFlag: string | null;
    previewUrl: string | null;
    errorMessage: string | null;
    stepResults: { outputFull: unknown; status: string }[];
  }
): string {
  const recipeName = execution.recipe.name;
  const durationSec =
    execution.finishedAt && execution.startedAt
      ? Math.round(
          (execution.finishedAt.getTime() - execution.startedAt.getTime()) / 1000
        )
      : null;
  const costStr =
    execution.totalCostCents > 0
      ? `$${(execution.totalCostCents / 100).toFixed(3)}`
      : "";

  if (execution.status === "error") {
    const errMsg = execution.errorMessage?.substring(0, 200) || "Unknown error";
    return `❌ <b>${escHtml(recipeName)}</b> — napaka\n\n${escHtml(errMsg)}`;
  }

  const baseUrl = process.env.NEXTAUTH_URL || "";
  const lines: string[] = [];

  // Header
  lines.push(`✅ <b>${escHtml(recipeName)}</b> — končano`);

  // Stats line
  const stats: string[] = [];
  if (durationSec) stats.push(`⏱ ${durationSec}s`);
  if (costStr) stats.push(`💰 ${costStr}`);
  if (execution.confidenceScore != null) {
    const icon =
      execution.confidenceScore > 80
        ? "🟢"
        : execution.confidenceScore > 50
          ? "🟡"
          : "🔴";
    stats.push(`${icon} ${execution.confidenceScore}%`);
  }
  if (stats.length > 0) lines.push(stats.join(" • "));

  // Article title + subtitle from output
  const articleInfo = extractArticleInfo(execution.stepResults);
  if (articleInfo) {
    lines.push("");
    if (articleInfo.title) lines.push(`📰 <b>${escHtml(articleInfo.title)}</b>`);
    if (articleInfo.subtitle) lines.push(`<i>${escHtml(articleInfo.subtitle)}</i>`);
  }

  // Warning flag
  if (execution.warningFlag) {
    const icon = execution.warningFlag === "high_risk" ? "🔴" : "⚠️";
    const label =
      execution.warningFlag === "high_risk"
        ? "VISOKO TVEGANJE"
        : "Potreben pregled";
    lines.push(`\n${icon} ${label}`);
  }

  // Preview link
  if (execution.previewUrl) {
    lines.push(`\n🔗 <a href="${baseUrl}${execution.previewUrl}">Odpri preview</a>`);
  }

  return lines.join("\n");
}

/**
 * Notify the Telegram user when a recipe execution completes (done or error).
 * Bulletproof: tries editMessage → sendMessage fallback → direct user lookup.
 */
export async function notifyTelegramCompletion(executionId: string): Promise<void> {
  console.log(`[Telegram notify] Starting for execution=${executionId}`);

  // Import telegram functions
  const { editMessage, sendMessage } = await import("./telegram");

  // Load execution data
  const execution = await prisma.recipeExecution.findUnique({
    where: { id: executionId },
    include: {
      recipe: { select: { name: true } },
      stepResults: {
        orderBy: { stepIndex: "asc" },
        select: { outputFull: true, status: true },
      },
    },
  });
  if (!execution) {
    console.log(`[Telegram notify] Execution not found in DB`);
    return;
  }
  if (execution.status !== "done" && execution.status !== "error") {
    console.log(`[Telegram notify] Execution status=${execution.status}, not terminal — skipping`);
    return;
  }
  console.log(`[Telegram notify] Execution status=${execution.status}, previewUrl=${execution.previewUrl}`);

  const text = buildCompletionText(execution);
  const hasPreviewLink = execution.status === "done" && !!execution.previewUrl;

  // Strategy 1: Try to edit the original "processing" message
  const tgMap = await prisma.telegramExecutionMap.findUnique({
    where: { executionId },
  });

  if (tgMap) {
    console.log(`[Telegram notify] Found tgMap: chatId=${tgMap.chatId}, msgId=${tgMap.messageId}`);
    const edited = await editMessage(tgMap.chatId, tgMap.messageId, text, "HTML", !hasPreviewLink);
    if (edited) {
      console.log(`[Telegram notify] ✅ Edited message successfully`);
      return;
    }
    // Fallback: send a NEW message to the same chat
    console.warn(`[Telegram notify] editMessage failed, sending new message to chat=${tgMap.chatId}`);
    const msgId = await sendMessage(tgMap.chatId, text, "HTML");
    if (msgId) {
      console.log(`[Telegram notify] ✅ Sent new message (fallback) msgId=${msgId}`);
      return;
    }
    console.error(`[Telegram notify] sendMessage also failed for chat=${tgMap.chatId}`);
  } else {
    console.log(`[Telegram notify] No tgMap found for execution=${executionId}`);
  }

  // Strategy 2: Find TelegramLink for this user and send directly
  console.log(`[Telegram notify] Looking up TelegramLink for userId=${execution.userId}`);
  const link = await prisma.telegramLink.findUnique({
    where: { userId: execution.userId },
  });
  if (link) {
    console.log(`[Telegram notify] Found TelegramLink, sending to chatId=${link.telegramChatId}`);
    const msgId = await sendMessage(link.telegramChatId, text, "HTML");
    if (msgId) {
      console.log(`[Telegram notify] ✅ Sent direct message msgId=${msgId}`);
    } else {
      console.error(`[Telegram notify] Direct sendMessage failed for chat=${link.telegramChatId}`);
    }
  } else {
    console.log(`[Telegram notify] No TelegramLink found for user=${execution.userId}, giving up`);
  }
}
