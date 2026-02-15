import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/session";
import { prisma } from "@/lib/prisma";

function requireAdmin(role: string) {
  if (role !== "admin") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }
  return null;
}

// GET /api/admin/templates/:id — get template detail
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuth(async (user) => {
    const denied = requireAdmin(user.role);
    if (denied) return denied;

    const { id } = await params;
    const template = await prisma.promptTemplate.findUnique({
      where: { id },
      include: { creator: { select: { email: true, name: true } } },
    });

    if (!template) {
      return NextResponse.json({ error: "Template not found" }, { status: 404 });
    }

    return NextResponse.json({ template });
  });
}

// PATCH /api/admin/templates/:id — update template
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuth(async (user) => {
    const denied = requireAdmin(user.role);
    if (denied) return denied;

    const { id } = await params;
    const body = await req.json();

    const existing = await prisma.promptTemplate.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Template not found" }, { status: 404 });
    }

    // Build update data from allowed fields
    const data: Record<string, unknown> = {};
    if (body.name !== undefined) data.name = body.name.trim();
    if (body.slug !== undefined) {
      const newSlug = body.slug.trim();
      if (newSlug !== existing.slug) {
        const conflict = await prisma.promptTemplate.findUnique({ where: { slug: newSlug } });
        if (conflict) {
          return NextResponse.json({ error: `Slug "${newSlug}" already exists` }, { status: 409 });
        }
      }
      data.slug = newSlug;
    }
    if (body.description !== undefined) data.description = body.description?.trim() || null;
    if (body.systemPrompt !== undefined) data.systemPrompt = body.systemPrompt.trim();
    if (body.userPromptTemplate !== undefined) data.userPromptTemplate = body.userPromptTemplate?.trim() || null;
    if (body.category !== undefined) data.category = body.category.trim();
    if (body.knowledgeText !== undefined) data.knowledgeText = body.knowledgeText?.trim() || null;
    if (body.isActive !== undefined) data.isActive = Boolean(body.isActive);
    if (body.sortOrder !== undefined) data.sortOrder = parseInt(body.sortOrder) || 0;

    const template = await prisma.promptTemplate.update({
      where: { id },
      data,
    });

    return NextResponse.json({ template });
  }, req);
}

// DELETE /api/admin/templates/:id — delete template
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuth(async (user) => {
    const denied = requireAdmin(user.role);
    if (denied) return denied;

    const { id } = await params;
    const existing = await prisma.promptTemplate.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Template not found" }, { status: 404 });
    }

    await prisma.promptTemplate.delete({ where: { id } });
    return NextResponse.json({ success: true });
  }, req);
}
