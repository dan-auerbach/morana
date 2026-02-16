import { inngest } from "./client";
import { prisma } from "../prisma";
import { runSTT } from "../providers/stt";
import { runTTS } from "../providers/tts";
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

export const inngestFunctions = [sttJob, ttsJob, recipeExecutionJob];
