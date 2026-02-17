/**
 * Auto-sync recipe presets from code to database.
 * Runs on server startup via instrumentation.ts.
 *
 * Compares preset definitions in recipe-presets.ts with DB steps.
 * If they differ, replaces all steps and increments version.
 */

import { prisma } from "./prisma";
import { RECIPE_PRESETS } from "./recipe-presets";
import { Prisma } from "@/generated/prisma/client";

/**
 * Normalize a step config for comparison.
 * Strips undefined values and sorts keys for consistent JSON.
 */
function normalizeConfig(config: Record<string, unknown>): string {
  return JSON.stringify(config, Object.keys(config).sort());
}

/**
 * Check if DB steps match preset steps.
 */
function stepsMatch(
  dbSteps: { stepIndex: number; name: string; type: string; config: unknown }[],
  presetSteps: { stepIndex: number; name: string; type: string; config: Record<string, unknown> }[]
): boolean {
  if (dbSteps.length !== presetSteps.length) return false;

  for (let i = 0; i < presetSteps.length; i++) {
    const ps = presetSteps[i];
    const ds = dbSteps.find((d) => d.stepIndex === ps.stepIndex);
    if (!ds) return false;
    if (ds.name !== ps.name || ds.type !== ps.type) return false;
    if (normalizeConfig(ds.config as Record<string, unknown>) !== normalizeConfig(ps.config)) {
      return false;
    }
  }

  return true;
}

/**
 * Sync all presets from code to database.
 * Called once on server startup.
 */
export async function syncAllPresets(): Promise<void> {
  try {
    for (const preset of RECIPE_PRESETS) {
      // Find the existing recipe by presetKey
      const recipe = await prisma.recipe.findUnique({
        where: { presetKey: preset.key },
        include: {
          steps: { orderBy: { stepIndex: "asc" } },
        },
      });

      // Not yet created — skip (user creates manually)
      if (!recipe) continue;

      // Compare steps
      if (stepsMatch(recipe.steps, preset.steps)) {
        continue; // Already in sync
      }

      // Steps differ — sync from preset
      console.log(`[Preset Sync] Updating "${preset.name}" (${preset.key}) v${recipe.currentVersion} → v${recipe.currentVersion + 1}`);

      // Increment version + update metadata
      await prisma.recipe.update({
        where: { id: recipe.id },
        data: {
          currentVersion: recipe.currentVersion + 1,
          name: preset.name,
          description: preset.description,
        },
      });

      // Replace all steps
      await prisma.recipeStep.deleteMany({ where: { recipeId: recipe.id } });

      for (const s of preset.steps) {
        await prisma.recipeStep.create({
          data: {
            recipeId: recipe.id,
            stepIndex: s.stepIndex,
            name: s.name,
            type: s.type,
            config: s.config as Prisma.InputJsonValue,
          },
        });
      }

      console.log(`[Preset Sync] ✓ "${preset.name}" synced (${preset.steps.length} steps)`);
    }
  } catch (err) {
    // Non-fatal: log and continue — app still works, just with old steps
    console.error("[Preset Sync] Error during auto-sync:", err);
  }
}
