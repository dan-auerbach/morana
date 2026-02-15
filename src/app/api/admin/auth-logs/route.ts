import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/session";
import { prisma } from "@/lib/prisma";

// GET /api/admin/auth-logs — list auth logs (admin only)
export async function GET(req: NextRequest) {
  return withAuth(async (user) => {
    if (user.role !== "admin") {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const url = new URL(req.url);
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "200"), 500);
    const email = url.searchParams.get("email") || undefined;
    const event = url.searchParams.get("event") || undefined;

    const logs = await prisma.authLog.findMany({
      where: {
        ...(email && { email: { contains: email, mode: "insensitive" as const } }),
        ...(event && { event }),
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    // Summary stats
    const now = new Date();
    const last24h = new Date(now.getTime() - 24 * 3600_000);
    const last7d = new Date(now.getTime() - 7 * 24 * 3600_000);

    const [total, denied24h, denied7d, uniqueIPs] = await Promise.all([
      prisma.authLog.count(),
      prisma.authLog.count({
        where: { event: { startsWith: "sign_in_denied" }, createdAt: { gte: last24h } },
      }),
      prisma.authLog.count({
        where: { event: { startsWith: "sign_in_denied" }, createdAt: { gte: last7d } },
      }),
      prisma.authLog.groupBy({
        by: ["ip"],
        where: { createdAt: { gte: last7d } },
      }).then((r) => r.length),
    ]);

    return NextResponse.json({
      logs,
      stats: {
        totalLogs: total,
        denied24h,
        denied7d,
        uniqueIPs7d: uniqueIPs,
      },
    });
  });
}
