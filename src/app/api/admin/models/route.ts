import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { invalidateModelCache } from "@/lib/config";

// GET /api/admin/models — list all AI model records
export async function GET() {
  return withAuth(async (user) => {
    if (user.role !== "admin") {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    try {
      const models = await prisma.aIModel.findMany({
        orderBy: { sortOrder: "asc" },
      });

      return NextResponse.json({ models });
    } catch (err) {
      console.error("[Admin Models] Error:", err);
      return NextResponse.json({ error: "Failed to load models" }, { status: 500 });
    }
  });
}

// POST /api/admin/models — create a new AI model entry
export async function POST(req: NextRequest) {
  return withAuth(async (user) => {
    if (user.role !== "admin") {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const body = await req.json();
    const {
      modelId,
      label,
      provider,
      isEnabled,
      isDefault,
      sortOrder,
      pricingInput,
      pricingOutput,
      pricingUnit,
    } = body;

    if (!modelId || typeof modelId !== "string" || !modelId.trim()) {
      return NextResponse.json({ error: "modelId is required" }, { status: 400 });
    }

    if (!label || typeof label !== "string" || !label.trim()) {
      return NextResponse.json({ error: "label is required" }, { status: 400 });
    }

    if (!provider || typeof provider !== "string" || !provider.trim()) {
      return NextResponse.json({ error: "provider is required" }, { status: 400 });
    }

    // Check for duplicate modelId
    const existing = await prisma.aIModel.findUnique({
      where: { modelId: modelId.trim() },
    });
    if (existing) {
      return NextResponse.json({ error: "A model with this modelId already exists" }, { status: 409 });
    }

    try {
      // If this model is set as default, unset all other defaults first
      if (isDefault) {
        await prisma.aIModel.updateMany({
          where: { isDefault: true },
          data: { isDefault: false },
        });
      }

      const model = await prisma.aIModel.create({
        data: {
          modelId: modelId.trim(),
          label: label.trim(),
          provider: provider.trim(),
          isEnabled: isEnabled !== undefined ? !!isEnabled : true,
          isDefault: !!isDefault,
          sortOrder: sortOrder != null ? parseInt(sortOrder) : 0,
          pricingInput: pricingInput != null ? parseFloat(pricingInput) : 0,
          pricingOutput: pricingOutput != null ? parseFloat(pricingOutput) : 0,
          pricingUnit: pricingUnit || "1M_tokens",
        },
      });

      invalidateModelCache();

      return NextResponse.json({ model }, { status: 201 });
    } catch (err) {
      console.error("[Admin Models] Create error:", err);
      return NextResponse.json({ error: "Failed to create model" }, { status: 500 });
    }
  }, req);
}
