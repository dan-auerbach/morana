import { NextRequest, NextResponse } from "next/server";

/**
 * CSRF protection for mutating API endpoints.
 *
 * NextAuth protects its own routes, but our custom /api/runs/*
 * endpoints use session cookies and are vulnerable to cross-site POST.
 *
 * Strategy: check Origin/Referer header matches the app host.
 * GET/HEAD/OPTIONS are safe (read-only), only POST/PUT/PATCH/DELETE checked.
 */
export function checkCsrf(req: NextRequest): NextResponse | null {
  const method = req.method.toUpperCase();
  if (["GET", "HEAD", "OPTIONS"].includes(method)) return null;

  const origin = req.headers.get("origin");
  const referer = req.headers.get("referer");
  const host = req.headers.get("host");

  if (!host) {
    return NextResponse.json({ error: "Missing Host header" }, { status: 403 });
  }

  // Origin header is most reliable
  if (origin) {
    try {
      const originHost = new URL(origin).host;
      if (originHost === host) return null;
    } catch {
      // invalid origin
    }
    return NextResponse.json({ error: "CSRF: origin mismatch" }, { status: 403 });
  }

  // Fall back to Referer
  if (referer) {
    try {
      const refererHost = new URL(referer).host;
      if (refererHost === host) return null;
    } catch {
      // invalid referer
    }
    return NextResponse.json({ error: "CSRF: referer mismatch" }, { status: 403 });
  }

  // No Origin or Referer — likely a non-browser request (API client, curl, etc.)
  // For internal app: require at least one header for safety
  return NextResponse.json(
    { error: "CSRF: missing Origin/Referer header" },
    { status: 403 }
  );
}
