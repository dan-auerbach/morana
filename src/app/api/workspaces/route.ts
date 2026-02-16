import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/session";
import { getUserWorkspaces, switchWorkspace, getActiveWorkspaceId } from "@/lib/workspace";

// GET /api/workspaces — list user's workspaces + active workspace
export async function GET() {
  return withAuth(async (user) => {
    const [memberships, activeId] = await Promise.all([
      getUserWorkspaces(user.id),
      getActiveWorkspaceId(user.id),
    ]);

    return NextResponse.json({
      workspaces: memberships.map((m) => ({
        ...m.workspace,
        role: m.role,
      })),
      activeWorkspaceId: activeId,
    });
  });
}

// POST /api/workspaces — switch active workspace
export async function POST(req: NextRequest) {
  return withAuth(async (user) => {
    const { workspaceId } = await req.json();
    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId required" }, { status: 400 });
    }

    const ok = await switchWorkspace(user.id, workspaceId);
    if (!ok) {
      return NextResponse.json({ error: "Not a member of this workspace" }, { status: 403 });
    }

    return NextResponse.json({ activeWorkspaceId: workspaceId });
  }, req);
}
