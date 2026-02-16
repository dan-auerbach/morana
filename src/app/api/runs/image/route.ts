import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/session";
import { checkRateLimit } from "@/lib/rate-limit";
import { prisma } from "@/lib/prisma";
import { runImageGeneration } from "@/lib/providers/image";
import {
  submitImageJob,
  getImageJobStatus,
  getImageJobResult,
  downloadFalImage,
  type FalSubmitParams,
} from "@/lib/providers/fal-image";
import { logUsage } from "@/lib/usage";
import { validateMime } from "@/lib/mime-validate";
import { uploadToR2, getSignedDownloadUrl } from "@/lib/storage";
import { getActiveWorkspaceId } from "@/lib/workspace";
import { validateImageParams, resolveFalImageSize, type ImageParams } from "@/lib/image/operations";
import { v4 as uuid } from "uuid";

// Vercel serverless: image generation can take 20-60s
export const maxDuration = 60;

const MAX_IMAGE_SIZE = 20 * 1024 * 1024; // 20MB max input image

export async function POST(req: NextRequest) {
  return withAuth(async (user) => {
    const rl = await checkRateLimit(user.id);
    if (!rl.allowed) {
      return NextResponse.json({ error: rl.reason || "Rate limit reached" }, { status: 429 });
    }

    const contentType = req.headers.get("content-type") || "";

    // ─── Parse request ─────────────────────────────────────
    let provider: string;
    let operation: string;
    let modelId: string;
    let prompt: string;
    let inputImageBase64: string | undefined;
    let inputImageMime: string | undefined;
    let inputImageStorageKey: string | undefined;
    // fal-specific params
    let aspectRatio: string | undefined;
    let width: number | undefined;
    let height: number | undefined;
    let steps: number | undefined;
    let guidanceScale: number | undefined;
    let seed: number | undefined;
    let numImages: number | undefined;
    let strength: number | undefined;
    let outputFormat: "jpeg" | "png" | undefined;

    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      provider = (formData.get("provider") as string) || "gemini";
      operation = (formData.get("operation") as string) || "generate";
      modelId = (formData.get("modelId") as string) || (provider === "fal" ? "fal-ai/flux/dev" : "gemini-2.5-flash-image");
      prompt = (formData.get("prompt") as string) || "";
      aspectRatio = (formData.get("aspectRatio") as string) || undefined;
      width = formData.get("width") ? parseInt(formData.get("width") as string, 10) : undefined;
      height = formData.get("height") ? parseInt(formData.get("height") as string, 10) : undefined;
      steps = formData.get("steps") ? parseInt(formData.get("steps") as string, 10) : undefined;
      guidanceScale = formData.get("guidanceScale") ? parseFloat(formData.get("guidanceScale") as string) : undefined;
      seed = formData.get("seed") ? parseInt(formData.get("seed") as string, 10) : undefined;
      numImages = formData.get("numImages") ? parseInt(formData.get("numImages") as string, 10) : undefined;
      strength = formData.get("strength") ? parseFloat(formData.get("strength") as string) : undefined;
      outputFormat = (formData.get("outputFormat") as "jpeg" | "png") || undefined;

      const file = formData.get("image") as File | null;
      if (file && file.size > 0) {
        if (file.size > MAX_IMAGE_SIZE) {
          return NextResponse.json({ error: "Image exceeds 20MB limit" }, { status: 400 });
        }

        const allowedTypes = ["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"];
        if (!allowedTypes.includes(file.type)) {
          return NextResponse.json(
            { error: `Unsupported image format: ${file.type}. Use PNG, JPEG, WebP, or GIF.` },
            { status: 400 }
          );
        }

        const buffer = Buffer.from(await file.arrayBuffer());
        const mimeCheck = validateMime(buffer, file.type);
        if (!mimeCheck.valid) {
          return NextResponse.json({ error: mimeCheck.message || "Image content-type mismatch" }, { status: 400 });
        }

        if (provider === "fal") {
          // Upload input image to R2 for fal.ai (upload-first, no user URLs)
          const ext = file.type.includes("png") ? "png" : file.type.includes("webp") ? "webp" : "jpg";
          inputImageStorageKey = `image/input/${uuid()}.${ext}`;
          await uploadToR2(inputImageStorageKey, buffer, file.type, buffer.length);
        } else {
          // Gemini uses base64
          inputImageBase64 = buffer.toString("base64");
          inputImageMime = file.type;
        }
      }
    } else {
      const body = await req.json();
      provider = body.provider || "gemini";
      operation = body.operation || "generate";
      modelId = body.modelId || (provider === "fal" ? "fal-ai/flux/dev" : "gemini-2.5-flash-image");
      prompt = body.prompt || "";
      aspectRatio = body.aspectRatio;
      width = body.width;
      height = body.height;
      steps = body.steps;
      guidanceScale = body.guidanceScale;
      seed = body.seed;
      numImages = body.numImages;
      strength = body.strength;
      outputFormat = body.outputFormat;
      inputImageBase64 = body.imageBase64;
      inputImageMime = body.imageMime;
      inputImageStorageKey = body.inputImageStorageKey;
    }

    // ─── Route to provider ─────────────────────────────────

    if (provider === "fal") {
      return handleFalRequest({
        userId: user.id,
        operation,
        modelId,
        prompt,
        aspectRatio,
        width,
        height,
        steps,
        guidanceScale,
        seed,
        numImages,
        strength,
        outputFormat,
        inputImageStorageKey,
      });
    }

    // ─── Gemini (legacy synchronous path) ──────────────────
    return handleGeminiRequest({
      userId: user.id,
      prompt,
      inputImageBase64,
      inputImageMime,
      aspectRatio,
    });
  }, req);
}

