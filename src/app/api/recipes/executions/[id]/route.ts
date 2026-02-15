import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/session";
import { prisma } from "@/lib/prisma";

// GET /api/recipes/executions/:id — get execution detail with step results
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
        stepResults: {
          orderBy: { stepIndex: "asc" },
          select: {
            id: true, stepIndex: true, status: true,
            inputPreview: true, outputPreview: true, outputFull: true,
            startedAt: true, finishedAt: true, errorMessage: true,
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

    return NextResponse.json({ execution });
  });
}

// POST /api/recipes/executions/:id — cancel execution
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuth(async (user) => {
    const { id } = await params;

    const execution = await prisma.recipeExecution.findUnique({
      where: { id },
    });

    if (!execution) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (execution.userId !== user.id && user.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (execution.status === "running" || execution.status === "pending") {
      await prisma.recipeExecution.update({
        where: { id },
        data: { status: "cancelled", finishedAt: new Date() },
      });
    }

    return NextResponse.json({ success: true });
  }, req);
}
