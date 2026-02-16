import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/session";
import { prisma } from "@/lib/prisma";

// GET /api/conversations/:id — get conversation with messages
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuth(async (user) => {
    const { id } = await params;

    const conversation = await prisma.conversation.findUnique({
      where: { id },
      include: {
        messages: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            role: true,
            content: true,
            inputTokens: true,
            outputTokens: true,
            latencyMs: true,
            citationsJson: true,
            createdAt: true,
          },
        },
      },
    });

    if (!conversation) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    if (conversation.userId !== user.id && user.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    return NextResponse.json({ conversation });
  });
}

// PATCH /api/conversations/:id — update title or modelId
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuth(async (user) => {
    const { id } = await params;
    const body = await req.json();

    const conversation = await prisma.conversation.findUnique({ where: { id } });
    if (!conversation) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (conversation.userId !== user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const updated = await prisma.conversation.update({
      where: { id },
      data: {
        ...(body.title !== undefined && { title: body.title }),
        ...(body.modelId !== undefined && { modelId: body.modelId }),
        ...(body.templateId !== undefined && { templateId: body.templateId || null }),
        ...(body.knowledgeBaseIds !== undefined && {
          knowledgeBaseIds: Array.isArray(body.knowledgeBaseIds) && body.knowledgeBaseIds.length > 0
            ? body.knowledgeBaseIds
            : null,
        }),
        ...(body.webSearchEnabled !== undefined && { webSearchEnabled: !!body.webSearchEnabled }),
      },
    });

    return NextResponse.json({ conversation: updated });
  }, req);
}

// DELETE /api/conversations/:id
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuth(async (user) => {
    const { id } = await params;

    const conversation = await prisma.conversation.findUnique({ where: { id } });
    if (!conversation) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (conversation.userId !== user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    await prisma.conversation.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  }, req);
}
