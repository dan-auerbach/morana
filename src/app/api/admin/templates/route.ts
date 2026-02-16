import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/session";
import { prisma } from "@/lib/prisma";

function requireAdmin(role: string) {
  if (role !== "admin") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }
  return null;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip diacritics
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// GET /api/admin/templates — list all templates (admin)
export async function GET() {
  return withAuth(async (user) => {
    const denied = requireAdmin(user.role);
    if (denied) return denied;

    const templates = await prisma.promptTemplate.findMany({
      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
      include: { creator: { select: { email: true, name: true } } },
    });

    return NextResponse.json({ templates });
  });
}

// POST /api/admin/templates — create a new template
export async function POST(req: NextRequest) {
  return withAuth(async (user) => {
    const denied = requireAdmin(user.role);
    if (denied) return denied;

    const body = await req.json();
    const { name, slug, description, systemPrompt, userPromptTemplate, category, knowledgeText, isActive, sortOrder } = body;

    if (!name || typeof name !== "string" || !name.trim()) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }
    if (!systemPrompt || typeof systemPrompt !== "string" || !systemPrompt.trim()) {
      return NextResponse.json({ error: "System prompt is required" }, { status: 400 });
    }

    const finalSlug = slug?.trim() || slugify(name);

    // Check slug uniqueness
    const existing = await prisma.promptTemplate.findUnique({ where: { slug: finalSlug } });
    if (existing) {
      return NextResponse.json({ error: `Slug "${finalSlug}" already exists` }, { status: 409 });
    }

    const template = await prisma.promptTemplate.create({
      data: {
        name: name.trim(),
        slug: finalSlug,
        description: description?.trim() || null,
        systemPrompt: systemPrompt.trim(),
        userPromptTemplate: userPromptTemplate?.trim() || null,
        category: category?.trim() || "general",
        knowledgeText: knowledgeText?.trim() || null,
        isActive: isActive !== false,
        sortOrder: typeof sortOrder === "number" ? sortOrder : 0,
        currentVersion: 1,
        createdBy: user.id,
        // Create initial version snapshot (v1)
        versions: {
          create: {
            versionNumber: 1,
            systemPrompt: systemPrompt.trim(),
            userPromptTemplate: userPromptTemplate?.trim() || null,
            knowledgeText: knowledgeText?.trim() || null,
            category: category?.trim() || "general",
            description: description?.trim() || null,
            createdBy: user.id,
          },
        },
      },
    });

    return NextResponse.json({ template }, { status: 201 });
  }, req);
}
