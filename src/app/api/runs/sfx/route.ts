import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/session";
import { checkRateLimit, isModuleAllowed } from "@/lib/rate-limit";
import { prisma } from "@/lib/prisma";
import { runSoundEffect } from "@/lib/providers/tts";
import { logUsage } from "@/lib/usage";
import { uploadToR2 } from "@/lib/storage";
import { getActiveWorkspaceId } from "@/lib/workspace";
import { v4 as uuid } from "uuid";

// Vercel serverless: SFX generation can take 10-30s
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  return withAuth(async (user) => {
    if (!(await isModuleAllowed(user.id, "tts"))) {
      return NextResponse.json({ error: "You don't have access to this module" }, { status: 403 });
    }

    const { prompt, durationSeconds, promptInfluence } = await req.json();

    if (!prompt || typeof prompt !== "string" || prompt.trim().length === 0) {
      return NextResponse.json({ error: "prompt is required" }, { status: 400 });
    }

    if (prompt.length > 1000) {
      return NextResponse.json({ error: "Prompt exceeds 1,000 character limit" }, { status: 400 });
    }

    const rl = await checkRateLimit(user.id);
    if (!rl.allowed) {
      return NextResponse.json({ error: rl.reason || "Rate limit reached" }, { status: 429 });
    }

    const workspaceId = await getActiveWorkspaceId(user.id);

    const run = await prisma.run.create({
      data: {
        userId: user.id,
        type: "sfx",
        status: "running",
        provider: "elevenlabs",
        model: "eleven_text_to_sound_v2",
        workspaceId: workspaceId || undefined,
      },
    });

    await prisma.runInput.create({
      data: {
        runId: run.id,
        payloadJson: { prompt, durationSeconds, promptInfluence },
      },
    });

    try {
      const result = await runSoundEffect(prompt, {
        durationSeconds,
        promptInfluence,
      });

      // Upload audio to R2 storage and serve via proxy endpoint
      let audioUrl: string;
      const storageKey = `sfx/output/${run.id}/${uuid()}.mp3`;

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
        console.warn("[SFX] R2 upload failed, falling back to data URI:", r2Err instanceof Error ? r2Err.message : r2Err);
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
        model: "eleven_text_to_sound_v2",
        units: { chars: prompt.length },
        latencyMs: result.latencyMs,
        workspaceId: workspaceId || undefined,
      });

      return NextResponse.json({
        runId: run.id,
        status: "done",
        audioUrl,
        latencyMs: result.latencyMs,
      });
    } catch (err) {
      const internalMsg = err instanceof Error ? err.message : "Sound effect generation failed";
      console.error("[SFX] Processing error:", internalMsg);
      await prisma.run.update({
        where: { id: run.id },
        data: { status: "error", errorMessage: internalMsg, finishedAt: new Date() },
      });
      return NextResponse.json({ error: "Sound effect generation failed. Please try again." }, { status: 500 });
    }
  }, req);
}
