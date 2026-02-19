import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { encryptCredentials } from "@/lib/drupal/crypto";

function requireAdmin(role: string) {
  if (role !== "admin") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }
  return null;
}

async function getWorkspaceId(userId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { activeWorkspaceId: true },
  });
  return user?.activeWorkspaceId || null;
}

// GET — List Drupal integrations for the active workspace
export async function GET() {
  return withAuth(async (user) => {
    const workspaceId = await getWorkspaceId(user.id);
    if (!workspaceId) {
      return NextResponse.json({ integrations: [] });
    }

    const integrations = await prisma.integrationDrupal.findMany({
      where: { workspaceId },
      select: {
        id: true,
        workspaceId: true,
        name: true,
        baseUrl: true,
        adapterType: true,
        authType: true,
        defaultContentType: true,
        fieldMap: true,
        bodyFormat: true,
        isEnabled: true,
        createdAt: true,
        updatedAt: true,
        credentialsEnc: true,
      },
    });

    // Never return credentials — only indicate if they're set
    const safe = integrations.map(({ credentialsEnc, ...rest }) => ({
      ...rest,
      hasCredentials: !!credentialsEnc,
    }));

    return NextResponse.json({ integrations: safe });
  });
}

// POST — Create a new Drupal integration
export async function POST(req: NextRequest) {
  return withAuth(async (user) => {
    const denied = requireAdmin(user.role);
    if (denied) return denied;

    const workspaceId = await getWorkspaceId(user.id);
    if (!workspaceId) {
      return NextResponse.json(
        { error: "No active workspace" },
        { status: 400 }
      );
    }

    // Check if integration already exists
    const existing = await prisma.integrationDrupal.findUnique({
      where: { workspaceId },
    });
    if (existing) {
      return NextResponse.json(
        { error: "Drupal integration already exists for this workspace. Use PATCH to update." },
        { status: 409 }
      );
    }

    const body = await req.json();
    const { baseUrl, authType, credentials, adapterType, defaultContentType, bodyFormat, fieldMap, name } = body;

    // Validate baseUrl
    if (!baseUrl || typeof baseUrl !== "string") {
      return NextResponse.json({ error: "baseUrl is required" }, { status: 400 });
    }
    try {
      new URL(baseUrl);
    } catch {
      return NextResponse.json({ error: "Invalid baseUrl" }, { status: 400 });
    }

    // Encrypt credentials
    let credentialsEnc: string | null = null;
    if (credentials && typeof credentials === "object") {
      credentialsEnc = encryptCredentials(credentials);
    }

    const warnings: string[] = [];
    if (baseUrl.startsWith("http://")) {
      warnings.push("WARNING: Using HTTP (not HTTPS). Credentials will be sent in plaintext.");
    }

    const integration = await prisma.integrationDrupal.create({
      data: {
        workspaceId,
        name: name || "Drupal",
        baseUrl: baseUrl.replace(/\/+$/, ""), // strip trailing slashes
        adapterType: adapterType || "jsonapi",
        authType: authType || "bearer_token",
        credentialsEnc,
        defaultContentType: defaultContentType || "article",
        bodyFormat: bodyFormat || "full_html",
        fieldMap: fieldMap || null,
      },
    });

    return NextResponse.json({
      integration: {
        id: integration.id,
        workspaceId: integration.workspaceId,
        name: integration.name,
        baseUrl: integration.baseUrl,
        adapterType: integration.adapterType,
        authType: integration.authType,
        defaultContentType: integration.defaultContentType,
        bodyFormat: integration.bodyFormat,
        fieldMap: integration.fieldMap,
        isEnabled: integration.isEnabled,
        hasCredentials: !!credentialsEnc,
      },
      warnings,
    });
  }, req);
}
