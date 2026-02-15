import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";

function requireAdmin(role: string) {
  if (role !== "admin") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }
  return null;
}

/**
 * Normalize allowedModels input to JSON array or null.
 */
function normalizeAllowedModels(input: unknown): string[] | null {
  if (input === null || input === undefined || input === "") return null;
  if (Array.isArray(input)) {
    const filtered = input.filter((m) => typeof m === "string" && m.trim().length > 0).map((m: string) => m.trim());
    return filtered.length > 0 ? filtered : null;
  }
  if (typeof input === "string") {
    try {
      const parsed = JSON.parse(input);
      if (Array.isArray(parsed)) return normalizeAllowedModels(parsed);
    } catch {
      const arr = input.split(",").map((s) => s.trim()).filter(Boolean);
      return arr.length > 0 ? arr : null;
    }
  }
  return null;
}

// GET /api/admin/users/:id — get user detail with usage history
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuth(async (user) => {
    const denied = requireAdmin(user.role);
    if (denied) return denied;

    const { id } = await params;

    try {
      const targetUser = await prisma.user.findUnique({
        where: { id },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          active: true,
          createdAt: true,
          lastLoginAt: true,
          maxRunsPerDay: true,
          maxMonthlyCostCents: true,
          allowedModels: true,
        },
      });

      if (!targetUser) {
        return NextResponse.json({ error: "User not found" }, { status: 404 });
      }

      // Recent runs
      const recentRuns = await prisma.run.findMany({
        where: { userId: id },
        orderBy: { createdAt: "desc" },
        take: 50,
        select: {
          id: true,
          type: true,
          status: true,
          provider: true,
          model: true,
          createdAt: true,
          errorMessage: true,
        },
      });

      // Monthly usage stats
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);

      const monthlyUsage = await prisma.usageEvent.aggregate({
        where: { userId: id, createdAt: { gte: startOfMonth } },
        _sum: { costEstimateCents: true },
        _count: true,
      });

      // Today's run count
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      const todayRuns = await prisma.run.count({
        where: { userId: id, createdAt: { gte: startOfDay } },
      });

      return NextResponse.json({
        user: {
          ...targetUser,
          allowedModels: targetUser.allowedModels as string[] | null,
        },
        recentRuns,
        stats: {
          monthlyCostCents: monthlyUsage._sum.costEstimateCents || 0,
          monthlyCost: (monthlyUsage._sum.costEstimateCents || 0) / 100,
          monthlyRuns: monthlyUsage._count,
          todayRuns,
        },
      });
    } catch (err) {
      console.error("[Admin User Detail] Error:", err);
      return NextResponse.json({ error: "Failed to load user" }, { status: 500 });
    }
  });
}

// PATCH /api/admin/users/:id — update user settings
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuth(async (user) => {
    const denied = requireAdmin(user.role);
    if (denied) return denied;

    const { id } = await params;
    const body = await req.json();

    const targetUser = await prisma.user.findUnique({ where: { id } });
    if (!targetUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Build update data — only include fields that were explicitly sent
    const data: Record<string, unknown> = {};
    if (body.role !== undefined) data.role = body.role === "admin" ? "admin" : "user";
    if (body.active !== undefined) data.active = !!body.active;
    if (body.maxRunsPerDay !== undefined) data.maxRunsPerDay = body.maxRunsPerDay === null || body.maxRunsPerDay === "" ? null : parseInt(body.maxRunsPerDay);
    if (body.maxMonthlyCostCents !== undefined) data.maxMonthlyCostCents = body.maxMonthlyCostCents === null || body.maxMonthlyCostCents === "" ? null : parseInt(body.maxMonthlyCostCents);
    if (body.allowedModels !== undefined) {
      const normalized = normalizeAllowedModels(body.allowedModels);
      data.allowedModels = normalized ?? Prisma.DbNull;
    }

    const updated = await prisma.user.update({
      where: { id },
      data,
    });

    return NextResponse.json({ user: updated });
  }, req);
}

// DELETE /api/admin/users/:id — deactivate user (soft delete)
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuth(async (user) => {
    const denied = requireAdmin(user.role);
    if (denied) return denied;

    const { id } = await params;

    // Don't allow admin to deactivate themselves
    if (id === user.id) {
      return NextResponse.json({ error: "Cannot deactivate yourself" }, { status: 400 });
    }

    await prisma.user.update({
      where: { id },
      data: { active: false },
    });

    return NextResponse.json({ ok: true });
  }, req);
}
