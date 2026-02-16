import { inngest } from "./client";
import { prisma } from "../prisma";
import { runSTT } from "../providers/stt";
import { runTTS } from "../providers/tts";
import {
  getImageJobStatus,
  getImageJobResult,
  downloadFalImage,
} from "../providers/fal-image";
import { uploadToR2, getObjectFromR2 } from "../storage";
import { logUsage } from "../usage";
import { executeRecipe } from "../recipe-engine";
import { v4 as uuid } from "uuid";

export const sttJob = inngest.createFunction(
  { id: "stt-transcribe", retries: 2 },
  { event: "stt/transcribe" },
  async ({ event }) => {
    const { runId, userId, storageKey, language, mimeType } = event.data as {
      runId: string;
      userId: string;
      storageKey: string;
      language: "sl" | "en";
      mimeType: string;
    };

    // Check idempotency — if run is already done, skip
    const existing = await prisma.run.findUnique({ where: { id: runId } });
    if (!existing || existing.status === "done") return { skipped: true };

    await prisma.run.update({
      where: { id: runId },
      data: { status: "running" },
    });

    try {
      const obj = await getObjectFromR2(storageKey);
      const bytes = await obj.Body?.transformToByteArray();
      if (!bytes) throw new Error("Failed to read file from storage");

      const result = await runSTT(Buffer.from(bytes), language, mimeType);

      await prisma.runOutput.create({
        data: { runId, payloadJson: { text: result.text } },
      });

      await prisma.run.update({
        where: { id: runId },
        data: { status: "done", finishedAt: new Date() },
      });

      await logUsage({
        runId,
        userId,
        provider: "soniox",
        model: "soniox",
        units: { seconds: result.durationSeconds },
        latencyMs: result.latencyMs,
      });

      return { success: true, text: result.text.slice(0, 200) };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      await prisma.run.update({
        where: { id: runId },
        data: { status: "error", errorMessage: message, finishedAt: new Date() },
      });
      throw err;
    }
  }
);

export const ttsJob = inngest.createFunction(
  { id: "tts-synthesize", retries: 2 },
  { event: "tts/synthesize" },
  async ({ event }) => {
    const { runId, userId, text, voiceId } = event.data as {
      runId: string;
      userId: string;
      text: string;
      voiceId: string;
    };

    const existing = await prisma.run.findUnique({ where: { id: runId } });
    if (!existing || existing.status === "done") return { skipped: true };

    await prisma.run.update({
      where: { id: runId },
      data: { status: "running" },
    });

    try {
      const result = await runTTS(text, voiceId);

      const storageKey = `tts/${runId}/${uuid()}.mp3`;
      await uploadToR2(storageKey, result.audioBuffer, result.mimeType);

      await prisma.file.create({
        data: {
          userId,
          runId,
          kind: "output",
          mime: result.mimeType,
          size: result.audioBuffer.length,
          storageKey,
        },
      });

      await prisma.runOutput.create({
        data: { runId, payloadJson: { storageKey, mimeType: result.mimeType } },
      });

      await prisma.run.update({
        where: { id: runId },
        data: { status: "done", finishedAt: new Date() },
      });

      await logUsage({
        runId,
        userId,
        provider: "elevenlabs",
        model: "elevenlabs",
        units: { chars: result.chars },
        latencyMs: result.latencyMs,
      });

      return { success: true };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      await prisma.run.update({
        where: { id: runId },
        data: { status: "error", errorMessage: message, finishedAt: new Date() },
      });
      throw err;
    }
  }
);

// ─── Recipe Execution Job ────────────────────────────────
export const recipeExecutionJob = inngest.createFunction(
  { id: "recipe-execute", retries: 1 },
  { event: "recipe/execute" },
  async ({ event }) => {
    const { executionId } = event.data as {
      executionId: string;
      userId: string;
    };

    // Idempotency: skip if already started/done
    const existing = await prisma.recipeExecution.findUnique({
      where: { id: executionId },
      select: { status: true },
    });
    if (!existing || existing.status !== "pending") {
      return { skipped: true, reason: `status=${existing?.status}` };
    }

    try {
      await executeRecipe(executionId);
      return { success: true };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error("[recipeExecutionJob] error:", message);
      // Mark as error if engine didn't already
      await prisma.recipeExecution
        .update({
          where: { id: executionId },
          data: {
            status: "error",
            errorMessage: message,
            finishedAt: new Date(),
          },
        })
        .catch(() => {});
      throw err; // re-throw so Inngest records the failure
    }
  }
);

