import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/session";
import { prisma } from "@/lib/prisma";

function requireSuperAdmin(role: string) {
  if (role !== "admin") {
    return NextResponse.json({ error: "Super-admin access required" }, { status: 403 });
  }
  return null;
}

// GET /api/admin/workspaces/:id — workspace detail with members
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuth(async (user) => {
    const denied = requireSuperAdmin(user.role);
    if (denied) return denied;

    const { id } = await params;
    const workspace = await prisma.workspace.findUnique({
      where: { id },
      include: {
        members: {
          include: { user: { select: { id: true, email: true, name: true, role: true } } },
          orderBy: { createdAt: "asc" },
        },
        _count: { select: { conversations: true, recipes: true, promptTemplates: true, knowledgeBases: true } },
      },
    });

    if (!workspace) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }

    // Get monthly cost
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    const usage = await prisma.usageEvent.aggregate({
      where: { workspaceId: id, createdAt: { gte: startOfMonth } },
      _sum: { costEstimateCents: true },
    });

    return NextResponse.json({
      workspace,
      monthlyCostCents: usage._sum.costEstimateCents || 0,
    });
  });
}

// PATCH /api/admin/workspaces/:id — update workspace settings + membership
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuth(async (user) => {
    const denied = requireSuperAdmin(user.role);
    if (denied) return denied;

    const { id } = await params;
    const body = await req.json();

    const existing = await prisma.workspace.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }

    // Handle member management
    if (body.action === "addMember") {
      const { userId, role } = body;
      if (!userId) return NextResponse.json({ error: "userId required" }, { status: 400 });
      await prisma.workspaceMember.upsert({
        where: { workspaceId_userId: { workspaceId: id, userId } },
        create: { workspaceId: id, userId, role: role || "member" },
        update: { role: role || "member" },
      });
      return NextResponse.json({ success: true });
    }

    if (body.action === "removeMember") {
      const { userId } = body;
      if (!userId) return NextResponse.json({ error: "userId required" }, { status: 400 });
      await prisma.workspaceMember.deleteMany({
        where: { workspaceId: id, userId },
      });
      return NextResponse.json({ success: true });
    }

    // Update workspace settings
    const data: Record<string, unknown> = {};
    if (body.name !== undefined) data.name = body.name.trim();
    if (body.isActive !== undefined) data.isActive = Boolean(body.isActive);
    if (body.maxMonthlyCostCents !== undefined) {
      data.maxMonthlyCostCents = body.maxMonthlyCostCents != null ? parseInt(body.maxMonthlyCostCents) : null;
    }
    if (body.allowedModels !== undefined) {
      data.allowedModels = Array.isArray(body.allowedModels) ? body.allowedModels : null;
    }

    const workspace = await prisma.workspace.update({ where: { id }, data });
    return NextResponse.json({ workspace });
  }, req);
}

// DELETE /api/admin/workspaces/:id — delete workspace (protects default)
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuth(async (user) => {
    const denied = requireSuperAdmin(user.role);
    if (denied) return denied;

    const { id } = await params;
    const ws = await prisma.workspace.findUnique({ where: { id } });
    if (!ws) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (ws.slug === "default") {
      return NextResponse.json({ error: "Cannot delete the default workspace" }, { status: 400 });
    }

    await prisma.workspace.delete({ where: { id } });
    return NextResponse.json({ success: true });
  }, req);
}
