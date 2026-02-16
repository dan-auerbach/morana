import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/session";
import { prisma } from "@/lib/prisma";

function requireAdmin(role: string) {
  if (role !== "admin") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }
  return null;
}

// GET /api/admin/templates/:id/versions — list all versions
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuth(async (user) => {
    const denied = requireAdmin(user.role);
    if (denied) return denied;

    const { id } = await params;
    const template = await prisma.promptTemplate.findUnique({
      where: { id },
      select: { id: true, name: true, currentVersion: true },
    });
    if (!template) {
      return NextResponse.json({ error: "Template not found" }, { status: 404 });
    }

    const versions = await prisma.promptTemplateVersion.findMany({
      where: { templateId: id },
      orderBy: { versionNumber: "desc" },
      include: { author: { select: { email: true, name: true } } },
    });

    return NextResponse.json({ template, versions });
  });
}

// POST /api/admin/templates/:id/versions/diff — compare two versions
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuth(async (user) => {
    const denied = requireAdmin(user.role);
    if (denied) return denied;

    const { id } = await params;
    const { versionA, versionB } = await req.json();

    if (!versionA || !versionB) {
      return NextResponse.json({ error: "versionA and versionB required" }, { status: 400 });
    }

    const [a, b] = await Promise.all([
      prisma.promptTemplateVersion.findUnique({
        where: { templateId_versionNumber: { templateId: id, versionNumber: versionA } },
        include: { author: { select: { email: true } } },
      }),
      prisma.promptTemplateVersion.findUnique({
        where: { templateId_versionNumber: { templateId: id, versionNumber: versionB } },
        include: { author: { select: { email: true } } },
      }),
    ]);

    if (!a || !b) {
      return NextResponse.json({ error: "Version not found" }, { status: 404 });
    }

    // Compute simple line-based diff for each field
    const diff = {
      systemPrompt: computeLineDiff(a.systemPrompt, b.systemPrompt),
      userPromptTemplate: computeLineDiff(a.userPromptTemplate || "", b.userPromptTemplate || ""),
      knowledgeText: computeLineDiff(a.knowledgeText || "", b.knowledgeText || ""),
      category: a.category !== b.category ? { from: a.category, to: b.category } : null,
      description: a.description !== b.description ? { from: a.description, to: b.description } : null,
    };

    return NextResponse.json({ versionA: a, versionB: b, diff });
  }, req);
}

type DiffLine = { type: "same" | "add" | "remove"; text: string };

function computeLineDiff(textA: string, textB: string): DiffLine[] {
  const linesA = textA.split("\n");
  const linesB = textB.split("\n");
  const result: DiffLine[] = [];
  const maxLen = Math.max(linesA.length, linesB.length);

  // Simple line-by-line comparison (not full LCS — keeps it lightweight)
  for (let i = 0; i < maxLen; i++) {
    const a = linesA[i];
    const b = linesB[i];
    if (a === b) {
      if (a !== undefined) result.push({ type: "same", text: a });
    } else {
      if (a !== undefined) result.push({ type: "remove", text: a });
      if (b !== undefined) result.push({ type: "add", text: b });
    }
  }

  return result;
}
