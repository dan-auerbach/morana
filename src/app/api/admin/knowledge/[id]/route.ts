import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/session";
import { prisma } from "@/lib/prisma";

function requireAdmin(role: string) {
  if (role !== "admin") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }
  return null;
}

// GET /api/admin/knowledge/:id — get KB detail
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuth(async (user) => {
    const denied = requireAdmin(user.role);
    if (denied) return denied;

    const { id } = await params;
    const kb = await prisma.knowledgeBase.findUnique({
      where: { id },
      include: {
        creator: { select: { email: true } },
        documents: {
          orderBy: { createdAt: "desc" },
          select: {
            id: true, fileName: true, mimeType: true, sizeBytes: true,
            status: true, chunkCount: true, errorMessage: true, createdAt: true,
          },
        },
      },
    });

    if (!kb) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({ knowledgeBase: kb });
  });
}

// PATCH /api/admin/knowledge/:id — update KB
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
    if (body.isActive !== undefined) data.isActive = Boolean(body.isActive);

    const kb = await prisma.knowledgeBase.update({ where: { id }, data });
    return NextResponse.json({ knowledgeBase: kb });
  }, req);
}

// DELETE /api/admin/knowledge/:id — delete KB and all documents
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuth(async (user) => {
    const denied = requireAdmin(user.role);
    if (denied) return denied;

    const { id } = await params;
    await prisma.knowledgeBase.delete({ where: { id } });
    return NextResponse.json({ success: true });
  }, req);
}
