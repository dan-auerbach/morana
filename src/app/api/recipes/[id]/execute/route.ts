import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { inngest } from "@/lib/inngest/client";
import { uploadToR2 } from "@/lib/storage";
import { v4 as uuid } from "uuid";

// Reduced: only need time for file upload + DB + enqueue (not full execution)
export const maxDuration = 30;

const ALLOWED_AUDIO_TYPES = [
  "audio/mpeg", "audio/mp3", "audio/wav", "audio/wave", "audio/x-wav",
  "audio/ogg", "audio/flac", "audio/x-flac", "audio/mp4", "audio/m4a",
  "audio/x-m4a", "audio/aac", "audio/webm",
];

// POST /api/recipes/:id/execute — start a recipe execution
// Supports:
//   - JSON body: { inputData: { text, transcriptText, audioUrl, language } }
//   - multipart/form-data: file (audio), language, transcriptText
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuth(async (user) => {
    const { id: recipeId } = await params;

    const recipe = await prisma.recipe.findUnique({
      where: { id: recipeId },
      include: { steps: { orderBy: { stepIndex: "asc" } } },
    });

    if (!recipe) {
      return NextResponse.json({ error: "Recipe not found" }, { status: 404 });
    }
    if (recipe.status !== "active") {
      return NextResponse.json({ error: "Recipe is not active" }, { status: 400 });
    }
    if (recipe.steps.length === 0) {
      return NextResponse.json({ error: "Recipe has no steps" }, { status: 400 });
    }

    let inputData: Record<string, unknown> | null = null;
    const contentType = req.headers.get("content-type") || "";

    if (contentType.includes("multipart/form-data")) {
      // Handle multipart file upload
      const formData = await req.formData();
      const file = formData.get("file") as File | null;
      const language = (formData.get("language") as string) || recipe.defaultLang || "sl";
      const transcriptText = formData.get("transcriptText") as string | null;
      const audioUrl = formData.get("audioUrl") as string | null;
      const text = formData.get("text") as string | null;

      if (transcriptText && transcriptText.trim().length > 0) {
        // User pasted a transcript — skip STT
        inputData = { transcriptText: transcriptText.trim(), language };
      } else if (file && file.size > 0) {
        // Validate audio type
        const fileType = (file.type || "").toLowerCase();
        const isAudio = ALLOWED_AUDIO_TYPES.includes(fileType) || fileType.startsWith("audio/");
        if (!isAudio) {
          return NextResponse.json({ error: `Unsupported audio type: ${fileType}` }, { status: 400 });
        }

        // Size check: 100MB max
        if (file.size > 100 * 1024 * 1024) {
          return NextResponse.json({ error: "File too large (max 100MB)" }, { status: 400 });
        }

        // Upload to R2
        const storageKey = `recipes/${recipeId}/${uuid()}/${file.name}`;
        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        await uploadToR2(storageKey, buffer, fileType, file.size);

        inputData = {
          audioStorageKey: storageKey,
          audioMimeType: fileType,
          language,
        };
      } else if (audioUrl && audioUrl.trim().length > 0) {
        // Audio URL mode
        inputData = { audioUrl: audioUrl.trim(), language };
      } else if (text && text.trim().length > 0) {
        // Plain text mode
        inputData = { text: text.trim(), language };
      }
    } else {
      // JSON body
      try {
        const body = await req.json();
        inputData = body.inputData || null;
      } catch {
        // No body or invalid JSON — that's fine
      }
    }

    // Create execution record
    const execution = await prisma.recipeExecution.create({
      data: {
        recipeId,
        userId: user.id,
        totalSteps: recipe.steps.length,
        recipeVersion: recipe.currentVersion,
        inputData: inputData ? (inputData as Prisma.InputJsonValue) : Prisma.DbNull,
      },
    });

    // Enqueue background execution via Inngest (non-blocking)
    await inngest.send({
      name: "recipe/execute",
      data: { executionId: execution.id, userId: user.id },
    });

    // Return immediately — frontend polls for progress
    return NextResponse.json({
      execution: { id: execution.id, status: "pending" },
    }, { status: 201 });
  }, req);
}
