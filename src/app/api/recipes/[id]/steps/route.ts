import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/session";
import { prisma } from "@/lib/prisma";

function requireAdmin(role: string) {
  if (role !== "admin") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }
  return null;
}

// PUT /api/recipes/:id/steps — replace all steps
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuth(async (user) => {
    const denied = requireAdmin(user.role);
    if (denied) return denied;

    const { id: recipeId } = await params;
    const body = await req.json();
    const { steps, changeNote } = body;

    if (!Array.isArray(steps)) {
      return NextResponse.json({ error: "steps must be an array" }, { status: 400 });
    }

    // Fetch the current recipe including its steps before making changes
    const recipe = await prisma.recipe.findUnique({
      where: { id: recipeId },
      include: { steps: true },
    });

    if (!recipe) {
      return NextResponse.json({ error: "Recipe not found" }, { status: 404 });
    }

    // Create a version snapshot of the current state
    await prisma.recipeVersion.create({
      data: {
        recipeId,
        versionNumber: recipe.currentVersion,
        stepsSnapshot: JSON.parse(JSON.stringify(recipe.steps)),
        name: recipe.name,
        description: recipe.description,
        changedBy: user.id,
        changeNote: changeNote || null,
      },
    });

    // Increment the recipe's currentVersion
    await prisma.recipe.update({
      where: { id: recipeId },
      data: { currentVersion: recipe.currentVersion + 1 },
    });

    // Delete existing steps and recreate
    await prisma.recipeStep.deleteMany({ where: { recipeId } });

    const created = [];
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      const step = await prisma.recipeStep.create({
        data: {
          recipeId,
          stepIndex: i,
          name: s.name || `Step ${i + 1}`,
          type: s.type || "llm",
          config: s.config || {},
        },
      });
      created.push(step);
    }

    return NextResponse.json({ steps: created });
  }, req);
}
