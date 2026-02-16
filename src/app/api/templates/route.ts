import { NextResponse } from "next/server";
import { withAuth } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getActiveWorkspaceId } from "@/lib/workspace";

// GET /api/templates — list active templates (scoped to workspace + global)
export async function GET() {
  return withAuth(async (user) => {
    const workspaceId = await getActiveWorkspaceId(user.id);

    const templates = await prisma.promptTemplate.findMany({
      where: {
        isActive: true,
        // Show templates from user's workspace OR global templates (no workspace)
        ...(workspaceId
          ? { OR: [{ workspaceId }, { workspaceId: null }] }
          : {}),
      },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        category: true,
        systemPrompt: true,
        userPromptTemplate: true,
        knowledgeText: true,
      },
    });

    return NextResponse.json({ templates });
  });
}
