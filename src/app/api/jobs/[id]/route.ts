import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { executeRecipe } from "@/lib/recipe-engine";

// GET /api/jobs/:id — get job detail with step results
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuth(async (user) => {
    const { id } = await params;

    const execution = await prisma.recipeExecution.findUnique({
      where: { id },
      include: {
        recipe: { select: { name: true, slug: true } },
        user: { select: { email: true } },
        stepResults: {
          orderBy: { stepIndex: "asc" },
          select: {
            id: true,
            stepIndex: true,
            status: true,
            inputPreview: true,
            outputPreview: true,
            outputFull: true,
            startedAt: true,
            finishedAt: true,
            errorMessage: true,
          },
        },
      },
    });

    if (!execution) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (execution.userId !== user.id && user.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    return NextResponse.json({ job: execution });
  });
}

// POST /api/jobs/:id — cancel or retry execution
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuth(async (user) => {
    const { id } = await params;
    const body = await req.json();
    const action = body.action as string;

    const execution = await prisma.recipeExecution.findUnique({
      where: { id },
    });

    if (!execution) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (execution.userId !== user.id && user.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (action === "cancel") {
      if (execution.status === "running" || execution.status === "pending") {
        await prisma.recipeExecution.update({
          where: { id },
          data: { status: "cancelled", finishedAt: new Date() },
        });
        return NextResponse.json({ success: true, message: "Job cancelled" });
      }
      return NextResponse.json({ error: "Job is not running" }, { status: 400 });
    }

    if (action === "retry") {
      if (execution.status === "error" || execution.status === "cancelled") {
        // Create a new execution for the same recipe
        const recipe = await prisma.recipe.findUnique({
          where: { id: execution.recipeId },
          include: { steps: { orderBy: { stepIndex: "asc" } } },
        });

        if (!recipe || recipe.status !== "active") {
          return NextResponse.json({ error: "Recipe no longer available" }, { status: 400 });
        }

        const newExecution = await prisma.recipeExecution.create({
          data: {
            recipeId: execution.recipeId,
            userId: user.id,
            totalSteps: recipe.steps.length,
            inputData: execution.inputData === null
              ? Prisma.DbNull
              : (execution.inputData as Prisma.InputJsonValue),
          },
        });

        // Execute in background
        executeRecipe(newExecution.id).catch((err) => {
          console.error("[Jobs] Retry execution error:", err);
          prisma.recipeExecution.update({
            where: { id: newExecution.id },
            data: {
              status: "error",
              errorMessage: err instanceof Error ? err.message : "Unknown error",
              finishedAt: new Date(),
            },
          }).catch(() => {});
        });

        return NextResponse.json({
          success: true,
          message: "Job retried",
          newJobId: newExecution.id,
        }, { status: 201 });
      }
      return NextResponse.json({ error: "Can only retry failed or cancelled jobs" }, { status: 400 });
    }

    return NextResponse.json({ error: "Unknown action. Use 'cancel' or 'retry'" }, { status: 400 });
  }, req);
}
