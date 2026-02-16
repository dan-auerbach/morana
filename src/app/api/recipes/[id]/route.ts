import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/session";
import { prisma } from "@/lib/prisma";

function requireAdmin(role: string) {
  if (role !== "admin") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }
  return null;
}

// GET /api/recipes/:id — get recipe detail with steps
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuth(async () => {
    const { id } = await params;
    const recipe = await prisma.recipe.findUnique({
      where: { id },
      include: {
        steps: { orderBy: { stepIndex: "asc" } },
        creator: { select: { email: true } },
        _count: { select: { executions: true } },
      },
    });

    if (!recipe) {
      return NextResponse.json({ error: "Recipe not found" }, { status: 404 });
    }

    return NextResponse.json({ recipe });
  });
}

// PATCH /api/recipes/:id — update recipe (admin)
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuth(async (user) => {
    const denied = requireAdmin(user.role);
    if (denied) return denied;

    const { id } = await params;
    const body = await req.json();

    const data: Record<string, unknown> = {};
    if (body.name !== undefined) data.name = body.name.trim();
    if (body.description !== undefined) data.description = body.description?.trim() || null;
    if (body.status !== undefined) data.status = body.status;
    if (body.inputKind !== undefined) data.inputKind = body.inputKind;
    if (body.inputModes !== undefined) data.inputModes = body.inputModes;
    if (body.defaultLang !== undefined) data.defaultLang = body.defaultLang || null;
    if (body.uiHints !== undefined) data.uiHints = body.uiHints;

    const recipe = await prisma.recipe.update({ where: { id }, data });
    return NextResponse.json({ recipe });
  }, req);
}

// DELETE /api/recipes/:id — delete recipe (admin)
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuth(async (user) => {
    const denied = requireAdmin(user.role);
    if (denied) return denied;

    const { id } = await params;
    await prisma.recipe.delete({ where: { id } });
    return NextResponse.json({ success: true });
  }, req);
}
