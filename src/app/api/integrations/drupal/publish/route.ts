import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { decryptCredentials } from "@/lib/drupal/crypto";
import { DrupalClient } from "@/lib/drupal/client";
import { inngest } from "@/lib/inngest/client";

// POST — Publish to Drupal (enqueues Inngest job or dry-run)
export async function POST(req: NextRequest) {
  return withAuth(async (user) => {
    const body = await req.json();
    const {
      integrationId,
      payload,
      mode = "draft",
      executionId,
      dryRun = false,
    } = body;

    if (!integrationId) {
      return NextResponse.json(
        { error: "integrationId is required" },
        { status: 400 }
      );
    }

    if (!payload || !payload.title || !payload.body) {
      return NextResponse.json(
        { error: "payload must include at least title and body" },
        { status: 400 }
      );
    }

    const integration = await prisma.integrationDrupal.findUnique({
      where: { id: integrationId },
    });
    if (!integration) {
      return NextResponse.json({ error: "Integration not found" }, { status: 404 });
    }
    if (!integration.isEnabled) {
      return NextResponse.json(
        { error: "Drupal integration is disabled" },
        { status: 400 }
      );
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

    // Dry run: build and return the request body without publishing
    if (dryRun) {
      let credentials = {} as { username?: string; password?: string; token?: string };
      if (integration.credentialsEnc) {
        credentials = decryptCredentials(integration.credentialsEnc);
      }

      const client = new DrupalClient({
        baseUrl: integration.baseUrl,
        adapterType: integration.adapterType as "jsonapi" | "custom_rest",
        authType: integration.authType as "basic" | "bearer_token",
        credentials,
        defaultContentType: integration.defaultContentType,
        bodyFormat: integration.bodyFormat,
      });

      const requestBody = client.buildRequestBody({
        title: payload.title,
        body_html: payload.body,
        summary: payload.summary,
        status: mode as "draft" | "publish",
      });

      return NextResponse.json({ dryRun: true, requestBody });
    }

    // Enqueue Inngest job
    await inngest.send({
      name: "drupal/publish",
      data: {
        integrationId,
        executionId: executionId || null,
        payload: {
          title: payload.title,
          body: payload.body,
          summary: payload.summary || "",
        },
        mode,
        userId: user.id,
      },
    });

    return NextResponse.json({ ok: true, queued: true });
  }, req);
}