// ─── Fal.ai Image Job — async poll + download ──────────────
export const falImageJob = inngest.createFunction(
  { id: "image-fal-poll", retries: 2 },
  { event: "image/fal-poll" },
  async ({ event, step }) => {
    const { runId, userId, modelId, requestId, numImages, workspaceId } = event.data as {
      runId: string;
      userId: string;
      modelId: string;
      requestId: string;
      numImages: number;
      workspaceId: string | null;
    };

    // Idempotency check
    const existing = await prisma.run.findUnique({ where: { id: runId } });
    if (!existing || existing.status === "done" || existing.status === "error") {
      return { skipped: true };
    }

    const start = Date.now();

    // Poll fal.ai queue with exponential backoff (max 5 min)
    const MAX_POLL_MS = 5 * 60 * 1000;
    let pollInterval = 1500; // start at 1.5s

    let completed = false;
    while (Date.now() - start < MAX_POLL_MS) {
      // Check if run was cancelled
      const run = await prisma.run.findUnique({
        where: { id: runId },
        select: { status: true },
      });
      if (!run || run.status === "error") {
        return { cancelled: true };
      }

      const status = await step.run(`poll-${Date.now()}`, async () => {
        return getImageJobStatus(modelId, requestId);
      });

      if (status.status === "COMPLETED") {
        completed = true;
        break;
      }

      // Wait with exponential backoff (cap at 10s)
      await step.sleep(`wait-${Date.now()}`, `${Math.min(pollInterval, 10000)}ms`);
      pollInterval = Math.min(pollInterval * 1.5, 10000);
    }

    if (!completed) {
      await prisma.run.update({
        where: { id: runId },
        data: { status: "error", errorMessage: "Generation timed out (5 min)", finishedAt: new Date() },
      });
      return { error: "timeout" };
    }

    // Get result
    try {
      const result = await step.run("get-result", async () => {
        return getImageJobResult(modelId, requestId);
      });

      const latencyMs = Date.now() - start;
      const outputImages: Array<{
        r2Key: string;
        width: number;
        height: number;
        contentType: string;
        fileId: string;
      }> = [];

      // Download each image and store in R2
      for (let i = 0; i < result.images.length; i++) {
        const img = result.images[i];
        await step.run(`download-${i}`, async () => {
          const { buffer, contentType } = await downloadFalImage(img.url);
          const ext = contentType.includes("png") ? "png" : "jpg";
          const storageKey = `image/output/${runId}/${uuid()}.${ext}`;

          await uploadToR2(storageKey, buffer, contentType, buffer.length);

          const file = await prisma.file.create({
            data: {
              userId,
              runId,
              kind: "output",
              mime: contentType,
              size: buffer.length,
              storageKey,
            },
          });

          outputImages.push({
            r2Key: storageKey,
            width: img.width,
            height: img.height,
            contentType,
            fileId: file.id,
          });
        });
      }

      // Save output + mark done
      await step.run("finalize", async () => {
        await prisma.runOutput.create({
          data: {
            runId,
            payloadJson: {
              outputs: outputImages,
              seed: result.seed,
              timings: result.timings || {},
              hasNsfwConcepts: result.has_nsfw_concepts || [],
              latencyMs,
            },
          },
        });

        await prisma.run.update({
          where: { id: runId },
          data: { status: "done", finishedAt: new Date() },
        });

        // Cost tracking: estimate based on megapixels * numImages
        // fal.ai flux pricing: ~$0.025/image (schnell) or ~$0.055/image (dev)
        await logUsage({
          runId,
          userId,
          provider: "fal",
          model: modelId,
          units: { images: result.images.length },
          latencyMs,
          workspaceId: workspaceId || undefined,
        });
      });

      return { success: true, images: outputImages.length };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      await prisma.run.update({
        where: { id: runId },
        data: { status: "error", errorMessage: message, finishedAt: new Date() },
      });
      throw err;
    }
  }
);

export const inngestFunctions = [sttJob, ttsJob, recipeExecutionJob, falImageJob];
