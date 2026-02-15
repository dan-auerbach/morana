import { getServerSession } from "next-auth";
import { authOptions } from "./auth";
import { NextRequest, NextResponse } from "next/server";
import { checkCsrf } from "./csrf";

export type SessionUser = {
  id: string;
  email: string;
  name?: string | null;
  role: "user" | "admin";
};

export async function getRequiredSession(): Promise<SessionUser> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    throw new Error("Unauthorized");
  }
  return session.user as SessionUser;
}

/**
 * Protect an API route with session auth + CSRF.
 * Pass `req` for CSRF protection on POST/PUT/PATCH/DELETE.
 * If `req` is omitted, CSRF check is skipped (backward compat for GET routes).
 */
export async function withAuth(
  handler: (user: SessionUser) => Promise<NextResponse>,
  req?: NextRequest
): Promise<NextResponse> {
  // CSRF check for mutating requests
  if (req) {
    const csrfError = checkCsrf(req);
    if (csrfError) return csrfError;
  }

  let user: SessionUser;
  try {
    user = await getRequiredSession();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    return await handler(user);
  } catch (err) {
    // Log full error server-side, but never expose internals to client
    const internalMsg = err instanceof Error ? err.message : "Unknown error";
    console.error("[withAuth] handler error:", internalMsg);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
