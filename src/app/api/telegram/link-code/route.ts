import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { randomInt } from "crypto";

/**
 * POST /api/telegram/link-code
 * Generate a 6-digit linking code for Telegram.
 * Requires session auth.
 */
export async function POST(req: NextRequest) {
  return withAuth(async (user) => {
    // Invalidate previous unused codes for this user
    await prisma.telegramLinkCode.updateMany({
      where: {
        userId: user.id,
        usedAt: null,
      },
      data: { expiresAt: new Date() }, // expire immediately
    });

    // Generate 6-digit code (100000-999999)
    const code = String(randomInt(100000, 999999));

    // TTL: 5 minutes
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    const linkCode = await prisma.telegramLinkCode.create({
      data: {
        userId: user.id,
        code,
        expiresAt,
      },
    });

    return NextResponse.json({
      code: linkCode.code,
      expiresAt: linkCode.expiresAt.toISOString(),
    });
  }, req);
}

/**
 * GET /api/telegram/link-code
 * Check current Telegram link status.
 */
export async function GET(req: NextRequest) {
  return withAuth(async (user) => {
    const link = await prisma.telegramLink.findUnique({
      where: { userId: user.id },
      select: {
        telegramChatId: true,
        telegramUsername: true,
        linkedAt: true,
      },
    });

    return NextResponse.json({
      linked: !!link,
      telegramUsername: link?.telegramUsername || null,
      linkedAt: link?.linkedAt?.toISOString() || null,
    });
  });
}
