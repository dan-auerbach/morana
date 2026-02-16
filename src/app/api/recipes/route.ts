import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getActiveWorkspaceId } from "@/lib/workspace";

function requireAdmin(role: string) {
  if (role !== "admin") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
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

// GET /api/recipes — list active recipes (scoped to workspace + global)
export async function GET() {
  return withAuth(async (user) => {
    const isAdmin = user.role === "admin";
    const workspaceId = await getActiveWorkspaceId(user.id);

    const recipes = await prisma.recipe.findMany({
      where: {
        ...(isAdmin ? {} : { status: "active" }),
        ...(workspaceId
          ? { OR: [{ workspaceId }, { workspaceId: null }] }
          : {}),
      },
      orderBy: { createdAt: "desc" },
      include: {
        steps: { orderBy: { stepIndex: "asc" }, select: { id: true, stepIndex: true, name: true, type: true } },
        _count: { select: { executions: true } },
      },
    });

    return NextResponse.json({ recipes });
  });
}

// POST /api/recipes — create a new recipe (admin only)
export async function POST(req: NextRequest) {
  return withAuth(async (user) => {
    const denied = requireAdmin(user.role);
    if (denied) return denied;

    const body = await req.json();
    const { name, slug, description, status } = body;

    if (!name || typeof name !== "string" || !name.trim()) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    const finalSlug = slug?.trim() || slugify(name);
    const existing = await prisma.recipe.findUnique({ where: { slug: finalSlug } });
    if (existing) {
      return NextResponse.json({ error: `Slug "${finalSlug}" already exists` }, { status: 409 });
    }

    const workspaceId = await getActiveWorkspaceId(user.id);

    const recipe = await prisma.recipe.create({
      data: {
        name: name.trim(),
        slug: finalSlug,
        description: description?.trim() || null,
        status: status || "draft",
        createdBy: user.id,
        workspaceId,
      },
    });

    return NextResponse.json({ recipe }, { status: 201 });
  }, req);
}
