import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";
import { inngestFunctions } from "@/lib/inngest/functions";
import { NextResponse } from "next/server";

/**
 * Inngest webhook endpoint.
 *
 * SECURITY: INNGEST_SIGNING_KEY MUST be set in production.
 * Without it, anyone can POST crafted events to trigger background jobs
 * with arbitrary data (userId, runId, etc.) — complete bypass of auth.
 *
 * When the key is not set, this endpoint returns 503.
 */

function blocked() {
  console.warn("[inngest] Blocked: INNGEST_SIGNING_KEY not configured");
  return NextResponse.json(
    { error: "Inngest not configured (INNGEST_SIGNING_KEY required)" },
    { status: 503 }
  );
}

const signingKey = process.env.INNGEST_SIGNING_KEY;

// Only create the real handler if signing key is configured
const inngestHandler = signingKey
  ? serve({ client: inngest, functions: inngestFunctions })
  : null;

export async function GET(req: Request, ctx: unknown) {
  if (!inngestHandler) return blocked();
  return inngestHandler.GET(req as never, ctx);
}

export async function POST(req: Request, ctx: unknown) {
  if (!inngestHandler) return blocked();
  return inngestHandler.POST(req as never, ctx);
}

export async function PUT(req: Request, ctx: unknown) {
  if (!inngestHandler) return blocked();
  return inngestHandler.PUT(req as never, ctx);
}
