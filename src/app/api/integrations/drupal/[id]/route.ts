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

type RouteParams = { params: Promise<{ id: string }> };

// GET — Get single integration (credentials redacted)
export async function GET(_req: NextRequest, { params }: RouteParams) {
  return withAuth(async (user) => {
    const { id } = await params;

    const integration = await prisma.integrationDrupal.findUnique({
      where: { id },
      include: { workspace: { select: { id: true, name: true } } },
    });

    if (!integration) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Workspace access check
    const member = await prisma.workspaceMember.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId: integration.workspaceId,
          userId: user.id,
        },
      },
    });
    if (!member) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const { credentialsEnc, ...rest } = integration;
    return NextResponse.json({
      integration: { ...rest, hasCredentials: !!credentialsEnc },
    });
  });
}

// PATCH — Update integration
export async function PATCH(req: NextRequest, { params }: RouteParams) {
  return withAuth(async (user) => {
    const denied = requireAdmin(user.role);
    if (denied) return denied;

    const { id } = await params;

    const existing = await prisma.integrationDrupal.findUnique({
      where: { id },
    });
    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Workspace access check
    const member = await prisma.workspaceMember.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId: existing.workspaceId,
          userId: user.id,
        },
      },
    });
    if (!member || member.role !== "admin") {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const body = await req.json();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updateData: Record<string, any> = {};

    if (body.baseUrl !== undefined) {
      try {
        new URL(body.baseUrl);
      } catch {
        return NextResponse.json({ error: "Invalid baseUrl" }, { status: 400 });
      }
      updateData.baseUrl = body.baseUrl.replace(/\/+$/, "");
    }

    if (body.name !== undefined) updateData.name = body.name;
    if (body.adapterType !== undefined) updateData.adapterType = body.adapterType;
    if (body.authType !== undefined) updateData.authType = body.authType;
    if (body.defaultContentType !== undefined) updateData.defaultContentType = body.defaultContentType;
    if (body.bodyFormat !== undefined) updateData.bodyFormat = body.bodyFormat;
    if (body.fieldMap !== undefined) updateData.fieldMap = body.fieldMap;
    if (body.isEnabled !== undefined) updateData.isEnabled = body.isEnabled;

    // Re-encrypt credentials if provided
    if (body.credentials && typeof body.credentials === "object") {
      updateData.credentialsEnc = encryptCredentials(body.credentials);
    }

    const updated = await prisma.integrationDrupal.update({
      where: { id },
      data: updateData,
    });

    const warnings: string[] = [];
    if (updated.baseUrl.startsWith("http://")) {
      warnings.push("WARNING: Using HTTP (not HTTPS). Credentials will be sent in plaintext.");
    }

    const { credentialsEnc, ...rest } = updated;
    return NextResponse.json({
      integration: { ...rest, hasCredentials: !!credentialsEnc },
      warnings,
    });
  }, req);
}

// DELETE — Delete integration
export async function DELETE(req: NextRequest, { params }: RouteParams) {
  return withAuth(async (user) => {
    const denied = requireAdmin(user.role);
    if (denied) return denied;

    const { id } = await params;

    const existing = await prisma.integrationDrupal.findUnique({
      where: { id },
    });
    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Workspace access check
    const member = await prisma.workspaceMember.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId: existing.workspaceId,
          userId: user.id,
        },
      },
    });
    if (!member || member.role !== "admin") {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    await prisma.integrationDrupal.delete({ where: { id } });

    return NextResponse.json({ ok: true });
  }, req);
}
