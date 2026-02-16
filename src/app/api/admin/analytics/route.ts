import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/session";
import { prisma } from "@/lib/prisma";

function requireAdmin(role: string) {
  if (role !== "admin") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }
  return null;
}

const VALID_PERIODS = ["7d", "30d", "90d"] as const;
type Period = (typeof VALID_PERIODS)[number];

// GET /api/admin/analytics?period=7d|30d|90d
export async function GET(req: NextRequest) {
  return withAuth(async (user) => {
    const denied = requireAdmin(user.role);
    if (denied) return denied;

    const { searchParams } = new URL(req.url);
    const rawPeriod = searchParams.get("period") ?? "30d";
    const period: Period = VALID_PERIODS.includes(rawPeriod as Period)
      ? (rawPeriod as Period)
      : "30d";

    const days = period === "7d" ? 7 : period === "90d" ? 90 : 30;
    const since = new Date(Date.now() - days * 86400000);

    try {
      // ── 1) Total runs & error count ──────────────────────────────
      const totalRuns = await prisma.run.count({
        where: { createdAt: { gte: since } },
      });

      const totalErrorRuns = await prisma.run.count({
        where: { createdAt: { gte: since }, status: "error" },
      });

      const errorRate = totalRuns > 0 ? (totalErrorRuns / totalRuns) * 100 : 0;

      // ── 2) Total cost & avg latency from UsageEvent ──────────────
      const usageAgg = await prisma.usageEvent.aggregate({
        where: { createdAt: { gte: since } },
        _sum: { costEstimateCents: true },
        _avg: { latencyMs: true },
      });

      const totalCostCents = usageAgg._sum.costEstimateCents ?? 0;
      const avgLatencyMs = Math.round(usageAgg._avg.latencyMs ?? 0);

      // ── 3) By provider: group Run by provider ────────────────────
      const runsByProvider = await prisma.run.groupBy({
        by: ["provider"],
        where: { createdAt: { gte: since } },
        _count: { id: true },
      });

      const errorsByProvider = await prisma.run.groupBy({
        by: ["provider"],
        where: { createdAt: { gte: since }, status: "error" },
        _count: { id: true },
      });

      const errorMap = new Map(
        errorsByProvider.map((e) => [e.provider, e._count.id])
      );

      // Get avg latency & cost per provider from UsageEvent
      const usageByProvider = await prisma.usageEvent.groupBy({
        by: ["provider"],
        where: { createdAt: { gte: since } },
        _avg: { latencyMs: true },
        _sum: { costEstimateCents: true },
      });

      const usageProviderMap = new Map(
        usageByProvider.map((u) => [
          u.provider,
          {
            avgLatencyMs: Math.round(u._avg.latencyMs ?? 0),
            totalCostCents: u._sum.costEstimateCents ?? 0,
          },
        ])
      );

      const byProvider = runsByProvider.map((r) => {
        const runs = r._count.id;
        const errors = errorMap.get(r.provider) ?? 0;
        const usage = usageProviderMap.get(r.provider);
        return {
          provider: r.provider,
          runs,
          errors,
          errorRate: runs > 0 ? (errors / runs) * 100 : 0,
          avgLatencyMs: usage?.avgLatencyMs ?? 0,
          totalCostCents: usage?.totalCostCents ?? 0,
        };
      });

      // ── 4) By model: group UsageEvent by model ───────────────────
      const usageByModel = await prisma.usageEvent.groupBy({
        by: ["model"],
        where: { createdAt: { gte: since } },
        _count: { id: true },
        _avg: { latencyMs: true },
        _sum: { costEstimateCents: true },
      });

      const byModel = usageByModel.map((u) => ({
        model: u.model,
        runs: u._count.id,
        avgLatencyMs: Math.round(u._avg.latencyMs ?? 0),
        totalCostCents: u._sum.costEstimateCents ?? 0,
      }));

      // ── 5) Execution metrics from RecipeExecution ────────────────
      const totalExecutions = await prisma.recipeExecution.count({
        where: { startedAt: { gte: since } },
      });

      const doneExecutions = await prisma.recipeExecution.count({
        where: { startedAt: { gte: since }, status: "done" },
      });

      const successRate =
        totalExecutions > 0 ? (doneExecutions / totalExecutions) * 100 : 0;

      // Calculate avg duration from finished executions
      const finishedExecutions = await prisma.recipeExecution.findMany({
        where: {
          startedAt: { gte: since },
          status: "done",
          finishedAt: { not: null },
        },
        select: { startedAt: true, finishedAt: true },
      });

      let avgDurationMs = 0;
      if (finishedExecutions.length > 0) {
        const totalDurationMs = finishedExecutions.reduce((sum, ex) => {
          return sum + (ex.finishedAt!.getTime() - ex.startedAt.getTime());
        }, 0);
        avgDurationMs = Math.round(totalDurationMs / finishedExecutions.length);
      }

      const executionMetrics = {
        total: totalExecutions,
        avgDurationMs,
        successRate,
      };

      return NextResponse.json({
        period,
        totalRuns,
        totalCostCents,
        errorRate,
        avgLatencyMs,
        byProvider,
        byModel,
        executionMetrics,
      });
    } catch (err) {
      console.error("[Admin Analytics] Error:", err);
      return NextResponse.json(
        { error: "Failed to fetch analytics" },
        { status: 500 }
      );
    }
  });
}
