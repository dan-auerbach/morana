import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/session";
import { checkRateLimit, isModuleAllowed } from "@/lib/rate-limit";
import { prisma } from "@/lib/prisma";
import { runSTT, STTAudioSource } from "@/lib/providers/stt";
import { logUsage } from "@/lib/usage";
import { validateFetchUrl } from "@/lib/url-validate";
import { getActiveWorkspaceId } from "@/lib/workspace";
import { getSignedDownloadUrl, deleteFromR2 } from "@/lib/storage";
import { v4 as uuid } from "uuid";

const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500MB

// Vercel serverless: STT polling can take up to 270s
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  return withAuth(async (user) => {
    if (!(await isModuleAllowed(user.id, "stt"))) {
      return NextResponse.json({ error: "You don't have access to this module" }, { status: 403 });
    }

    const rl = await checkRateLimit(user.id);
    if (!rl.allowed) {
      return NextResponse.json({ error: rl.reason || "Rate limit reached" }, { status: 429 });
    }

    const body = await req.json();
    const language = body.lang || "auto";
    const diarize = !!body.diarize;
    const translateTo = body.translateTo || "";

    let audioSource: STTAudioSource;
    let r2KeyToCleanup: string | null = null;
    const mimeType = body.mimeType || "audio/mpeg";

    if (body.storageKey) {
      // File was uploaded to R2 via presigned URL.
      // Generate a signed download URL so Soniox can fetch directly — no memory needed.
      r2KeyToCleanup = body.storageKey;
      const downloadUrl = await getSignedDownloadUrl(body.storageKey, 1800); // 30 min
      audioSource = { audioUrl: downloadUrl };
    } else if (body.url) {
      const { url } = body;
      if (typeof url !== "string") {
        return NextResponse.json({ error: "url must be a string" }, { status: 400 });
      }

      // SSRF protection: validate URL before passing to Soniox
      const urlCheck = await validateFetchUrl(url);
      if (!urlCheck.valid) {
        return NextResponse.json({ error: urlCheck.reason }, { status: 400 });
      }

      audioSource = { audioUrl: urlCheck.url };
    } else {
      return NextResponse.json({ error: "storageKey or url is required" }, { status: 400 });
    }

    const storageKey = `stt/input/${uuid()}/audio`;
    const idempotencyKey = `stt-${user.id}-${storageKey}`;

    const workspaceId = await getActiveWorkspaceId(user.id);

    const run = await prisma.run.create({
      data: {
        userId: user.id,
        type: "stt",
        status: "running",
        provider: "soniox",
        model: "stt-async-v4",
        idempotencyKey,
        workspaceId: workspaceId || undefined,
      },
    });

    await prisma.runInput.create({
      data: { runId: run.id, payloadJson: { storageKey, language, mimeType, diarize, translateTo: translateTo || undefined } },
    });

    try {
      const result = await runSTT(audioSource, {
        language,
        diarize,
        translateTo: translateTo || undefined,
      });

      // Clean up R2 file after Soniox has fetched it
      if (r2KeyToCleanup) deleteFromR2(r2KeyToCleanup);

      await prisma.run.update({
        where: { id: run.id },
        data: { status: "done", finishedAt: new Date() },
      });

      await prisma.runOutput.create({
        data: {
          runId: run.id,
          payloadJson: {
            text: result.text,
            durationSeconds: result.durationSeconds,
            latencyMs: result.latencyMs,
            tokens: result.tokens,
            translatedText: result.translatedText,
          },
        },
      });

      await logUsage({
        userId: user.id,
        runId: run.id,
        provider: "soniox",
        model: "stt-async-v4",
        units: { durationSeconds: result.durationSeconds },
        latencyMs: result.latencyMs,
        workspaceId: workspaceId || undefined,
      });

      return NextResponse.json({
        runId: run.id,
        status: "done",
        text: result.text,
        durationSeconds: result.durationSeconds,
        latencyMs: result.latencyMs,
        tokens: result.tokens,
        translatedText: result.translatedText,
      });
    } catch (err) {
      // Clean up R2 even on error
      if (r2KeyToCleanup) deleteFromR2(r2KeyToCleanup);

      const internalMessage = err instanceof Error ? err.message : "STT transcription failed";
      console.error("[STT] Processing error:", internalMessage);
      await prisma.run.update({
        where: { id: run.id },
        data: { status: "error", errorMessage: internalMessage, finishedAt: new Date() },
      });
      return NextResponse.json({ error: internalMessage }, { status: 500 });
    }
  }, req);
}
