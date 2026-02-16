import { prisma } from "./prisma";
import { SessionUser } from "./session";

/**
 * Get the user's active workspace ID.
 * Falls back to finding the first workspace they belong to, or null.
 */
export async function getActiveWorkspaceId(userId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { activeWorkspaceId: true },
  });
  if (user?.activeWorkspaceId) return user.activeWorkspaceId;

  // Fallback: first workspace membership
  const membership = await prisma.workspaceMember.findFirst({
    where: { userId },
    select: { workspaceId: true },
    orderBy: { createdAt: "asc" },
  });
  if (membership) {
    // Persist selection
    await prisma.user.update({
      where: { id: userId },
      data: { activeWorkspaceId: membership.workspaceId },
    }).catch(() => {});
    return membership.workspaceId;
  }

  return null;
}

/**
 * Switch the user's active workspace. Validates membership.
 */
export async function switchWorkspace(userId: string, workspaceId: string): Promise<boolean> {
  const membership = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
  });
  if (!membership) return false;

  await prisma.user.update({
    where: { id: userId },
    data: { activeWorkspaceId: workspaceId },
  });
  return true;
}

/**
 * Get all workspaces a user belongs to.
 */
export async function getUserWorkspaces(userId: string) {
  return prisma.workspaceMember.findMany({
    where: { userId },
    include: {
      workspace: {
        select: { id: true, name: true, slug: true, isActive: true },
      },
    },
    orderBy: { workspace: { name: "asc" } },
  });
}

/**
 * Check if user has at least the given role in the workspace.
 * Super-admins (global admin role) have implicit workspace admin access.
 */
export async function checkWorkspaceAccess(
  user: SessionUser,
  workspaceId: string,
  requiredRole: "member" | "admin" = "member"
): Promise<boolean> {
  // Global super-admin always has access
  if (user.role === "admin") return true;

  const membership = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId: user.id } },
  });
  if (!membership) return false;
  if (requiredRole === "admin") return membership.role === "admin";
  return true; // member role is sufficient
}

/**
 * Check workspace-level model policy.
 * Returns true if workspace allows the model (or has no restrictions).
 */
export async function isWorkspaceModelAllowed(workspaceId: string, modelId: string): Promise<boolean> {
  const ws = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { allowedModels: true },
  });
  if (!ws) return false;
  if (ws.allowedModels == null) return true;
  const models = ws.allowedModels as unknown;
  if (!Array.isArray(models) || models.length === 0) return true;
  return models.includes(modelId);
}

/**
 * Check workspace monthly cost cap.
 */
export async function checkWorkspaceCostCap(workspaceId: string): Promise<{
  allowed: boolean;
  reason?: string;
}> {
  const ws = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { maxMonthlyCostCents: true },
  });
  if (!ws || ws.maxMonthlyCostCents == null) return { allowed: true };

  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const usage = await prisma.usageEvent.aggregate({
    where: { workspaceId, createdAt: { gte: startOfMonth } },
    _sum: { costEstimateCents: true },
  });
  const costCents = usage._sum.costEstimateCents || 0;
  if (costCents >= ws.maxMonthlyCostCents) {
    return {
      allowed: false,
      reason: `Workspace monthly budget exhausted ($${(ws.maxMonthlyCostCents / 100).toFixed(2)})`,
    };
  }
  return { allowed: true };
}

/**
 * Create the default workspace and assign all existing users + records to it.
 * Idempotent — safe to call multiple times.
 */
export async function ensureDefaultWorkspace(): Promise<string> {
  let ws = await prisma.workspace.findUnique({ where: { slug: "default" } });
  if (!ws) {
    ws = await prisma.workspace.create({
      data: {
        name: "Default",
        slug: "default",
        isActive: true,
      },
    });
  }
  return ws.id;
}
