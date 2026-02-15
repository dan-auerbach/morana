import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/session";
import { checkRateLimit } from "@/lib/rate-limit";
import { prisma } from "@/lib/prisma";
import { runImageGeneration } from "@/lib/providers/image";
import { logUsage } from "@/lib/usage";
import { validateMime } from "@/lib/mime-validate";
import { uploadToR2, getSignedDownloadUrl } from "@/lib/storage";
import { v4 as uuid } from "uuid";

// Vercel serverless: Gemini image generation can take 20-60s
export const maxDuration = 60;

const MAX_IMAGE_SIZE = 20 * 1024 * 1024; // 20MB max input image

export async function POST(req: NextRequest) {
  return withAuth(async (user) => {
    const rl = await checkRateLimit(user.id);
    if (!rl.allowed) {
      return NextResponse.json({ error: rl.reason || "Rate limit reached" }, { status: 429 });
    }

    const contentType = req.headers.get("content-type") || "";
    let prompt: string;
    let inputImageBase64: string | undefined;
    let inputImageMime: string | undefined;

    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      prompt = (formData.get("prompt") as string) || "";
      const file = formData.get("image") as File | null;

      if (file && file.size > 0) {
        if (file.size > MAX_IMAGE_SIZE) {
          return NextResponse.json(
            { error: `Image exceeds 20MB limit` },
            { status: 400 }
          );
        }

        const allowedTypes = ["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"];
        if (!allowedTypes.includes(file.type)) {
          return NextResponse.json(
            { error: `Unsupported image format: ${file.type}. Use PNG, JPEG, WebP, or GIF.` },
            { status: 400 }
          );
        }

        const buffer = Buffer.from(await file.arrayBuffer());

        // MIME magic-bytes validation
        const mimeCheck = validateMime(buffer, file.type);
        if (!mimeCheck.valid) {
          return NextResponse.json(
            { error: mimeCheck.message || "Image content-type mismatch" },
            { status: 400 }
          );
        }

        inputImageBase64 = buffer.toString("base64");
        inputImageMime = file.type;
      }
    } else {
      const body = await req.json();
      prompt = body.prompt || "";
      inputImageBase64 = body.imageBase64;
      inputImageMime = body.imageMime;
    }

    if (!prompt || typeof prompt !== "string" || prompt.trim().length === 0) {
      return NextResponse.json({ error: "prompt is required" }, { status: 400 });
    }

    if (prompt.length > 10000) {
      return NextResponse.json({ error: "Prompt exceeds 10,000 character limit" }, { status: 400 });
    }

    const run = await prisma.run.create({
      data: {
        userId: user.id,
        type: "image",
        status: "running",
        provider: "gemini",
        model: "gemini-2.5-flash-image",
      },
    });

    await prisma.runInput.create({
      data: {
        runId: run.id,
        payloadJson: {
          prompt,
          hasInputImage: !!inputImageBase64,
          inputImageMime: inputImageMime || null,
        },
      },
    });

    try {
      const result = await runImageGeneration(prompt, inputImageBase64, inputImageMime);

      // Store generated image in R2 and save key in DB
      let imageUrl: string | null = null;
      let storageKey: string | null = null;
      if (result.imageBase64) {
        const imageBuffer = Buffer.from(result.imageBase64, "base64");
        const ext = result.mimeType === "image/png" ? "png" : result.mimeType === "image/jpeg" ? "jpg" : "png";
        storageKey = `image/output/${run.id}/${uuid()}.${ext}`;

        try {
          await uploadToR2(storageKey, imageBuffer, result.mimeType, imageBuffer.length);
          // Create a File record in DB
          await prisma.file.create({
            data: {
              userId: user.id,
              runId: run.id,
              kind: "output",
              mime: result.mimeType,
              size: imageBuffer.length,
              storageKey,
            },
          });
          // Generate signed URL for immediate display
          imageUrl = await getSignedDownloadUrl(storageKey);
        } catch (r2Err) {
          // R2 not configured or upload failed — fall back to data URI
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
        userId: user.id,
        runId: run.id,
        provider: "gemini",
        model: "gemini-2.5-flash-image",
        units: { outputTokens: 1290 },
        latencyMs: result.latencyMs,
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
  }, req);
}
