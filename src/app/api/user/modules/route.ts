import { NextResponse } from "next/server";
import { withAuth } from "@/lib/session";
import { prisma } from "@/lib/prisma";

// GET /api/user/modules — returns current user's allowedModules
export async function GET() {
  return withAuth(async (user) => {
    const dbUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: { allowedModules: true },
    });

    const allowedModules = dbUser?.allowedModules as string[] | null ?? null;

    return NextResponse.json({ allowedModules });
  });
}
