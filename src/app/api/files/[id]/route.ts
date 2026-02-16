import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getObjectFromR2 } from "@/lib/storage";

/**
 * GET /api/files/:id — proxy-serve a file from R2 storage.
 * Avoids CORS issues with R2 signed URLs by streaming through Next.js.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuth(async (user) => {
    const { id } = await params;

    const file = await prisma.file.findUnique({ where: { id } });
    if (!file) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (file.userId !== user.id && user.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    try {
      const obj = await getObjectFromR2(file.storageKey);
      const body = await obj.Body?.transformToByteArray();
      if (!body || body.length === 0) {
        return NextResponse.json({ error: "File is empty" }, { status: 404 });
      }

      return new NextResponse(Buffer.from(body), {
        headers: {
          "Content-Type": file.mime,
          "Content-Length": String(body.length),
          "Cache-Control": "private, max-age=3600",
          "Accept-Ranges": "bytes",
        },
      });
    } catch (err) {
      console.error("[Files] R2 fetch error:", err instanceof Error ? err.message : err);
      return NextResponse.json({ error: "Failed to fetch file" }, { status: 500 });
    }
  });
}
