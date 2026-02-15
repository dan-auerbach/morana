import { NextResponse } from "next/server";
import { withAuth } from "@/lib/session";
import { getApprovedModels, pricing } from "@/lib/config";

export async function GET() {
  return withAuth(async () => {
    const models = getApprovedModels();
    return NextResponse.json({ models, pricing });
  });
}
