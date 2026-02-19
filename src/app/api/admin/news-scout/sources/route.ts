import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getActiveWorkspaceId } from "@/lib/workspace";

// GET /api/admin/news-scout/sources
export async function GET() {
  return withAuth(async (user) => {
    if (user.role !== "admin") {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const workspaceId = await getActiveWorkspaceId(user.id);
    if (!workspaceId) {
      return NextResponse.json({ error: "No active workspace" }, { status: 400 });
    }

    const sources = await prisma.newsScoutSource.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ sources });
  });
}

// POST /api/admin/news-scout/sources
export async function POST(req: NextRequest) {
  return withAuth(async (user) => {
    if (user.role !== "admin") {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const workspaceId = await getActiveWorkspaceId(user.id);
    if (!workspaceId) {
      return NextResponse.json({ error: "No active workspace" }, { status: 400 });
    }

    const body = await req.json();
    const { name, type, baseUrl, rssUrl, selectors } = body;

    if (!name || typeof name !== "string" || !name.trim()) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }
    if (!type || !["rss", "google_news", "html", "x"].includes(type)) {
      return NextResponse.json({ error: "Valid type is required (rss, google_news, html, x)" }, { status: 400 });
    }
    if (!baseUrl || typeof baseUrl !== "string" || !baseUrl.trim()) {
      return NextResponse.json({ error: "Base URL is required" }, { status: 400 });
    }

    try {
      const source = await prisma.newsScoutSource.create({
        data: {
          workspaceId,
          name: name.trim(),
          type,
          baseUrl: baseUrl.trim(),
          rssUrl: rssUrl?.trim() || null,
          selectors: selectors || null,
        },
      });

      return NextResponse.json({ source }, { status: 201 });
    } catch (err) {
      console.error("[NewsScout Sources] Create error:", err);
      return NextResponse.json({ error: "Failed to create source" }, { status: 500 });
    }
  }, req);
}
