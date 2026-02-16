import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { invalidateModelCache } from "@/lib/config";

// PATCH /api/admin/models/:id — update an AI model entry
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

    const existing = await prisma.aIModel.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Model not found" }, { status: 404 });
    }

    // Build update data — only include fields that were explicitly sent
    const data: Record<string, unknown> = {};

    if (body.modelId !== undefined) data.modelId = String(body.modelId).trim();
    if (body.label !== undefined) data.label = String(body.label).trim();
    if (body.provider !== undefined) data.provider = String(body.provider).trim();
    if (body.isEnabled !== undefined) data.isEnabled = !!body.isEnabled;
    if (body.isDefault !== undefined) data.isDefault = !!body.isDefault;
    if (body.sortOrder !== undefined) data.sortOrder = parseInt(body.sortOrder);
    if (body.pricingInput !== undefined) data.pricingInput = parseFloat(body.pricingInput);
    if (body.pricingOutput !== undefined) data.pricingOutput = parseFloat(body.pricingOutput);
    if (body.pricingUnit !== undefined) data.pricingUnit = String(body.pricingUnit);

    try {
      // If setting isDefault to true, unset isDefault on all other models first
      if (data.isDefault === true) {
        await prisma.aIModel.updateMany({
          where: { isDefault: true, id: { not: id } },
          data: { isDefault: false },
        });
      }

      const updated = await prisma.aIModel.update({
        where: { id },
        data,
      });

      invalidateModelCache();

      return NextResponse.json({ model: updated });
    } catch (err) {
      console.error("[Admin Models] Update error:", err);
      return NextResponse.json({ error: "Failed to update model" }, { status: 500 });
    }
  }, req);
}

// DELETE /api/admin/models/:id — delete an AI model entry
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuth(async (user) => {
    if (user.role !== "admin") {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const { id } = await params;

    const existing = await prisma.aIModel.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Model not found" }, { status: 404 });
    }

    try {
      await prisma.aIModel.delete({ where: { id } });

      invalidateModelCache();

      return NextResponse.json({ success: true });
    } catch (err) {
      console.error("[Admin Models] Delete error:", err);
      return NextResponse.json({ error: "Failed to delete model" }, { status: 500 });
    }
  }, req);
}
