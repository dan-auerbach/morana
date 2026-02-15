import { getToken } from "next-auth/jwt";
import { NextRequest, NextResponse } from "next/server";

/**
 * Next.js Middleware — runs on every matched request before the route handler.
 *
 * Purpose:
 * 1. Block known bots and crawlers
 * 2. Add security headers to all responses
 * 3. Redirect unauthenticated users to the home page (login)
 * 4. Prevent serving the full JS bundle to unauthenticated users
 * 5. Block unauthenticated API access early (defense in depth)
 */

// Known bot user-agent patterns to block
const BOT_PATTERNS = [
  /bot/i, /crawl/i, /spider/i, /slurp/i, /mediapartners/i,
  /gptbot/i, /chatgpt/i, /google-extended/i, /ccbot/i,
  /anthropic/i, /claude-web/i, /bytespider/i, /cohere/i,
  /perplexitybot/i, /facebookbot/i, /amazonbot/i, /applebot/i,
  /meta-externalagent/i, /bingbot/i, /yandex/i, /baidu/i,
  /duckduckbot/i, /sogou/i, /exabot/i, /facebot/i, /ia_archiver/i,
  /semrushbot/i, /ahrefsbot/i, /mj12bot/i, /dotbot/i,
  /petalbot/i, /megaindex/i, /blexbot/i,
  /scrapy/i, /httpclient/i, /python-requests/i, /go-http-client/i,
  /curl/i, /wget/i, /libwww/i, /httpie/i,
];

// Routes that don't require authentication
const PUBLIC_PATHS = [
  "/",                    // Home / login page
  "/api/auth",            // NextAuth endpoints (sign-in, callback, session, etc.)
  "/api/inngest",         // Inngest webhook (has its own signing key auth)
  "/_next",               // Next.js static assets
  "/favicon.ico",
  "/robots.txt",
];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

function isBot(userAgent: string | null): boolean {
  if (!userAgent) return false;
  return BOT_PATTERNS.some((p) => p.test(userAgent));
}

/**
 * Security headers for all responses.
 */
function addSecurityHeaders(response: NextResponse): NextResponse {
  // Prevent clickjacking
  response.headers.set("X-Frame-Options", "DENY");
  // Prevent MIME sniffing
  response.headers.set("X-Content-Type-Options", "nosniff");
  // XSS protection (legacy browsers)
  response.headers.set("X-XSS-Protection", "1; mode=block");
  // Referrer policy
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  // Permissions policy — disable unnecessary features
  response.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(self), geolocation=(), interest-cohort=()"
  );
  // Content Security Policy
  response.headers.set(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      "font-src 'self' data:",
      "connect-src 'self' https://accounts.google.com",
      "frame-src https://accounts.google.com",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; ")
  );
  // Strict Transport Security (HTTPS only)
  response.headers.set(
    "Strict-Transport-Security",
    "max-age=63072000; includeSubDomains; preload"
  );
  // Don't leak server info
  response.headers.set("X-Powered-By", "");

  return response;
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const userAgent = req.headers.get("user-agent");

  // Block bots on all routes except robots.txt
  if (pathname !== "/robots.txt" && isBot(userAgent)) {
    const response = new NextResponse("Forbidden", { status: 403 });
    return addSecurityHeaders(response);
  }

  // Allow public paths
  if (isPublicPath(pathname)) {
    const response = NextResponse.next();
    return addSecurityHeaders(response);
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
      const response = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      return addSecurityHeaders(response);
    }

    // Page routes: redirect to home (login page)
    const loginUrl = new URL("/", req.url);
    const response = NextResponse.redirect(loginUrl);
    return addSecurityHeaders(response);
  }

  const response = NextResponse.next();
  return addSecurityHeaders(response);
}

export const config = {
  // Run on all paths except static files
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
