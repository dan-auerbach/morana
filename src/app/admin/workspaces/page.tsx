"use client";

import { useSession } from "next-auth/react";
import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

type WorkspaceMember = {
  id: string;
  role: string;
  user: { id: string; email: string; name: string | null; role: string };
};

type Workspace = {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
  maxMonthlyCostCents: number | null;
  allowedModels: string[] | null;
  _count: { members: number; conversations: number; recipes: number };
  members?: WorkspaceMember[];
};

type UserOption = { id: string; email: string; name: string | null };

export default function AdminWorkspacesPage() {
  const { data: session } = useSession();
  const isAdmin = (session?.user as Record<string, unknown>)?.role === "admin";

  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({ name: "", maxMonthlyCostCents: "" });
  const [formError, setFormError] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [addMemberEmail, setAddMemberEmail] = useState("");
  const [expandedData, setExpandedData] = useState<{ workspace: Workspace; monthlyCostCents: number } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await fetch("/api/admin/workspaces");
      const data = await resp.json();
      if (data.error) { setError(data.error); return; }
      setWorkspaces(data.workspaces || []);
    } catch { setError("Failed to load"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (session && isAdmin) {
      load();
      // Load users for member management
      fetch("/api/admin/users").then(r => r.json()).then(d => {
        setUsers((d.users || []).map((u: UserOption & Record<string, unknown>) => ({ id: u.id, email: u.email, name: u.name })));
      }).catch(() => {});
    }
  }, [session, isAdmin, load]);

  async function handleCreate() {
    setFormError("");
    if (!formData.name.trim()) { setFormError("Name is required"); return; }
    try {
      const resp = await fetch("/api/admin/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formData.name.trim(),
          maxMonthlyCostCents: formData.maxMonthlyCostCents ? parseInt(formData.maxMonthlyCostCents) : null,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) { setFormError(data.error || "Failed"); return; }
      setFormData({ name: "", maxMonthlyCostCents: "" });
      setShowForm(false);
      load();
    } catch { setFormError("Request failed"); }
  }

  async function loadDetail(id: string) {
    try {
      const resp = await fetch(`/api/admin/workspaces/${id}`);
      const data = await resp.json();
      setExpandedData(data);
    } catch { /* ignore */ }
  }

  async function handleAddMember(wsId: string) {
    const userMatch = users.find(u => u.email.toLowerCase() === addMemberEmail.toLowerCase());
    if (!userMatch) { setFormError("User not found"); return; }
    await fetch(`/api/admin/workspaces/${wsId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "addMember", userId: userMatch.id, role: "member" }),
    });
    setAddMemberEmail("");
    loadDetail(wsId);
  }

  async function handleRemoveMember(wsId: string, userId: string) {
    await fetch(`/api/admin/workspaces/${wsId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "removeMember", userId }),
    });
    loadDetail(wsId);
  }

  async function handleToggleMemberRole(wsId: string, userId: string, currentRole: string) {
    await fetch(`/api/admin/workspaces/${wsId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "addMember", userId, role: currentRole === "admin" ? "member" : "admin" }),
    });
    loadDetail(wsId);
  }

  if (!session) return <div style={{ color: "#5a6a7a" }}><span style={{ color: "#ff4444" }}>[ERROR]</span> Authentication required.</div>;
  if (!isAdmin) return <div style={{ color: "#ff4444" }}>[ACCESS DENIED] Admin privileges required.</div>;

  const s = {
    label: { fontSize: "11px", fontWeight: 700 as const, color: "#ff8800", textTransform: "uppercase" as const, letterSpacing: "0.1em", marginBottom: "4px", display: "block" },
    input: { width: "100%", padding: "6px 10px", backgroundColor: "#111820", border: "1px solid #1e2a3a", color: "#e0e0e0", fontFamily: "inherit", fontSize: "12px" },
  };

  return (
    <div>
      <div style={{ marginBottom: "24px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
          <Link href="/admin" className="no-underline" style={{ color: "#ff4444", fontSize: "18px", fontWeight: 700 }}>[ADMIN]</Link>
          <span style={{ color: "#333" }}>/</span>
          <span style={{ color: "#ff8800", fontSize: "18px", fontWeight: 700 }}>WORKSPACES</span>
        </div>
        <div style={{ color: "#5a6a7a", fontSize: "13px" }}>$ admin --workspaces --manage</div>
      </div>

      <div style={{ marginBottom: "20px", display: "flex", gap: "12px", alignItems: "center" }}>
        <button
          onClick={() => setShowForm(!showForm)}
          style={{ padding: "8px 20px", background: "transparent", border: "1px solid #ff8800", color: "#ff8800", fontFamily: "inherit", fontSize: "12px", fontWeight: 700, cursor: "pointer", textTransform: "uppercase", letterSpacing: "0.1em" }}
        >
          {showForm ? "[  CANCEL  ]" : "[  + NEW WORKSPACE  ]"}
        </button>
        <div style={{ fontSize: "12px", color: "#5a6a7a" }}>{workspaces.length} workspace{workspaces.length !== 1 ? "s" : ""}</div>
      </div>

      {showForm && (
        <div style={{ padding: "16px", border: "1px solid #ff8800", backgroundColor: "rgba(255, 136, 0, 0.03)", marginBottom: "20px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "12px" }}>
            <div>
              <label style={s.label}>--name *</label>
              <input value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} placeholder="e.g. Urednistvo" style={s.input} />
            </div>
            <div>
              <label style={s.label}>--monthly-cap (cents)</label>
              <input type="number" value={formData.maxMonthlyCostCents} onChange={(e) => setFormData({ ...formData, maxMonthlyCostCents: e.target.value })} placeholder="e.g. 10000 = $100" style={s.input} />
            </div>
          </div>
          {formError && <div style={{ color: "#ff4444", fontSize: "12px", marginBottom: "8px" }}>[ERROR] {formError}</div>}
          <button onClick={handleCreate} style={{ padding: "6px 16px", background: "transparent", border: "1px solid #ff8800", color: "#ff8800", fontFamily: "inherit", fontSize: "12px", fontWeight: 700, cursor: "pointer", textTransform: "uppercase" }}>[  CREATE  ]</button>
        </div>
      )}

      {error && <div style={{ color: "#ff4444", fontSize: "13px", marginBottom: "16px" }}>[ERROR] {error}</div>}

      {loading ? (
        <div style={{ color: "#ff8800", fontSize: "13px" }}>Loading...</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {workspaces.map((ws) => {
            const isExpanded = expandedId === ws.id;
            return (
              <div key={ws.id} style={{ border: "1px solid #1e2a3a", padding: "12px 16px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <span
                      onClick={() => { setExpandedId(isExpanded ? null : ws.id); if (!isExpanded) loadDetail(ws.id); }}
                      style={{ color: "#e0e0e0", fontWeight: 700, fontSize: "14px", cursor: "pointer" }}
                    >
                      <span style={{ color: isExpanded ? "#ff8800" : "#444", fontSize: "10px", marginRight: "4px" }}>{isExpanded ? "▼" : "▶"}</span>
                      {ws.name}
                    </span>
                    <span style={{ color: "#5a6a7a", fontSize: "11px", marginLeft: "8px" }}>/{ws.slug}</span>
                    {!ws.isActive && <span style={{ color: "#ff4444", fontSize: "10px", marginLeft: "8px" }}>[INACTIVE]</span>}
                  </div>
                  <div style={{ display: "flex", gap: "12px", fontSize: "10px", color: "#5a6a7a" }}>
                    <span>{ws._count.members} members</span>
                    <span>{ws._count.conversations} convos</span>
                    <span>{ws._count.recipes} recipes</span>
                    {ws.maxMonthlyCostCents && <span style={{ color: "#ffcc00" }}>cap: ${(ws.maxMonthlyCostCents / 100).toFixed(0)}</span>}
                  </div>
                </div>

                {isExpanded && expandedData?.workspace.id === ws.id && (
                  <div style={{ marginTop: "12px", padding: "12px", backgroundColor: "rgba(13, 17, 23, 0.8)", borderLeft: "2px solid #ff8800" }}>
                    <div style={{ fontSize: "10px", color: "#ff8800", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "8px" }}>
                      MONTHLY COST: ${((expandedData.monthlyCostCents || 0) / 100).toFixed(2)}
                      {ws.maxMonthlyCostCents && <span style={{ color: "#5a6a7a" }}> / ${(ws.maxMonthlyCostCents / 100).toFixed(0)} cap</span>}
                    </div>

                    <div style={{ fontSize: "10px", color: "#00ff88", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "8px" }}>MEMBERS</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: "4px", marginBottom: "12px" }}>
                      {expandedData.workspace.members?.map((m) => (
                        <div key={m.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "4px 8px", backgroundColor: "#0a0e14", border: "1px solid #1e2a3a" }}>
                          <span style={{ fontSize: "12px", color: "#e0e0e0" }}>{m.user.email}</span>
                          <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
                            <span style={{ fontSize: "9px", color: m.role === "admin" ? "#ff8800" : "#5a6a7a", fontWeight: 700, textTransform: "uppercase" }}>{m.role}</span>
                            <button
                              onClick={() => handleToggleMemberRole(ws.id, m.user.id, m.role)}
                              style={{ padding: "2px 6px", background: "transparent", border: "1px solid #5a6a7a", color: "#5a6a7a", fontFamily: "inherit", fontSize: "9px", cursor: "pointer" }}
                            >
                              {m.role === "admin" ? "DEMOTE" : "PROMOTE"}
                            </button>
                            <button
                              onClick={() => handleRemoveMember(ws.id, m.user.id)}
                              style={{ padding: "2px 6px", background: "transparent", border: "1px solid #ff4444", color: "#ff4444", fontFamily: "inherit", fontSize: "9px", cursor: "pointer" }}
                            >
                              REMOVE
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                      <input
                        value={addMemberEmail}
                        onChange={(e) => setAddMemberEmail(e.target.value)}
                        placeholder="user@email.com"
                        style={{ ...s.input, flex: 1 }}
                        onKeyDown={(e) => { if (e.key === "Enter") handleAddMember(ws.id); }}
                      />
                      <button
                        onClick={() => handleAddMember(ws.id)}
                        style={{ padding: "6px 12px", background: "transparent", border: "1px solid #00ff88", color: "#00ff88", fontFamily: "inherit", fontSize: "10px", fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}
                      >
                        + ADD
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
