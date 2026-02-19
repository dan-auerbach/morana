import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getActiveWorkspaceId } from "@/lib/workspace";

// GET /api/admin/news-scout/topics
export async function GET() {
  return withAuth(async (user) => {
    if (user.role !== "admin") {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const workspaceId = await getActiveWorkspaceId(user.id);
    if (!workspaceId) {
      return NextResponse.json({ error: "No active workspace" }, { status: 400 });
    }

    const topics = await prisma.newsScoutTopic.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { runs: true } } },
    });

    return NextResponse.json({ topics });
  });
}

// POST /api/admin/news-scout/topics
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
    const { name, description, negativeFilters, maxSourcesPerRun, model } = body;

    if (!name || typeof name !== "string" || !name.trim()) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }
    if (!description || typeof description !== "string" || !description.trim()) {
      return NextResponse.json({ error: "Description is required" }, { status: 400 });
    }

    try {
      const topic = await prisma.newsScoutTopic.create({
        data: {
          workspaceId,
          name: name.trim(),
          description: description.trim(),
          negativeFilters: negativeFilters || [],
          maxSourcesPerRun: maxSourcesPerRun || 100,
          model: model?.trim() || "gpt-5-mini",
        },
      });

      return NextResponse.json({ topic }, { status: 201 });
    } catch (err) {
      console.error("[NewsScout Topics] Create error:", err);
      return NextResponse.json({ error: "Failed to create topic" }, { status: 500 });
    }
  }, req);
}
