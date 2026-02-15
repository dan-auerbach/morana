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
    const { steps } = body;

    if (!Array.isArray(steps)) {
      return NextResponse.json({ error: "steps must be an array" }, { status: 400 });
    }

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
