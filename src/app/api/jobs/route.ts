import { NextResponse } from "next/server";
import { withAuth } from "@/lib/session";
import { prisma } from "@/lib/prisma";

// GET /api/jobs — list user's recent recipe executions (jobs)
export async function GET() {
  return withAuth(async (user) => {
    const isAdmin = user.role === "admin";

    const executions = await prisma.recipeExecution.findMany({
      where: isAdmin ? {} : { userId: user.id },
      orderBy: { startedAt: "desc" },
      take: 100,
      include: {
        recipe: { select: { name: true, slug: true } },
        user: { select: { email: true } },
        stepResults: {
          orderBy: { stepIndex: "asc" },
          select: {
            id: true,
            stepIndex: true,
            status: true,
            startedAt: true,
            finishedAt: true,
            errorMessage: true,
          },
        },
      },
    });

    return NextResponse.json({ jobs: executions });
  });
}
