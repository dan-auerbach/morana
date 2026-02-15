import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/session";
import { prisma } from "@/lib/prisma";

function requireAdmin(role: string) {
  if (role !== "admin") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }
  return null;
}

// GET /api/admin/knowledge — list all knowledge bases
export async function GET() {
  return withAuth(async (user) => {
    const denied = requireAdmin(user.role);
    if (denied) return denied;

    const knowledgeBases = await prisma.knowledgeBase.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        creator: { select: { email: true } },
        _count: { select: { documents: true } },
        documents: {
          select: { id: true, fileName: true, status: true, chunkCount: true, sizeBytes: true },
          orderBy: { createdAt: "desc" },
        },
      },
    });

    return NextResponse.json({ knowledgeBases });
  });
}

// POST /api/admin/knowledge — create a new knowledge base
export async function POST(req: NextRequest) {
  return withAuth(async (user) => {
    const denied = requireAdmin(user.role);
    if (denied) return denied;

    const body = await req.json();
    const { name, description } = body;

    if (!name || typeof name !== "string" || !name.trim()) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    const kb = await prisma.knowledgeBase.create({
      data: {
        name: name.trim(),
        description: description?.trim() || null,
        createdBy: user.id,
      },
    });

    return NextResponse.json({ knowledgeBase: kb }, { status: 201 });
  }, req);
}
