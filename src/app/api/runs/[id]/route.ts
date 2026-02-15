import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getSignedDownloadUrl } from "@/lib/storage";

/**
 * Strip base64 data URIs and other huge values from payloadJson
 * to prevent browser/server freezes when loading run details.
 */
function sanitizePayload(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== "object") return null;
  const obj = payload as Record<string, unknown>;
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === "string" && value.length > 10_000) {
      // Strip huge strings (base64 audio, etc.) — keep first 200 chars as indicator
      result[key] = value.substring(0, 200) + `... [truncated, ${value.length} chars total]`;
    } else {
      result[key] = value;
    }
  }
  return result;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuth(async (user) => {
    const { id } = await params;

    let run;
    try {
      run = await prisma.run.findUnique({
        where: { id },
        include: { input: true, output: true, files: true },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Database error";
      return NextResponse.json({ error: message }, { status: 500 });
    }

    if (!run) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    if (run.userId !== user.id && user.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Generate signed URLs for output files (if R2 is configured)
    let filesWithUrls: { id: string; mime: string; size: number; url: string | null }[] = [];
    try {
      filesWithUrls = await Promise.all(
        run.files
          .filter((f) => f.kind === "output")
          .map(async (f) => ({
            id: f.id,
            mime: f.mime,
            size: f.size,
            url: process.env.R2_ENDPOINT ? await getSignedDownloadUrl(f.storageKey) : null,
          }))
      );
    } catch {
      // R2 not configured — skip file URLs
      filesWithUrls = run.files
        .filter((f) => f.kind === "output")
        .map((f) => ({ id: f.id, mime: f.mime, size: f.size, url: null }));
    }

    return NextResponse.json({
      id: run.id,
      type: run.type,
      status: run.status,
      provider: run.provider,
      model: run.model,
      createdAt: run.createdAt,
      finishedAt: run.finishedAt,
      errorMessage: run.errorMessage,
      input: sanitizePayload(run.input?.payloadJson),
      output: sanitizePayload(run.output?.payloadJson),
      files: filesWithUrls,
    });
  });
}
