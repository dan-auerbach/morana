import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getActiveWorkspaceId } from "@/lib/workspace";

// GET /api/conversations — list user's conversations (scoped to active workspace)
export async function GET() {
  return withAuth(async (user) => {
    const workspaceId = await getActiveWorkspaceId(user.id);

    const conversations = await prisma.conversation.findMany({
      where: {
        userId: user.id,
        ...(workspaceId ? { workspaceId } : {}),
      },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        title: true,
        modelId: true,
        templateId: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { messages: true } },
      },
    });

    return NextResponse.json({ conversations });
  });
}

// POST /api/conversations — create a new conversation
export async function POST(req: NextRequest) {
  return withAuth(async (user) => {
    const body = await req.json();
    const { modelId, title, templateId, knowledgeBaseIds, webSearchEnabled } = body;
    const workspaceId = await getActiveWorkspaceId(user.id);

    const conversation = await prisma.conversation.create({
      data: {
        userId: user.id,
        workspaceId,
        title: title || "New conversation",
        modelId: modelId || "claude-sonnet-4-5-20250929",
        templateId: templateId || null,
        knowledgeBaseIds: Array.isArray(knowledgeBaseIds) && knowledgeBaseIds.length > 0
          ? knowledgeBaseIds
          : undefined,
        webSearchEnabled: !!webSearchEnabled,
      },
    });

    return NextResponse.json({ conversation });
  }, req);
}
