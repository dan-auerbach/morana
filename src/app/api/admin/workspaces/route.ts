import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";

function requireSuperAdmin(role: string) {
  if (role !== "admin") {
    return NextResponse.json({ error: "Super-admin access required" }, { status: 403 });
  }
  return null;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// GET /api/admin/workspaces — list all workspaces (super-admin)
export async function GET() {
  return withAuth(async (user) => {
    const denied = requireSuperAdmin(user.role);
    if (denied) return denied;

    const workspaces = await prisma.workspace.findMany({
      orderBy: { name: "asc" },
      include: {
        _count: { select: { members: true, conversations: true, recipes: true } },
      },
    });

    return NextResponse.json({ workspaces });
  });
}

// POST /api/admin/workspaces — create workspace
export async function POST(req: NextRequest) {
  return withAuth(async (user) => {
    const denied = requireSuperAdmin(user.role);
    if (denied) return denied;

    const body = await req.json();
    const { name, slug, maxMonthlyCostCents, allowedModels } = body;

    if (!name || typeof name !== "string" || !name.trim()) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    const finalSlug = slug?.trim() || slugify(name);
    const existing = await prisma.workspace.findUnique({ where: { slug: finalSlug } });
    if (existing) {
      return NextResponse.json({ error: `Slug "${finalSlug}" already exists` }, { status: 409 });
    }

    const workspace = await prisma.workspace.create({
      data: {
        name: name.trim(),
        slug: finalSlug,
        maxMonthlyCostCents: maxMonthlyCostCents != null ? parseInt(maxMonthlyCostCents) : null,
        allowedModels: Array.isArray(allowedModels) ? (allowedModels as Prisma.InputJsonValue) : Prisma.DbNull,
        members: {
          // Auto-add the creator as workspace admin
          create: { userId: user.id, role: "admin" },
        },
      },
    });

    return NextResponse.json({ workspace }, { status: 201 });
  }, req);
}
