import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/session";
import { prisma } from "@/lib/prisma";

function requireAdmin(role: string) {
  if (role !== "admin") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }
  return null;
}

// POST /api/admin/templates/:id/versions/:versionId — rollback to this version
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; versionId: string }> }
) {
  return withAuth(async (user) => {
    const denied = requireAdmin(user.role);
    if (denied) return denied;

    const { id, versionId } = await params;

    const version = await prisma.promptTemplateVersion.findUnique({
      where: { id: versionId },
    });
    if (!version || version.templateId !== id) {
      return NextResponse.json({ error: "Version not found" }, { status: 404 });
    }

    const template = await prisma.promptTemplate.findUnique({
      where: { id },
    });
    if (!template) {
      return NextResponse.json({ error: "Template not found" }, { status: 404 });
    }

    const newVersionNumber = template.currentVersion + 1;

    // Create a new version as snapshot of the rollback target
    await prisma.promptTemplateVersion.create({
      data: {
        templateId: id,
        versionNumber: newVersionNumber,
        systemPrompt: version.systemPrompt,
        userPromptTemplate: version.userPromptTemplate,
        knowledgeText: version.knowledgeText,
        category: version.category,
        description: `Rollback to v${version.versionNumber}`,
        createdBy: user.id,
      },
    });

    // Update the template to match the rolled-back version
    await prisma.promptTemplate.update({
      where: { id },
      data: {
        systemPrompt: version.systemPrompt,
        userPromptTemplate: version.userPromptTemplate,
        knowledgeText: version.knowledgeText,
        category: version.category,
        currentVersion: newVersionNumber,
      },
    });

    return NextResponse.json({
      success: true,
      rolledBackTo: version.versionNumber,
      newVersion: newVersionNumber,
    });
  }, req);
}
