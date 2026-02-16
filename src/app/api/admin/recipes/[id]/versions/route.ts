import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/session";
import { prisma } from "@/lib/prisma";

// GET /api/admin/recipes/:id/versions — list all versions for a recipe
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuth(async (user) => {
    if (user.role !== "admin") {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const { id } = await params;

    const recipe = await prisma.recipe.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!recipe) {
      return NextResponse.json({ error: "Recipe not found" }, { status: 404 });
    }

    const versions = await prisma.recipeVersion.findMany({
      where: { recipeId: id },
      orderBy: { versionNumber: "desc" },
      include: { author: { select: { email: true } } },
    });

    return NextResponse.json({ versions });
  });
}
