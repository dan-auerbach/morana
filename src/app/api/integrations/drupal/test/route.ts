import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { decryptCredentials } from "@/lib/drupal/crypto";
import { DrupalClient } from "@/lib/drupal/client";

// POST — Test Drupal connection
export async function POST(req: NextRequest) {
  return withAuth(async (user) => {
    const body = await req.json();
    const { integrationId } = body;

    if (!integrationId) {
      return NextResponse.json(
        { error: "integrationId is required" },
        { status: 400 }
      );
    }

    const integration = await prisma.integrationDrupal.findUnique({
      where: { id: integrationId },
    });
    if (!integration) {
      return NextResponse.json({ error: "Integration not found" }, { status: 404 });
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

    // Decrypt credentials
    let credentials = { username: undefined, password: undefined, token: undefined } as {
      username?: string;
      password?: string;
      token?: string;
    };
    if (integration.credentialsEnc) {
      try {
        credentials = decryptCredentials(integration.credentialsEnc);
      } catch {
        return NextResponse.json(
          { ok: false, error: "Failed to decrypt credentials. Encryption key may have changed." },
          { status: 500 }
        );
      }
    }

    const client = new DrupalClient({
      baseUrl: integration.baseUrl,
      adapterType: integration.adapterType as "jsonapi" | "custom_rest",
      authType: integration.authType as "basic" | "bearer_token",
      credentials,
      defaultContentType: integration.defaultContentType,
      bodyFormat: integration.bodyFormat,
    });

    const result = await client.testConnection();

    return NextResponse.json(result);
  }, req);
}
