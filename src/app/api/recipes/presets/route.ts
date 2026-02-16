import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { RECIPE_PRESETS, getPreset } from "@/lib/recipe-presets";
import { getActiveWorkspaceId } from "@/lib/workspace";

function requireAdmin(role: string) {
  if (role !== "admin") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }
  return null;
}

// GET /api/recipes/presets — list available presets
export async function GET() {
  return withAuth(async (user) => {
    const denied = requireAdmin(user.role);
    if (denied) return denied;

    // Check which presets are already instantiated
    const existing = await prisma.recipe.findMany({
      where: { isPreset: true, presetKey: { not: null } },
      select: { presetKey: true },
    });
    const existingKeys = new Set(existing.map((r) => r.presetKey));

    const presets = RECIPE_PRESETS.map((p) => ({
      key: p.key,
      name: p.name,
      description: p.description,
      stepsCount: p.steps.length,
      stepTypes: p.steps.map((s) => s.type),
      alreadyCreated: existingKeys.has(p.key),
    }));

    return NextResponse.json({ presets });
  });
}

// POST /api/recipes/presets — instantiate a preset as a recipe
export async function POST(req: NextRequest) {
  return withAuth(async (user) => {
    const denied = requireAdmin(user.role);
    if (denied) return denied;

    const { presetKey } = await req.json();
    if (!presetKey) {
      return NextResponse.json({ error: "presetKey required" }, { status: 400 });
    }

    const preset = getPreset(presetKey);
    if (!preset) {
      return NextResponse.json({ error: "Unknown preset" }, { status: 404 });
    }

    // Check if already exists
    const existing = await prisma.recipe.findUnique({ where: { presetKey } });
    if (existing) {
      return NextResponse.json({ error: "Preset already created", recipeId: existing.id }, { status: 409 });
    }

    const workspaceId = await getActiveWorkspaceId(user.id);

    const recipe = await prisma.recipe.create({
      data: {
        name: preset.name,
        slug: preset.key,
        description: preset.description,
        status: "active",
        isPreset: true,
        presetKey: preset.key,
        createdBy: user.id,
        workspaceId,
        steps: {
          create: preset.steps.map((s) => ({
            stepIndex: s.stepIndex,
            name: s.name,
            type: s.type,
            config: s.config as Prisma.InputJsonValue,
          })),
        },
      },
      include: {
        steps: { orderBy: { stepIndex: "asc" } },
      },
    });

    return NextResponse.json({ recipe }, { status: 201 });
  }, req);
}
