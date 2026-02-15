import { NextResponse } from "next/server";
import { withAuth } from "@/lib/session";
import { prisma } from "@/lib/prisma";

// GET /api/templates — list active templates (for regular users)
export async function GET() {
  return withAuth(async () => {
    const templates = await prisma.promptTemplate.findMany({
      where: { isActive: true },
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
