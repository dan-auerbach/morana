import { getToken } from "next-auth/jwt";
import { NextRequest, NextResponse } from "next/server";

/**
 * Next.js Middleware — runs on every matched request before the route handler.
 *
 * Purpose:
 * 1. Redirect unauthenticated users to the home page (login)
 * 2. Prevent serving the full JS bundle to unauthenticated users
 * 3. Block unauthenticated API access early (defense in depth)
 */

// Routes that don't require authentication
const PUBLIC_PATHS = [
  "/",                    // Home / login page
  "/api/auth",            // NextAuth endpoints (sign-in, callback, session, etc.)
  "/api/inngest",         // Inngest webhook (has its own signing key auth)
  "/_next",               // Next.js static assets
  "/favicon.ico",
];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Allow public paths
  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  // Check for valid session token
  // In production (HTTPS), NextAuth v4 uses __Secure- prefix for cookies.
  // getToken() must be told to look for the secure cookie name.
  const isSecure = req.nextUrl.protocol === "https:";
  const cookieName = isSecure
    ? "__Secure-next-auth.session-token"
    : "next-auth.session-token";
  const token = await getToken({
    req,
    secret: process.env.NEXTAUTH_SECRET,
    cookieName,
  });

  if (!token) {
    // API routes: return 401
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Page routes: redirect to home (login page)
    const loginUrl = new URL("/", req.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  // Run on all paths except static files
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
