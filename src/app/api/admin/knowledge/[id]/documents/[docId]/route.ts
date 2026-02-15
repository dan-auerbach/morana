import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/session";
import { prisma } from "@/lib/prisma";

function requireAdmin(role: string) {
  if (role !== "admin") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }
  return null;
}

// DELETE /api/admin/knowledge/:id/documents/:docId — delete a document
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; docId: string }> }
) {
  return withAuth(async (user) => {
    const denied = requireAdmin(user.role);
    if (denied) return denied;

    const { docId } = await params;

    const doc = await prisma.document.findUnique({ where: { id: docId } });
    if (!doc) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    // Delete chunks (cascade should handle this, but be explicit for pgvector)
    await prisma.documentChunk.deleteMany({ where: { documentId: docId } });
    await prisma.document.delete({ where: { id: docId } });

    return NextResponse.json({ success: true });
  }, req);
}
