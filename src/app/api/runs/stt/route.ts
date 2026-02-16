import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/session";
import { checkRateLimit } from "@/lib/rate-limit";
import { prisma } from "@/lib/prisma";
import { config } from "@/lib/config";
import { runSTT } from "@/lib/providers/stt";
import { logUsage } from "@/lib/usage";
import { validateMime } from "@/lib/mime-validate";
import { validateFetchUrl } from "@/lib/url-validate";
import { getActiveWorkspaceId } from "@/lib/workspace";
import { v4 as uuid } from "uuid";

// Vercel serverless: STT polling can take up to 180s
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  return withAuth(async (user) => {
    const rl = await checkRateLimit(user.id);
    if (!rl.allowed) {
      return NextResponse.json({ error: rl.reason || "Rate limit reached" }, { status: 429 });
    }

    const ALLOWED_AUDIO_TYPES = [
      "audio/mpeg", "audio/mp3", "audio/wav", "audio/wave", "audio/x-wav",
      "audio/ogg", "audio/flac", "audio/x-flac", "audio/mp4", "audio/m4a",
      "audio/x-m4a", "audio/aac", "audio/webm",
    ];
    const ALLOWED_EXTENSIONS = [".mp3", ".wav", ".ogg", ".flac", ".m4a", ".aac", ".webm", ".wma"];

    const contentType = req.headers.get("content-type") || "";
    let audioBuffer: Buffer;
    let mimeType: string;
    let language: "sl" | "en" = "en";

    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      const file = formData.get("file") as File | null;
      language = (formData.get("language") as string) === "sl" ? "sl" : "en";

      if (!file) {
        return NextResponse.json({ error: "No file provided" }, { status: 400 });
      }

      // Validate file type
      const fileType = (file.type || "").toLowerCase();
      const fileName = (file.name || "").toLowerCase();
      const ext = fileName.substring(fileName.lastIndexOf("."));
      const isAudioType = ALLOWED_AUDIO_TYPES.includes(fileType) || fileType.startsWith("audio/");
      const isAudioExt = ALLOWED_EXTENSIONS.includes(ext);

      if (!isAudioType && !isAudioExt) {
        const isVideo = fileType.startsWith("video/") || [".mp4", ".mov", ".avi", ".mkv", ".webm"].includes(ext);
        if (isVideo) {
          return NextResponse.json(
            { error: "Video files are not supported. Please extract the audio track first (e.g. using ffmpeg) and upload the audio file." },
            { status: 400 }
          );
        }
        return NextResponse.json(
          { error: `Unsupported file format: ${fileType || ext}. Supported: MP3, WAV, OGG, FLAC, M4A, AAC, WebM audio.` },
          { status: 400 }
        );
      }

      if (file.size > config.maxFileSizeMb * 1024 * 1024) {
        return NextResponse.json(
          { error: `File exceeds ${config.maxFileSizeMb}MB limit` },
          { status: 400 }
        );
      }

      mimeType = file.type || "audio/mpeg";
      audioBuffer = Buffer.from(await file.arrayBuffer());

      // MIME magic-bytes validation
      const mimeCheck = validateMime(audioBuffer, mimeType);
      if (!mimeCheck.valid) {
        return NextResponse.json(
          { error: mimeCheck.message || "Content-type mismatch" },
          { status: 400 }
        );
      }
    } else {
      const body = await req.json();
      const { url, lang } = body;
      language = lang === "sl" ? "sl" : "en";

      if (!url || typeof url !== "string") {
        return NextResponse.json({ error: "url is required" }, { status: 400 });
      }

      // SSRF protection: validate URL before fetching
      const urlCheck = await validateFetchUrl(url);
      if (!urlCheck.valid) {
        return NextResponse.json({ error: urlCheck.reason }, { status: 400 });
      }

      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        config.maxUrlFetchSeconds * 1000
      );

      try {
        const resp = await fetch(urlCheck.url, { signal: controller.signal, redirect: "error" });
        clearTimeout(timeout);

        if (!resp.ok) {
          return NextResponse.json(
            { error: `Failed to fetch URL: ${resp.status}` },
            { status: 400 }
          );
        }

        mimeType = resp.headers.get("content-type") || "audio/mpeg";
        const arrayBuffer = await resp.arrayBuffer();
        audioBuffer = Buffer.from(arrayBuffer);

        if (audioBuffer.length > config.maxFileSizeMb * 1024 * 1024) {
          return NextResponse.json(
            { error: `Downloaded file exceeds ${config.maxFileSizeMb}MB limit` },
            { status: 400 }
          );
        }

        // MIME magic-bytes validation on downloaded content
        const mimeCheck = validateMime(audioBuffer, mimeType);
        if (!mimeCheck.valid) {
          return NextResponse.json(
            { error: mimeCheck.message || "Downloaded file content-type mismatch" },
            { status: 400 }
          );
        }
      } catch (err: unknown) {
        clearTimeout(timeout);
        const message = err instanceof Error ? err.message : "Fetch error";
        return NextResponse.json({ error: `URL fetch failed: ${message}` }, { status: 400 });
      }
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
      data: { runId: run.id, payloadJson: { storageKey, language, mimeType } },
    });

    try {
      const result = await runSTT(audioBuffer, language, mimeType);

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
      });
    } catch (err) {
      const internalMessage = err instanceof Error ? err.message : "STT transcription failed";
      console.error("[STT] Processing error:", internalMessage);
      await prisma.run.update({
        where: { id: run.id },
        data: { status: "error", errorMessage: internalMessage, finishedAt: new Date() },
      });
      return NextResponse.json({ error: "Transcription failed. Please try again." }, { status: 500 });
    }
  }, req);
}
