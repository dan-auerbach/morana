import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/session";
import { prisma } from "@/lib/prisma";

// GET /api/admin/news-scout/runs/:id
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuth(async (user) => {
    if (user.role !== "admin") {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const { id } = await params;

    const run = await prisma.newsScoutRun.findUnique({
      where: { id },
      include: { topic: { select: { name: true, description: true } } },
    });

    if (!run) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }

    return NextResponse.json({ run });
  });
}

// PATCH /api/admin/news-scout/runs/:id — cancel a running run
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuth(async (user) => {
    if (user.role !== "admin") {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const { id } = await params;
    const body = await req.json();

    try {
      const run = await prisma.newsScoutRun.update({
        where: { id },
        data: {
          status: body.status || "error",
          errorMessage: body.errorMessage || "Cancelled by admin",
          finishedAt: new Date(),
        },
      });
      return NextResponse.json({ run });
    } catch (err) {
      console.error("[NewsScout Runs] Cancel error:", err);
      return NextResponse.json({ error: "Failed to cancel run" }, { status: 500 });
    }
  }, req);
}

// DELETE /api/admin/news-scout/runs/:id
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuth(async (user) => {
    if (user.role !== "admin") {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const { id } = await params;

    try {
      await prisma.newsScoutRun.delete({ where: { id } });
      return NextResponse.json({ success: true });
    } catch (err) {
      console.error("[NewsScout Runs] Delete error:", err);
      return NextResponse.json({ error: "Failed to delete run" }, { status: 500 });
    }
  }, req);
}
