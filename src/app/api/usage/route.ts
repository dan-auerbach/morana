import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getActiveWorkspaceId } from "@/lib/workspace";

export async function GET(req: NextRequest) {
  return withAuth(async (user) => {
    const url = new URL(req.url);
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const provider = url.searchParams.get("provider");
    const model = url.searchParams.get("model");
    const targetUserId = url.searchParams.get("userId");
    const wsFilter = url.searchParams.get("workspaceId");

    const where: Record<string, unknown> = {};

    if (user.role !== "admin") {
      where.userId = user.id;
    } else if (targetUserId) {
      where.userId = targetUserId;
    }

    // Workspace filtering
    if (wsFilter) {
      where.workspaceId = wsFilter;
    } else {
      const activeWs = await getActiveWorkspaceId(user.id);
      if (activeWs) where.workspaceId = activeWs;
    }

    if (provider) where.provider = provider;
    if (model) where.model = model;

    if (from || to) {
      where.createdAt = {};
      if (from) (where.createdAt as Record<string, unknown>).gte = new Date(from);
      if (to) (where.createdAt as Record<string, unknown>).lte = new Date(to + "T23:59:59Z");
    }

    try {
      const events = await prisma.usageEvent.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: 200,
        select: {
          id: true,
          provider: true,
          model: true,
          costEstimateCents: true,
          latencyMs: true,
          unitsJson: true,
          createdAt: true,
          user: { select: { email: true, name: true } },
        },
      });

      const totalCostCents = events.reduce((sum, e) => sum + e.costEstimateCents, 0);
      const totalLatency = events.reduce((sum, e) => sum + e.latencyMs, 0);

      const byModel: Record<string, { count: number; costCents: number }> = {};
      for (const e of events) {
        const key = `${e.provider}/${e.model}`;
        if (!byModel[key]) byModel[key] = { count: 0, costCents: 0 };
        byModel[key].count++;
        byModel[key].costCents += e.costEstimateCents;
      }

      // Recipe execution costs
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const recipeWhere: Record<string, any> = {
        status: "done",
        totalCostCents: { gt: 0 },
      };

      // User filtering
      if (where.userId) recipeWhere.userId = where.userId;

      // Date filtering
      if (from || to) {
        recipeWhere.startedAt = {};
        if (from) recipeWhere.startedAt.gte = new Date(from);
        if (to) recipeWhere.startedAt.lte = new Date(to + "T23:59:59Z");
      }

      // Workspace filtering via recipe relation
      if (where.workspaceId) {
        recipeWhere.recipe = { workspaceId: where.workspaceId };
      }

      const recipeExecutions = await prisma.recipeExecution.findMany({
        where: recipeWhere,
        orderBy: { startedAt: "desc" },
        take: 50,
        select: {
          id: true,
          totalCostCents: true,
          startedAt: true,
          finishedAt: true,
          recipe: { select: { name: true, slug: true } },
        },
      });

      const recipeTotalCostCents = recipeExecutions.reduce((s, r) => s + r.totalCostCents, 0);

      return NextResponse.json({
        events: events.map((e) => ({
          ...e,
          // Return both cents and formatted dollar value for UI
          costEstimateCents: e.costEstimateCents,
          costEstimate: e.costEstimateCents / 100,
        })),
        summary: {
          totalEvents: events.length,
          totalCostCents,
          totalCost: Math.round(totalCostCents) / 100,
          totalLatencyMs: totalLatency,
          byModel: Object.fromEntries(
            Object.entries(byModel).map(([k, v]) => [k, { count: v.count, cost: v.costCents / 100, costCents: v.costCents }])
          ),
        },
        recipeExecutions: recipeExecutions.map((re) => ({
          id: re.id,
          recipeName: re.recipe.name,
          recipeSlug: re.recipe.slug,
          totalCostCents: re.totalCostCents,
          totalCost: re.totalCostCents / 100,
          startedAt: re.startedAt,
          finishedAt: re.finishedAt,
        })),
        recipeSummary: {
          totalExecutions: recipeExecutions.length,
          totalCostCents: recipeTotalCostCents,
          totalCost: recipeTotalCostCents / 100,
        },
      });
    } catch (err) {
      console.error("[Usage API] Error:", err);
      const message = err instanceof Error ? err.message : "Failed to load usage data";
      return NextResponse.json({ error: message, events: [], summary: null, recipeExecutions: [], recipeSummary: null }, { status: 500 });
    }
  });
}
