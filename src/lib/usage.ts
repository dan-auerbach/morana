import { prisma } from "./prisma";
import { estimateCostCents } from "./config";

export async function logUsage(params: {
  runId: string;
  userId: string;
  provider: string;
  model: string;
  units: Record<string, number>;
  latencyMs: number;
}) {
  const costCents = estimateCostCents(params.model, params.units);
  await prisma.usageEvent.create({
    data: {
      runId: params.runId,
      userId: params.userId,
      provider: params.provider,
      model: params.model,
      unitsJson: params.units,
      costEstimateCents: costCents,
      latencyMs: params.latencyMs,
    },
  });
}
