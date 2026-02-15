import { NextResponse } from "next/server";
import { withAuth } from "@/lib/session";
import { prisma } from "@/lib/prisma";

// GET /api/knowledge — list active knowledge bases (for regular users)
export async function GET() {
  return withAuth(async () => {
    const knowledgeBases = await prisma.knowledgeBase.findMany({
      where: { isActive: true },
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
