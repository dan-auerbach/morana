import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/session";
import { prisma } from "@/lib/prisma";

const ALLOWED_THEMES = ["system", "dark", "light"];
const ALLOWED_LOCALES = ["en", "sl"];

export async function GET() {
  return withAuth(async (user) => {
    const u = await prisma.user.findUnique({
      where: { id: user.id },
      select: { themePreference: true, locale: true, defaultLlmModelId: true },
    });
    return NextResponse.json({
      theme: u?.themePreference ?? "system",
      locale: u?.locale ?? "en",
      defaultLlmModelId: u?.defaultLlmModelId ?? null,
    });
  });
}

export async function PUT(req: NextRequest) {
  return withAuth(async (user) => {
    const body = await req.json();
    const updates: Record<string, unknown> = {};

    if ("theme" in body) {
      if (!ALLOWED_THEMES.includes(body.theme)) {
        return NextResponse.json({ error: "Invalid theme" }, { status: 400 });
      }
      updates.themePreference = body.theme;
    }
    if ("locale" in body) {
      if (!ALLOWED_LOCALES.includes(body.locale)) {
        return NextResponse.json({ error: "Invalid locale" }, { status: 400 });
      }
      updates.locale = body.locale;
    }
    if ("defaultLlmModelId" in body) {
      updates.defaultLlmModelId = body.defaultLlmModelId || null;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No valid fields" }, { status: 400 });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: updates,
    });

    const resp = NextResponse.json({ ok: true });

    if (updates.themePreference) {
      resp.cookies.set("morana_theme", updates.themePreference as string, {
        path: "/",
        maxAge: 365 * 86400,
        sameSite: "lax",
      });
    }
    if (updates.locale) {
      resp.cookies.set("morana_locale", updates.locale as string, {
        path: "/",
        maxAge: 365 * 86400,
        sameSite: "lax",
      });
    }

    console.log(`[SETTINGS] user ${user.id} updated: ${Object.keys(updates).join(", ")}`);
    return resp;
  }, req);
}
