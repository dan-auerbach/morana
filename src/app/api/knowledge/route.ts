import { NextResponse } from "next/server";
import { withAuth } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getActiveWorkspaceId } from "@/lib/workspace";

// GET /api/knowledge — list active knowledge bases (scoped to workspace + global)
export async function GET() {
  return withAuth(async (user) => {
    const workspaceId = await getActiveWorkspaceId(user.id);

    const knowledgeBases = await prisma.knowledgeBase.findMany({
      where: {
        isActive: true,
        ...(workspaceId
          ? { OR: [{ workspaceId }, { workspaceId: null }] }
          : {}),
      },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        description: true,
        _count: {
          select: {
            documents: { where: { status: "ready" } },
          },
        },
      },
    });

    return NextResponse.json({ knowledgeBases });
  });
}
