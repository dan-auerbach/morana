import { prisma } from "./prisma";
import { estimateCostCents } from "./config";

export async function logUsage(params: {
  runId: string | null;
  userId: string;
  provider: string;
  model: string;
  units: Record<string, number>;
  latencyMs: number;
  workspaceId?: string | null;
}) {
  const costCents = estimateCostCents(params.model, params.units);
  await prisma.usageEvent.create({
    data: {
      runId: params.runId,
      userId: params.userId,
      workspaceId: params.workspaceId || null,
      provider: params.provider,
      model: params.model,
      unitsJson: params.units,
      costEstimateCents: costCents,
      latencyMs: params.latencyMs,
    },
  });
}
