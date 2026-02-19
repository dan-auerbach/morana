import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getActiveWorkspaceId } from "@/lib/workspace";
import { inngest } from "@/lib/inngest/client";

// GET /api/admin/news-scout/runs
export async function GET(req: NextRequest) {
  return withAuth(async (user) => {
    if (user.role !== "admin") {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const workspaceId = await getActiveWorkspaceId(user.id);
    if (!workspaceId) {
      return NextResponse.json({ error: "No active workspace" }, { status: 400 });
    }

    const topicId = req.nextUrl.searchParams.get("topicId");
    const where: Record<string, unknown> = { workspaceId };
    if (topicId) where.topicId = topicId;

    const runs = await prisma.newsScoutRun.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { topic: { select: { name: true } } },
    });

    return NextResponse.json({ runs });
  });
}

// POST /api/admin/news-scout/runs — trigger a manual run
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
    const { topicId } = body;

    if (!topicId) {
      return NextResponse.json({ error: "topicId is required" }, { status: 400 });
    }

    // Verify topic exists and belongs to workspace
    const topic = await prisma.newsScoutTopic.findFirst({
      where: { id: topicId, workspaceId },
    });
    if (!topic) {
      return NextResponse.json({ error: "Topic not found" }, { status: 404 });
    }

    try {
      const run = await prisma.newsScoutRun.create({
        data: {
          workspaceId,
          topicId,
          userId: user.id,
          status: "running",
        },
      });

      await inngest.send({
        name: "news-scout/run",
        data: { runId: run.id },
      });

      return NextResponse.json({ run }, { status: 201 });
    } catch (err) {
      console.error("[NewsScout Runs] Trigger error:", err);
      return NextResponse.json({ error: "Failed to trigger run" }, { status: 500 });
    }
  }, req);
}
