import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/session";
import { prisma } from "@/lib/prisma";

// PATCH /api/admin/news-scout/topics/:id
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuth(async (user) => {
    if (user.role !== "admin") {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const { id } = await params;
    const body = await req.json();

    const existing = await prisma.newsScoutTopic.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Topic not found" }, { status: 404 });
    }

    const data: Record<string, unknown> = {};
    if (body.name !== undefined) data.name = String(body.name).trim();
    if (body.description !== undefined) data.description = String(body.description).trim();
    if (body.negativeFilters !== undefined) data.negativeFilters = body.negativeFilters;
    if (body.maxSourcesPerRun !== undefined) data.maxSourcesPerRun = parseInt(body.maxSourcesPerRun);
    if (body.model !== undefined) data.model = String(body.model).trim();
    if (body.isActive !== undefined) data.isActive = !!body.isActive;

    try {
      const topic = await prisma.newsScoutTopic.update({ where: { id }, data });
      return NextResponse.json({ topic });
    } catch (err) {
      console.error("[NewsScout Topics] Update error:", err);
      return NextResponse.json({ error: "Failed to update topic" }, { status: 500 });
    }
  }, req);
}

// DELETE /api/admin/news-scout/topics/:id
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuth(async (user) => {
    if (user.role !== "admin") {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const { id } = await params;

    try {
      await prisma.newsScoutTopic.delete({ where: { id } });
      return NextResponse.json({ success: true });
    } catch (err) {
      console.error("[NewsScout Topics] Delete error:", err);
      return NextResponse.json({ error: "Failed to delete topic" }, { status: 500 });
    }
  }, req);
}