// ─── Fal.ai async handler ──────────────────────────────────

async function handleFalRequest(params: {
  userId: string;
  operation: string;
  modelId: string;
  prompt: string;
  aspectRatio?: string;
  width?: number;
  height?: number;
  steps?: number;
  guidanceScale?: number;
  seed?: number;
  numImages?: number;
  strength?: number;
  outputFormat?: "jpeg" | "png";
  inputImageStorageKey?: string;
}) {
  const {
    userId,
    operation,
    modelId,
    prompt,
    aspectRatio,
    width,
    height,
    steps,
    guidanceScale,
    seed,
    numImages,
    strength,
    outputFormat,
    inputImageStorageKey,
  } = params;

  // Validate params
  const validationInput: Partial<ImageParams> = {
    operation: operation as "generate" | "img2img",
    provider: "fal",
    modelId,
    prompt,
    aspectRatio,
    width,
    height,
    steps,
    guidanceScale,
    seed,
    numImages,
    outputFormat,
    ...(operation === "img2img" ? { inputImageStorageKey: inputImageStorageKey || "", strength } : {}),
  };

  const validation = validateImageParams(validationInput);
  if (!validation.valid) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const validated = validation.sanitized;
  const workspaceId = await getActiveWorkspaceId(userId);

  // Create Run record (status = queued)
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

  await prisma.runInput.create({
    data: {
      runId: run.id,
      payloadJson: {
        operation,
        modelId,
        prompt,
        aspectRatio,
        width,
        height,
        steps,
        guidanceScale,
        seed,
        numImages,
        strength,
        outputFormat,
        inputImageStorageKey: inputImageStorageKey || null,
      },
    },
  });

  // Build fal.ai submit params
  const falParams: FalSubmitParams = {
    prompt,
    image_size: resolveFalImageSize(validated),
    num_inference_steps: steps,
    guidance_scale: guidanceScale,
    seed,
    num_images: numImages || 1,
    enable_safety_checker: true,
    output_format: outputFormat || "jpeg",
  };

  // img2img: provide R2 signed URL to fal.ai (short TTL)
  if (operation === "img2img" && inputImageStorageKey) {
    const signedUrl = await getSignedDownloadUrl(inputImageStorageKey, 600); // 10 min
    falParams.image_url = signedUrl;
    falParams.strength = strength ?? 0.7;
  }

  try {
    // Submit to fal.ai queue
    const queueResult = await submitImageJob(modelId, falParams);
    const requestId = queueResult.request_id;

    // Store providerJobId
    await prisma.run.update({
      where: { id: run.id },
      data: {
        status: "running",
        providerJobId: requestId,
      },
    });

    // ─── Inline poll (like STT/Soniox pattern) ─────────
    // Flux schnell: ~2-5s, Flux dev: ~10-30s — fits within 60s maxDuration
    const start = Date.now();
    const MAX_POLL_MS = 55_000; // leave 5s buffer for download + upload
    let pollInterval = 1000;
    let completed = false;

    while (Date.now() - start < MAX_POLL_MS) {
      await new Promise((r) => setTimeout(r, pollInterval));
      pollInterval = Math.min(pollInterval * 1.3, 5000);

      const status = await getImageJobStatus(modelId, requestId);
      if (status.status === "COMPLETED") {
        completed = true;
        break;
      }
    }

    if (!completed) {
      await prisma.run.update({
        where: { id: run.id },
        data: { status: "error", errorMessage: "Generation timed out", finishedAt: new Date() },
      });
      return NextResponse.json({ error: "Image generation timed out. Try a faster model or fewer steps." }, { status: 504 });
    }

    // ─── Download result ───────────────────────────────
    const result = await getImageJobResult(modelId, requestId);
    const latencyMs = Date.now() - start;

    const outputFiles: Array<{ id: string; url: string }> = [];
    for (const img of result.images) {
      const { buffer, contentType } = await downloadFalImage(img.url);
      const ext = contentType.includes("png") ? "png" : "jpg";
      const storageKey = `image/output/${run.id}/${uuid()}.${ext}`;

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
      outputFiles.push({ id: file.id, url: `/api/files/${file.id}` });
    }

    // ─── Finalize ──────────────────────────────────────
    await prisma.runOutput.create({
      data: {
        runId: run.id,
        payloadJson: {
          seed: result.seed,
          timings: result.timings || {},
          hasNsfwConcepts: result.has_nsfw_concepts || [],
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
      model: modelId,
      units: { images: result.images.length },
      latencyMs,
      workspaceId: workspaceId || undefined,
    });

    return NextResponse.json({
      runId: run.id,
      status: "done",
      imageUrl: outputFiles[0]?.url || null,
      files: outputFiles,
      seed: result.seed,
      latencyMs,
    });
  } catch (err) {
    const internalMsg = err instanceof Error ? err.message : "fal.ai submission failed";
    console.error("[Image/Fal] error:", internalMsg);
    await prisma.run.update({
      where: { id: run.id },
      data: { status: "error", errorMessage: internalMsg, finishedAt: new Date() },
    });
    // Surface real error for debugging (sanitize sensitive info)
    const safeMsg = internalMsg.replace(/Key [a-f0-9-]+/gi, "Key ***");
    return NextResponse.json({ error: safeMsg }, { status: 500 });
  }
}

// ─── Gemini synchronous handler ────────────────────────────

async function handleGeminiRequest(params: {
  userId: string;
  prompt: string;
  inputImageBase64?: string;
  inputImageMime?: string;
  aspectRatio?: string;
}) {
  const { userId, prompt, inputImageBase64, inputImageMime, aspectRatio } = params;

  if (!prompt || typeof prompt !== "string" || prompt.trim().length === 0) {
    return NextResponse.json({ error: "prompt is required" }, { status: 400 });
  }

  if (prompt.length > 10000) {
    return NextResponse.json({ error: "Prompt exceeds 10,000 character limit" }, { status: 400 });
  }

  const workspaceId = await getActiveWorkspaceId(userId);

  const run = await prisma.run.create({
    data: {
      userId,
      type: "image",
      status: "running",
      provider: "gemini",
      model: "gemini-2.5-flash-image",
      workspaceId: workspaceId || undefined,
    },
  });

  await prisma.runInput.create({
    data: {
      runId: run.id,
      payloadJson: {
        operation: "generate",
        provider: "gemini",
        prompt,
        hasInputImage: !!inputImageBase64,
        inputImageMime: inputImageMime || null,
      },
    },
  });

  try {
    const result = await runImageGeneration(prompt, inputImageBase64, inputImageMime, aspectRatio);

    let imageUrl: string | null = null;
    let storageKey: string | null = null;
    if (result.imageBase64) {
      const imageBuffer = Buffer.from(result.imageBase64, "base64");
      const ext = result.mimeType === "image/png" ? "png" : result.mimeType === "image/jpeg" ? "jpg" : "png";
      storageKey = `image/output/${run.id}/${uuid()}.${ext}`;

      try {
        await uploadToR2(storageKey, imageBuffer, result.mimeType, imageBuffer.length);
        const file = await prisma.file.create({
          data: {
            userId,
            runId: run.id,
            kind: "output",
            mime: result.mimeType,
            size: imageBuffer.length,
            storageKey,
          },
        });
        imageUrl = `/api/files/${file.id}`;
      } catch (r2Err) {
        console.warn("[Image] R2 upload failed, falling back to data URI:", r2Err);
        imageUrl = `data:${result.mimeType};base64,${result.imageBase64}`;
        storageKey = null;
      }
    }

    await prisma.run.update({
      where: { id: run.id },
      data: { status: "done", finishedAt: new Date() },
    });

    await prisma.runOutput.create({
      data: {
        runId: run.id,
        payloadJson: {
          text: result.text || "",
          mimeType: result.mimeType,
          hasImage: !!result.imageBase64,
          storageKey: storageKey || null,
          latencyMs: result.latencyMs,
        },
      },
    });

    await logUsage({
      userId,
      runId: run.id,
      provider: "gemini",
      model: "gemini-2.5-flash-image",
      units: { outputTokens: 1290 },
      latencyMs: result.latencyMs,
      workspaceId: workspaceId || undefined,
    });

    return NextResponse.json({
      runId: run.id,
      status: "done",
      imageUrl,
      text: result.text || "",
      latencyMs: result.latencyMs,
    });
  } catch (err) {
    const internalMsg = err instanceof Error ? err.message : "Image generation failed";
    console.error("[Image] Processing error:", internalMsg);
    await prisma.run.update({
      where: { id: run.id },
      data: { status: "error", errorMessage: internalMsg, finishedAt: new Date() },
    });
    return NextResponse.json({ error: "Image generation failed. Please try again." }, { status: 500 });
  }
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

    // Cancel fal.ai job if applicable
    if (run.provider === "fal" && run.providerJobId) {
      const { cancelImageJob } = await import("@/lib/providers/fal-image");
      await cancelImageJob(run.model, run.providerJobId).catch(() => {});
    }

    await prisma.run.update({
      where: { id: runId },
      data: { status: "error", errorMessage: "Cancelled by user", finishedAt: new Date() },
    });

    return NextResponse.json({ status: "cancelled" });
  }, req);
}
