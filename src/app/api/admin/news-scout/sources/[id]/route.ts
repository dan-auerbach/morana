import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/session";
import { prisma } from "@/lib/prisma";

// PATCH /api/admin/news-scout/sources/:id
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

    const existing = await prisma.newsScoutSource.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Source not found" }, { status: 404 });
    }

    const data: Record<string, unknown> = {};
    if (body.name !== undefined) data.name = String(body.name).trim();
    if (body.type !== undefined) data.type = String(body.type).trim();
    if (body.baseUrl !== undefined) data.baseUrl = String(body.baseUrl).trim();
    if (body.rssUrl !== undefined) data.rssUrl = body.rssUrl ? String(body.rssUrl).trim() : null;
    if (body.selectors !== undefined) data.selectors = body.selectors;
    if (body.isActive !== undefined) data.isActive = !!body.isActive;

    try {
      const source = await prisma.newsScoutSource.update({ where: { id }, data });
      return NextResponse.json({ source });
    } catch (err) {
      console.error("[NewsScout Sources] Update error:", err);
      return NextResponse.json({ error: "Failed to update source" }, { status: 500 });
    }
  }, req);
}

// DELETE /api/admin/news-scout/sources/:id
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
      await prisma.newsScoutSource.delete({ where: { id } });
      return NextResponse.json({ success: true });
    } catch (err) {
      console.error("[NewsScout Sources] Delete error:", err);
      return NextResponse.json({ error: "Failed to delete source" }, { status: 500 });
    }
  }, req);
}
