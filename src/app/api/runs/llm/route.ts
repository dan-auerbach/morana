import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/session";
import { checkRateLimit, isModelAllowed, isModuleAllowed } from "@/lib/rate-limit";
import { prisma } from "@/lib/prisma";
import { getApprovedModels, config } from "@/lib/config";
import { runLLM } from "@/lib/providers/llm";
import { logUsage } from "@/lib/usage";
import { getActiveWorkspaceId } from "@/lib/workspace";

// Vercel serverless: LLM calls can take 30-60s for complex prompts
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  return withAuth(async (user) => {
    if (!(await isModuleAllowed(user.id, "llm"))) {
      return NextResponse.json({ error: "You don't have access to this module" }, { status: 403 });
    }

    const { modelId, prompt, sourceText } = await req.json();

    if (!modelId || !prompt) {
      return NextResponse.json({ error: "modelId and prompt are required" }, { status: 400 });
    }

    const models = getApprovedModels();
    const modelEntry = models.find((m) => m.id === modelId);
    if (!modelEntry) {
      return NextResponse.json({ error: "Model not approved" }, { status: 400 });
    }

    // Check per-user model restriction
    if (!(await isModelAllowed(user.id, modelId))) {
      return NextResponse.json({ error: "You do not have access to this model" }, { status: 403 });
    }

    const fullPrompt = sourceText ? `${prompt}\n\n---\nSource text:\n${sourceText}` : prompt;
    if (fullPrompt.length > config.maxLlmPromptChars) {
      return NextResponse.json(
        { error: `Prompt exceeds ${config.maxLlmPromptChars} character limit` },
        { status: 400 }
      );
    }

    const rl = await checkRateLimit(user.id);
    if (!rl.allowed) {
      return NextResponse.json({ error: rl.reason || "Rate limit reached", remaining: 0 }, { status: 429 });
    }

    const workspaceId = await getActiveWorkspaceId(user.id);

    const run = await prisma.run.create({
      data: {
        userId: user.id,
        type: "llm",
        status: "running",
        provider: modelEntry.provider,
        model: modelEntry.id,
        workspaceId: workspaceId || undefined,
      },
    });

    await prisma.runInput.create({
      data: { runId: run.id, payloadJson: { modelId, prompt, sourceText } },
    });

    try {
      const result = await runLLM(modelEntry, prompt, sourceText);

      await prisma.runOutput.create({
        data: {
          runId: run.id,
          payloadJson: {
            text: result.text,
            inputTokens: result.inputTokens,
            outputTokens: result.outputTokens,
            latencyMs: result.latencyMs,
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
        provider: modelEntry.provider,
        model: modelEntry.id,
        units: { inputTokens: result.inputTokens, outputTokens: result.outputTokens },
        latencyMs: result.latencyMs,
        workspaceId: workspaceId || undefined,
      });

      return NextResponse.json({
        runId: run.id,
        text: result.text,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        latencyMs: result.latencyMs,
      });
    } catch (err: unknown) {
      const internalMsg = err instanceof Error ? err.message : "Unknown error";
      console.error("[LLM] Processing error:", internalMsg);
      await prisma.run.update({
        where: { id: run.id },
        data: { status: "error", errorMessage: internalMsg, finishedAt: new Date() },
      });
      return NextResponse.json({ error: "LLM request failed. Please try again." }, { status: 500 });
    }
  }, req);
}
