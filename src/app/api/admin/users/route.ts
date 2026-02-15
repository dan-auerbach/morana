import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { getApprovedModels } from "@/lib/config";

function requireAdmin(role: string) {
  if (role !== "admin") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }
  return null;
}

// GET /api/admin/users — list all users with stats
export async function GET() {
  return withAuth(async (user) => {
    const denied = requireAdmin(user.role);
    if (denied) return denied;

    try {
      const users = await prisma.user.findMany({
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          active: true,
          createdAt: true,
          lastLoginAt: true,
          maxRunsPerDay: true,
          maxMonthlyCostCents: true,
          allowedModels: true,
          _count: { select: { runs: true, usageEvents: true } },
        },
      });

      // Get monthly cost per user
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);

      const monthlyCosts = await prisma.usageEvent.groupBy({
        by: ["userId"],
        where: { createdAt: { gte: startOfMonth } },
        _sum: { costEstimateCents: true },
      });

      const costMap: Record<string, number> = {};
      for (const mc of monthlyCosts) {
        costMap[mc.userId] = mc._sum.costEstimateCents || 0;
      }

      const usersWithStats = users.map((u) => ({
        ...u,
        // Return cents and formatted dollar amount
        monthlyCostCents: costMap[u.id] || 0,
        monthlyCost: (costMap[u.id] || 0) / 100,
        totalRuns: u._count.runs,
        // Return allowedModels as array for UI
        allowedModels: u.allowedModels as string[] | null,
      }));

      return NextResponse.json({ users: usersWithStats });
    } catch (err) {
      console.error("[Admin Users] Error:", err);
      return NextResponse.json({ error: "Failed to load users" }, { status: 500 });
    }
  });
}

/**
 * Validate allowedModels: must be a JSON array of known model ID strings.
 * Returns null if valid, or an error string.
 */
function validateAllowedModels(input: unknown): string | null {
  if (input === null || input === undefined || input === "") return null; // null = allow all
  if (typeof input === "string") {
    // Accept comma-separated for backward compat → convert to array
    try {
      const parsed = JSON.parse(input);
      if (!Array.isArray(parsed)) return "allowedModels must be a JSON array of model IDs";
      input = parsed;
    } catch {
      // Treat as comma-separated string
      return null; // Will be converted below
    }
  }
  if (!Array.isArray(input)) return "allowedModels must be an array of model IDs";
  const approvedIds = getApprovedModels().map((m) => m.id);
  for (const m of input) {
    if (typeof m !== "string") return `Invalid model entry: ${m}`;
    // Warn but don't reject unknown models (they might be image/stt models)
  }
  return null;
}

/**
 * Normalize allowedModels to JSON array or null.
 */
function normalizeAllowedModels(input: unknown): string[] | null {
  if (input === null || input === undefined || input === "") return null;
  if (Array.isArray(input)) {
    const filtered = input.filter((m) => typeof m === "string" && m.trim().length > 0).map((m: string) => m.trim());
    return filtered.length > 0 ? filtered : null;
  }
  if (typeof input === "string") {
    try {
      const parsed = JSON.parse(input);
      if (Array.isArray(parsed)) return normalizeAllowedModels(parsed);
    } catch {
      // Comma-separated string
      const arr = input.split(",").map((s) => s.trim()).filter(Boolean);
      return arr.length > 0 ? arr : null;
    }
  }
  return null;
}

// POST /api/admin/users — add a user (whitelist email for Google Auth)
export async function POST(req: NextRequest) {
  return withAuth(async (user) => {
    const denied = requireAdmin(user.role);
    if (denied) return denied;

    const body = await req.json();
    const { email, role, maxRunsPerDay, maxMonthlyCostCents, allowedModels } = body;

    if (!email || typeof email !== "string" || !email.includes("@")) {
      return NextResponse.json({ error: "Valid email is required" }, { status: 400 });
    }

    const normalized = email.trim().toLowerCase();

    // Check if already exists
    const existing = await prisma.user.findUnique({ where: { email: normalized } });
    if (existing) {
      return NextResponse.json({ error: "User already exists" }, { status: 409 });
    }

    // Validate allowedModels
    const modelsError = validateAllowedModels(allowedModels);
    if (modelsError) {
      return NextResponse.json({ error: modelsError }, { status: 400 });
    }

    const normalizedModels = normalizeAllowedModels(allowedModels);

    // Pre-create user record so settings are ready when they sign in
    const newUser = await prisma.user.create({
      data: {
        email: normalized,
        role: role === "admin" ? "admin" : "user",
        active: true,
        maxRunsPerDay: maxRunsPerDay != null ? parseInt(maxRunsPerDay) : null,
        maxMonthlyCostCents: maxMonthlyCostCents != null ? parseInt(maxMonthlyCostCents) : null,
        allowedModels: normalizedModels ?? Prisma.DbNull,
      },
    });

    return NextResponse.json({ user: newUser }, { status: 201 });
  }, req);
}
