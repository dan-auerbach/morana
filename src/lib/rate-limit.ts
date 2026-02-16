import { prisma } from "./prisma";
import { config } from "./config";
import { checkWorkspaceCostCap } from "./workspace";

export async function checkRateLimit(
  userId: string,
  workspaceId?: string | null
): Promise<{ allowed: boolean; remaining: number; reason?: string }> {
  // Fetch user to check active status and per-user limits
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { active: true, maxRunsPerDay: true, maxMonthlyCostCents: true },
  });

  if (!user || !user.active) {
    return { allowed: false, remaining: 0, reason: "Account is deactivated" };
  }

  // Daily run limit
  const dailyLimit = user.maxRunsPerDay ?? config.maxRunsPerDayPerUser;
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const count = await prisma.run.count({
    where: {
      userId,
      createdAt: { gte: startOfDay },
    },
  });

  if (count >= dailyLimit) {
    return { allowed: false, remaining: 0, reason: `Daily limit reached (${dailyLimit} runs/day)` };
  }

  // Monthly cost — shared check for both per-user and global cap
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  // Per-user monthly cost limit (if set)
  if (user.maxMonthlyCostCents != null) {
    const monthlyUsage = await prisma.usageEvent.aggregate({
      where: { userId, createdAt: { gte: startOfMonth } },
      _sum: { costEstimateCents: true },
    });
    const monthlyCostCents = monthlyUsage._sum.costEstimateCents || 0;
    if (monthlyCostCents >= user.maxMonthlyCostCents) {
      return { allowed: false, remaining: 0, reason: `Monthly cost limit reached ($${(user.maxMonthlyCostCents / 100).toFixed(2)})` };
    }
  }

  // Workspace monthly cost cap (if workspace is set)
  if (workspaceId) {
    const wsCheck = await checkWorkspaceCostCap(workspaceId);
    if (!wsCheck.allowed) {
      return { allowed: false, remaining: 0, reason: wsCheck.reason };
    }
  }

  // Global monthly cost cap (all users combined)
  if (config.globalMaxMonthlyCostCents > 0) {
    const globalUsage = await prisma.usageEvent.aggregate({
      where: { createdAt: { gte: startOfMonth } },
      _sum: { costEstimateCents: true },
    });
    const globalCostCents = globalUsage._sum.costEstimateCents || 0;
    if (globalCostCents >= config.globalMaxMonthlyCostCents) {
      return { allowed: false, remaining: 0, reason: `Global monthly budget exhausted ($${(config.globalMaxMonthlyCostCents / 100).toFixed(2)})` };
    }
  }

  const remaining = Math.max(0, dailyLimit - count);
  return { allowed: true, remaining };
}

/**
 * Check if a user is allowed to use a specific model.
 * Returns true if allowedModels is null/empty (all models allowed),
 * or if the model is in the JSON array.
 */
export async function isModelAllowed(userId: string, modelId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { allowedModels: true },
  });

  if (!user) return false;

  // null = all models allowed
  if (user.allowedModels == null) return true;

  // Validate it's a JSON array of strings
  const models = user.allowedModels as unknown;
  if (!Array.isArray(models)) return true; // malformed data → allow all
  if (models.length === 0) return true;     // empty array → allow all

  return models.includes(modelId);
}
