import { getToken } from "next-auth/jwt";
import { NextRequest, NextResponse } from "next/server";

// Temporary debug endpoint — remove after fixing auth
export async function GET(req: NextRequest) {
  const isSecure = req.nextUrl.protocol === "https:";
  const secureCookieName = "__Secure-next-auth.session-token";
  const plainCookieName = "next-auth.session-token";

  // Try both cookie names
  const secureCookie = req.cookies.get(secureCookieName)?.value;
  const plainCookie = req.cookies.get(plainCookieName)?.value;

  // List all cookie names
  const allCookies = Array.from(req.cookies.getAll()).map(c => c.name);

  // Try getToken with different configs
  let tokenDefault = null;
  let tokenSecure = null;
  let tokenPlain = null;

  try {
    tokenDefault = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  } catch (e) {
    tokenDefault = { error: (e as Error).message };
  }

  try {
    tokenSecure = await getToken({ req, secret: process.env.NEXTAUTH_SECRET, cookieName: secureCookieName });
  } catch (e) {
    tokenSecure = { error: (e as Error).message };
  }

  try {
    tokenPlain = await getToken({ req, secret: process.env.NEXTAUTH_SECRET, cookieName: plainCookieName });
  } catch (e) {
    tokenPlain = { error: (e as Error).message };
  }

  return NextResponse.json({
    isSecure,
    protocol: req.nextUrl.protocol,
    hasSecret: !!process.env.NEXTAUTH_SECRET,
    secretLength: process.env.NEXTAUTH_SECRET?.length ?? 0,
    allCookies,
    hasSecureCookie: !!secureCookie,
    hasPlainCookie: !!plainCookie,
    secureCookieLen: secureCookie?.length ?? 0,
    plainCookieLen: plainCookie?.length ?? 0,
    tokenDefault: tokenDefault ? "found" : "null",
    tokenSecure: tokenSecure ? "found" : "null",
    tokenPlain: tokenPlain ? "found" : "null",
    tokenDefaultDetail: tokenDefault,
    tokenSecureDetail: tokenSecure,
    tokenPlainDetail: tokenPlain,
  });
}
