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
        inputKind: preset.inputKind || "text",
        inputModes: preset.inputModes ? (preset.inputModes as Prisma.InputJsonValue) : Prisma.DbNull,
        defaultLang: preset.defaultLang || null,
        uiHints: preset.uiHints ? (preset.uiHints as Prisma.InputJsonValue) : Prisma.DbNull,
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

// PUT /api/recipes/presets — sync an existing preset recipe from code
// Updates all steps to match the current preset definition in recipe-presets.ts
export async function PUT(req: NextRequest) {
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

    // Find the existing recipe
    const recipe = await prisma.recipe.findUnique({
      where: { presetKey },
      include: { steps: true },
    });
    if (!recipe) {
      return NextResponse.json({ error: "Preset not yet created" }, { status: 404 });
    }

    // Create version snapshot of current state (audit trail)
    await prisma.recipeVersion.create({
      data: {
        recipeId: recipe.id,
        versionNumber: recipe.currentVersion,
        stepsSnapshot: JSON.parse(JSON.stringify(recipe.steps)),
        name: recipe.name,
        description: recipe.description,
        changedBy: user.id,
        changeNote: `Synced from preset "${presetKey}"`,
      },
    });

    // Increment version
    await prisma.recipe.update({
      where: { id: recipe.id },
      data: {
        currentVersion: recipe.currentVersion + 1,
        name: preset.name,
        description: preset.description,
        inputKind: preset.inputKind || "text",
        inputModes: preset.inputModes ? (preset.inputModes as Prisma.InputJsonValue) : Prisma.DbNull,
        defaultLang: preset.defaultLang || null,
        uiHints: preset.uiHints ? (preset.uiHints as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
      },
    });

    // Replace all steps with preset definition
    await prisma.recipeStep.deleteMany({ where: { recipeId: recipe.id } });

    const created = [];
    for (const s of preset.steps) {
      const step = await prisma.recipeStep.create({
        data: {
          recipeId: recipe.id,
          stepIndex: s.stepIndex,
          name: s.name,
          type: s.type,
          config: s.config as Prisma.InputJsonValue,
        },
      });
      created.push(step);
    }

    return NextResponse.json({
      recipe: { id: recipe.id, name: preset.name, version: recipe.currentVersion + 1 },
      steps: created,
      synced: true,
    });
  }, req);
}
