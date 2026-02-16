import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/session";
import { checkRateLimit } from "@/lib/rate-limit";
import { prisma } from "@/lib/prisma";
import { config } from "@/lib/config";
import { runTTS, TTSOptions } from "@/lib/providers/tts";
import { logUsage } from "@/lib/usage";
import { uploadToR2 } from "@/lib/storage";
import { v4 as uuid } from "uuid";
import crypto from "crypto";

// Vercel serverless: TTS synthesis can take 10-30s
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  return withAuth(async (user) => {
    const { text, voiceId, modelId, outputFormat, languageCode, voiceSettings } = await req.json();


    if (!text || !voiceId) {
      return NextResponse.json({ error: "text and voiceId are required" }, { status: 400 });
    }

    if (text.length > config.maxTtsChars) {
      return NextResponse.json(
        { error: `Text exceeds ${config.maxTtsChars} character limit` },
        { status: 400 }
      );
    }

    const rl = await checkRateLimit(user.id);
    if (!rl.allowed) {
      return NextResponse.json({ error: rl.reason || "Rate limit reached" }, { status: 429 });
    }

    const settingsStr = JSON.stringify({ modelId, outputFormat, languageCode, voiceSettings });
    const textHash = crypto.createHash("sha256").update(text + settingsStr).digest("hex").slice(0, 16);
    const idempotencyKey = `tts-${user.id}-${voiceId}-${textHash}`;

    // Check for existing run with same idempotency key
    const existingRun = await prisma.run.findUnique({ where: { idempotencyKey } });
    if (existingRun) {
      if (existingRun.status === "done") {
        // Return cached result with proxy audio URL
        const output = await prisma.runOutput.findFirst({ where: { runId: existingRun.id } });
        const payload = output?.payloadJson as Record<string, unknown> | null;
        const file = await prisma.file.findFirst({
          where: { runId: existingRun.id, kind: "output" },
        });
        return NextResponse.json({
          runId: existingRun.id,
          status: "done",
          latencyMs: payload?.latencyMs ?? 0,
          chars: payload?.chars ?? 0,
          ...(file && { audioUrl: `/api/files/${file.id}` }),
        });
      }
      // Delete stale queued/error/running runs so we can retry
      await prisma.runOutput.deleteMany({ where: { runId: existingRun.id } });
      await prisma.runInput.deleteMany({ where: { runId: existingRun.id } });
      await prisma.file.deleteMany({ where: { runId: existingRun.id } });
      await prisma.run.delete({ where: { id: existingRun.id } });
    }

    const run = await prisma.run.create({
      data: {
        userId: user.id,
        type: "tts",
        status: "running",
        provider: "elevenlabs",
        model: modelId || "eleven_v3",
        idempotencyKey,
      },
    });

    const ttsOptions: TTSOptions = {
      ...(modelId && { modelId }),
      ...(outputFormat && { outputFormat }),
      ...(languageCode && { languageCode }),
      ...(voiceSettings && { voiceSettings }),
    };

    await prisma.runInput.create({
      data: { runId: run.id, payloadJson: { text, voiceId, ...ttsOptions } },
    });

    try {
      const result = await runTTS(text, voiceId, ttsOptions);

      // Upload audio to R2 storage and serve via proxy endpoint
      let audioUrl: string;
      const storageKey = `tts/output/${run.id}/${uuid()}.mp3`;

      try {
        await uploadToR2(storageKey, result.audioBuffer, result.mimeType, result.audioBuffer.length);
        const file = await prisma.file.create({
          data: {
            userId: user.id,
            runId: run.id,
            kind: "output",
            mime: result.mimeType,
            size: result.audioBuffer.length,
            storageKey,
          },
        });
        audioUrl = `/api/files/${file.id}`;
      } catch (r2Err) {
        // R2 not configured or upload failed — fall back to data URI
        console.warn("[TTS] R2 upload failed, falling back to data URI:", r2Err instanceof Error ? r2Err.message : r2Err);
        const base64Audio = result.audioBuffer.toString("base64");
        audioUrl = `data:${result.mimeType};base64,${base64Audio}`;
      }

      await prisma.run.update({
        where: { id: run.id },
        data: { status: "done", finishedAt: new Date() },
      });

      await prisma.runOutput.create({
        data: {
          runId: run.id,
          payloadJson: {
            chars: result.chars,
            latencyMs: result.latencyMs,
            mimeType: result.mimeType,
            storageKey: storageKey || null,
          },
        },
      });

      await logUsage({
        userId: user.id,
        runId: run.id,
        provider: "elevenlabs",
        model: "elevenlabs",
        units: { chars: result.chars },
        latencyMs: result.latencyMs,
      });

      return NextResponse.json({
        runId: run.id,
        status: "done",
        audioUrl,
        latencyMs: result.latencyMs,
        chars: result.chars,
      });
    } catch (err) {
      const internalMsg = err instanceof Error ? err.message : "TTS synthesis failed";
      console.error("[TTS] Processing error:", internalMsg);
      await prisma.run.update({
        where: { id: run.id },
        data: { status: "error", errorMessage: internalMsg, finishedAt: new Date() },
      });
      return NextResponse.json({ error: "Speech synthesis failed. Please try again." }, { status: 500 });
    }
  }, req);
}
