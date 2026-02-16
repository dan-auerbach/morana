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
      });
    } catch (err) {
      console.error("[Usage API] Error:", err);
      const message = err instanceof Error ? err.message : "Failed to load usage data";
      return NextResponse.json({ error: message, events: [], summary: null }, { status: 500 });
    }
  });
}
