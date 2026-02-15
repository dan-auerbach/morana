import { NextResponse } from "next/server";
import { withAuth } from "@/lib/session";
import { prisma } from "@/lib/prisma";

// GET /api/recipes/executions — list user's executions
export async function GET() {
  return withAuth(async (user) => {
    const executions = await prisma.recipeExecution.findMany({
      where: { userId: user.id },
      orderBy: { startedAt: "desc" },
      take: 50,
      include: {
        recipe: { select: { name: true, slug: true } },
        _count: { select: { stepResults: true } },
      },
    });

    return NextResponse.json({ executions });
  });
}
