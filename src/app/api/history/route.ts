import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/session";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  return withAuth(async (user) => {
    const url = new URL(req.url);
    const page = Math.max(1, parseInt(url.searchParams.get("page") || "1"));
    const limit = Math.min(100, parseInt(url.searchParams.get("limit") || "20"));
    const type = url.searchParams.get("type");
    const targetUserId = url.searchParams.get("userId");

    const where: Record<string, unknown> = {};

    // Admin can see all runs, or filter by user
    if (user.role === "admin" && targetUserId) {
      where.userId = targetUserId;
    } else if (user.role !== "admin") {
      where.userId = user.id;
    }

    if (type) where.type = type;

    const [runs, total] = await Promise.all([
      prisma.run.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        include: { user: { select: { email: true, name: true } } },
      }),
      prisma.run.count({ where }),
    ]);

    // Fetch previews separately using raw SQL to avoid loading huge base64 audio blobs
    const runIds = runs.map((r) => r.id);
    let previews: Record<string, string> = {};

    if (runIds.length > 0) {
      try {
        // Get text previews from inputs and outputs using SQL substring
        // Using $queryRaw tagged template for automatic parameterization (safe from SQL injection)
        const previewRows = await prisma.$queryRaw<
          { runId: string; src: string; snippet: string }[]
        >`SELECT ri."runId", 'input' as src,
            LEFT(ri."payloadJson"->>'text', 100) as snippet
          FROM "RunInput" ri
          WHERE ri."runId" = ANY(${runIds})
            AND ri."payloadJson"->>'text' IS NOT NULL
          UNION ALL
          SELECT ri."runId", 'input_prompt' as src,
            LEFT(ri."payloadJson"->>'prompt', 100) as snippet
          FROM "RunInput" ri
          WHERE ri."runId" = ANY(${runIds})
            AND ri."payloadJson"->>'prompt' IS NOT NULL
          UNION ALL
          SELECT ro."runId", 'output' as src,
            LEFT(ro."payloadJson"->>'text', 100) as snippet
          FROM "RunOutput" ro
          WHERE ro."runId" = ANY(${runIds})
            AND ro."payloadJson"->>'text' IS NOT NULL`;

        // Build previews map: for STT use output text, for TTS use input text, for LLM use input prompt
        const inputTexts: Record<string, string> = {};
        const inputPrompts: Record<string, string> = {};
        const outputTexts: Record<string, string> = {};

        for (const row of previewRows) {
          if (row.src === "input") inputTexts[row.runId] = row.snippet;
          if (row.src === "input_prompt") inputPrompts[row.runId] = row.snippet;
          if (row.src === "output") outputTexts[row.runId] = row.snippet;
        }

        for (const r of runs) {
          if (r.type === "stt" && outputTexts[r.id]) {
            previews[r.id] = outputTexts[r.id];
          } else if (r.type === "tts" && inputTexts[r.id]) {
            previews[r.id] = inputTexts[r.id];
          } else if (r.type === "llm" && inputPrompts[r.id]) {
            previews[r.id] = inputPrompts[r.id];
          } else if (r.type === "image" && inputPrompts[r.id]) {
            previews[r.id] = inputPrompts[r.id];
          }
        }
      } catch {
        // If raw query fails, skip previews
      }
    }

    const runsWithPreview = runs.map((r) => ({
      id: r.id,
      type: r.type,
      status: r.status,
      provider: r.provider,
      model: r.model,
      createdAt: r.createdAt,
      finishedAt: r.finishedAt,
      errorMessage: r.errorMessage,
      user: r.user,
      preview: previews[r.id] || "",
    }));

    return NextResponse.json({
      runs: runsWithPreview,
      total,
      page,
      pages: Math.ceil(total / limit),
    });
  });
}
