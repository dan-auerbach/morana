import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/session";
import { checkRateLimit } from "@/lib/rate-limit";
import { prisma } from "@/lib/prisma";
import {
  submitVideoJob,
  getVideoJobStatus,
  getVideoJobResult,
  downloadFalVideo,
  type VideoOperation,
  type VideoSubmitParams,
  type VideoResolution,
} from "@/lib/providers/fal-video";
import { logUsage } from "@/lib/usage";
import { validateMime } from "@/lib/mime-validate";
import { uploadToR2, getSignedDownloadUrl } from "@/lib/storage";
import { getActiveWorkspaceId } from "@/lib/workspace";
import { v4 as uuid } from "uuid";

// Video generation can take 60-180s depending on duration/resolution
export const maxDuration = 300;

const MAX_INPUT_SIZE = 50 * 1024 * 1024; // 50MB max for video/image input

export async function POST(req: NextRequest) {
  return withAuth(async (user) => {
    const rl = await checkRateLimit(user.id);
    if (!rl.allowed) {
      return NextResponse.json({ error: rl.reason || "Rate limit reached" }, { status: 429 });
    }

    const contentType = req.headers.get("content-type") || "";

    // ─── Parse request ─────────────────────────────────────
    let operation: VideoOperation = "text2video";
    let prompt = "";
    let duration = 6;
    let aspectRatio = "16:9";
    let resolution: VideoResolution = "720p";
    let inputStorageKey: string | undefined;
    let inputKind: "image" | "video" | undefined;

    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      operation = (formData.get("operation") as VideoOperation) || "text2video";
      prompt = (formData.get("prompt") as string) || "";
      duration = parseInt(formData.get("duration") as string, 10) || 6;
      aspectRatio = (formData.get("aspectRatio") as string) || "16:9";
      resolution = (formData.get("resolution") as VideoResolution) || "720p";

      const file = formData.get("file") as File | null;
      if (file && file.size > 0) {
        if (file.size > MAX_INPUT_SIZE) {
          return NextResponse.json({ error: "Input file exceeds 50MB limit" }, { status: 400 });
        }

        const isImage = file.type.startsWith("image/");
        const isVideo = file.type.startsWith("video/");

        if (operation === "img2video" && !isImage) {
          return NextResponse.json({ error: "Image file required for Image → Video" }, { status: 400 });
        }
        if (operation === "video2video" && !isVideo) {
          return NextResponse.json({ error: "Video file required for Video → Video" }, { status: 400 });
        }

        const buffer = Buffer.from(await file.arrayBuffer());

        // Validate MIME for images
        if (isImage) {
          const mimeCheck = validateMime(buffer, file.type);
          if (!mimeCheck.valid) {
            return NextResponse.json({ error: mimeCheck.message || "File content-type mismatch" }, { status: 400 });
          }
        }

        // Upload to R2 (upload-first pattern — no user URLs to fal.ai)
        const ext = file.name?.split(".").pop() || (isImage ? "jpg" : "mp4");
        inputStorageKey = `video/input/${uuid()}.${ext}`;
        await uploadToR2(inputStorageKey, buffer, file.type, buffer.length);
        inputKind = isImage ? "image" : "video";
      }
    } else {
      const body = await req.json();
      operation = body.operation || "text2video";
      prompt = body.prompt || "";
      duration = body.duration || 6;
      aspectRatio = body.aspectRatio || "16:9";
      resolution = body.resolution || "720p";
    }

    // ─── Validate ──────────────────────────────────────────

    if (!prompt || typeof prompt !== "string" || prompt.trim().length === 0) {
      return NextResponse.json({ error: "prompt is required" }, { status: 400 });
    }
    if (prompt.length > 4096) {
      return NextResponse.json({ error: "Prompt exceeds 4,096 character limit" }, { status: 400 });
    }

    duration = Math.max(1, Math.min(15, Math.round(duration)));

    if (!["480p", "720p"].includes(resolution)) {
      resolution = "720p";
    }

    if (operation === "img2video" && !inputStorageKey) {
      return NextResponse.json({ error: "Image file required for Image → Video" }, { status: 400 });
    }
    if (operation === "video2video" && !inputStorageKey) {
      return NextResponse.json({ error: "Video file required for Video → Video" }, { status: 400 });
    }

    const workspaceId = await getActiveWorkspaceId(user.id);

    // ─── Create run ────────────────────────────────────────

    const pricingModel = `grok-imagine-video-${resolution}`;
    const run = await prisma.run.create({
      data: {
        userId: user.id,
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
          prompt,
          duration,
          aspectRatio,
          resolution,
          inputStorageKey: inputStorageKey || null,
          inputKind: inputKind || null,
        },
      },
    });

    // ─── Build fal.ai params ───────────────────────────────

    const falParams: VideoSubmitParams = {
      prompt,
      duration,
      resolution,
    };

    // text2video gets explicit aspect_ratio; img2video defaults to "auto"
    if (operation === "text2video") {
      falParams.aspect_ratio = aspectRatio;
    } else if (operation === "img2video") {
      falParams.aspect_ratio = "auto";
    }

    // Provide signed URL for image/video input
    if (inputStorageKey) {
      const signedUrl = await getSignedDownloadUrl(inputStorageKey, 600);
      if (operation === "img2video") {
        falParams.image_url = signedUrl;
      } else if (operation === "video2video") {
        falParams.video_url = signedUrl;
      }
    }

    // ─── Submit + poll ─────────────────────────────────────

    try {
      const queueResult = await submitVideoJob(operation, falParams);
      const requestId = queueResult.request_id;
      const statusUrl = queueResult.status_url;
      const responseUrl = queueResult.response_url;

      await prisma.run.update({
        where: { id: run.id },
        data: { status: "running", providerJobId: requestId },
      });

      // Inline poll — video gen takes 30-180s depending on duration/resolution
      const start = Date.now();
      const MAX_POLL_MS = 280_000; // 4m40s, leave buffer for download
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
        return NextResponse.json(
          { error: "Video generation timed out. Try shorter duration or lower resolution." },
          { status: 504 }
        );
      }

      // ─── Download result ───────────────────────────────

      const result = await getVideoJobResult(responseUrl);
      const latencyMs = Date.now() - start;
      const video = result.video;

      const { buffer, contentType: videoContentType } = await downloadFalVideo(video.url);
      const storageKey = `video/output/${run.id}/${uuid()}.mp4`;
      await uploadToR2(storageKey, buffer, videoContentType, buffer.length);

      const file = await prisma.file.create({
        data: {
          userId: user.id,
          runId: run.id,
          kind: "output",
          mime: videoContentType,
          size: buffer.length,
          storageKey,
        },
      });

      // ─── Finalize ──────────────────────────────────────

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
        userId: user.id,
        provider: "fal",
        model: pricingModel,
        units: { videoSeconds: video.duration },
        latencyMs,
        workspaceId: workspaceId || undefined,
      });

      return NextResponse.json({
        runId: run.id,
        status: "done",
        videoUrl: `/api/files/${file.id}`,
        fileId: file.id,
        width: video.width,
        height: video.height,
        fps: video.fps,
        duration: video.duration,
        latencyMs,
      });
    } catch (err) {
      const internalMsg = err instanceof Error ? err.message : "Video generation failed";
      console.error("[Video/Fal] error:", internalMsg);
      await prisma.run.update({
        where: { id: run.id },
        data: { status: "error", errorMessage: internalMsg, finishedAt: new Date() },
      });
      const safeMsg = internalMsg.replace(/Key [a-f0-9-]+/gi, "Key ***");
      return NextResponse.json({ error: safeMsg }, { status: 500 });
    }
  }, req);
}

// ─── Cancel endpoint ───────────────────────────────────────

export async function DELETE(req: NextRequest) {
  return withAuth(async (user) => {
    const { searchParams } = new URL(req.url);
    const runId = searchParams.get("runId");
    if (!runId) {
      return NextResponse.json({ error: "runId is required" }, { status: 400 });
    }

    const run = await prisma.run.findUnique({ where: { id: runId } });
    if (!run || run.userId !== user.id) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }

    if (run.status === "done" || run.status === "error") {
      return NextResponse.json({ error: "Run already finished" }, { status: 400 });
    }

    await prisma.run.update({
      where: { id: runId },
      data: { status: "error", errorMessage: "Cancelled by user", finishedAt: new Date() },
    });

    return NextResponse.json({ status: "cancelled" });
  }, req);
}
