import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { executeRecipe } from "@/lib/recipe-engine";

// Vercel serverless: recipe execution can take a long time
export const maxDuration = 300;

// POST /api/recipes/:id/execute — start a recipe execution
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

    let inputData = null;
    try {
      const body = await req.json();
      inputData = body.inputData || null;
    } catch {
      // No body or invalid JSON — that's fine
    }

    // Create execution record
    const execution = await prisma.recipeExecution.create({
      data: {
        recipeId,
        userId: user.id,
        totalSteps: recipe.steps.length,
        inputData,
      },
    });

    // Execute recipe (runs in-process for simplicity)
    // In production with Inngest, this would be a background job
    executeRecipe(execution.id).catch((err) => {
      console.error("[Recipe] Execution error:", err);
      prisma.recipeExecution.update({
        where: { id: execution.id },
        data: {
          status: "error",
          errorMessage: err instanceof Error ? err.message : "Unknown error",
          finishedAt: new Date(),
        },
      }).catch(() => {});
    });

    return NextResponse.json({ execution: { id: execution.id, status: "pending" } }, { status: 201 });
  }, req);
}
