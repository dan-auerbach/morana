"use client";

import { useSession } from "next-auth/react";
import { useState, useEffect, useCallback } from "react";

const ALL_MODULES = ["llm", "stt", "tts", "image", "video", "recipes"] as const;

type UserRow = {
  id: string;
  email: string;
  name: string | null;
  role: string;
  active: boolean;
  createdAt: string;
  lastLoginAt: string;
  maxRunsPerDay: number | null;
  maxMonthlyCostCents: number | null;
  allowedModels: string[] | null;
  allowedModules: string[] | null;
  monthlyCost: number;
  totalRuns: number;
};

type UserDetail = {
  user: UserRow & { allowedModules: string[] | null };
  recentRuns: {
    id: string;
    type: string;
    status: string;
    provider: string;
    model: string;
    createdAt: string;
    errorMessage: string | null;
  }[];
  stats: { monthlyCost: number; monthlyRuns: number; todayRuns: number };
};

export default function AdminPage() {
  const { data: session } = useSession();
  const isAdmin = (session?.user as Record<string, unknown>)?.role === "admin";

  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Add user form
  const [showAddForm, setShowAddForm] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [newRole, setNewRole] = useState("user");
  const [newMaxRuns, setNewMaxRuns] = useState("");
  const [newMaxCost, setNewMaxCost] = useState("");
  const [newModels, setNewModels] = useState("");
  const [newModules, setNewModules] = useState<string[]>([...ALL_MODULES]);
  const [addError, setAddError] = useState("");

  // Edit user
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editData, setEditData] = useState<Partial<UserRow>>({});

  // Detail view
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<UserDetail | null>(null);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await fetch("/api/admin/users");
      const data = await resp.json();
      if (data.error) { setError(data.error); return; }
      setUsers(data.users || []);
    } catch { setError("Failed to load users"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (session && isAdmin) loadUsers();
  }, [session, isAdmin, loadUsers]);

  async function handleAddUser() {
    setAddError("");
    if (!newEmail.trim()) { setAddError("Email is required"); return; }
    try {
      const resp = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: newEmail,
          role: newRole,
          maxRunsPerDay: newMaxRuns || null,
          maxMonthlyCostCents: newMaxCost ? parseInt(newMaxCost) : null,
          allowedModels: newModels ? newModels.split(",").map((s: string) => s.trim()).filter(Boolean) : null,
          allowedModules: newModules.length === ALL_MODULES.length ? null : newModules,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) { setAddError(data.error); return; }
      setNewEmail(""); setNewRole("user"); setNewMaxRuns(""); setNewMaxCost(""); setNewModels(""); setNewModules([...ALL_MODULES]);
      setShowAddForm(false);
      loadUsers();
    } catch { setAddError("Failed to add user"); }
  }

  async function handleSaveEdit(id: string) {
    try {
      await fetch(`/api/admin/users/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editData),
      });
      setEditingId(null);
      setEditData({});
      loadUsers();
    } catch { /* ignore */ }
  }

  async function handleToggleActive(id: string, currentActive: boolean) {
    try {
      await fetch(`/api/admin/users/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !currentActive }),
      });
      loadUsers();
    } catch { /* ignore */ }
  }

  async function loadDetail(id: string) {
    if (detailId === id) { setDetailId(null); setDetail(null); return; }
    setDetailId(id);
    try {
      const resp = await fetch(`/api/admin/users/${id}`);
      const data = await resp.json();
      setDetail(data);
    } catch { setDetail(null); }
  }

  function startEdit(u: UserRow) {
    setEditingId(u.id);
    setEditData({
      role: u.role,
      maxRunsPerDay: u.maxRunsPerDay,
      maxMonthlyCostCents: u.maxMonthlyCostCents,
      allowedModels: u.allowedModels,
      allowedModules: u.allowedModules,
    });
  }

  if (!session) {
    return <div style={{ color: "var(--gray)" }}><span style={{ color: "var(--red)" }}>[ERROR]</span> Authentication required.</div>;
  }
  if (!isAdmin) {
    return <div style={{ color: "var(--red)" }}><span style={{ fontWeight: 700 }}>[ACCESS DENIED]</span> Admin privileges required.</div>;
  }

  const s = { label: { fontSize: "11px", fontWeight: 700 as const, color: "var(--green)", textTransform: "uppercase" as const, letterSpacing: "0.1em", marginBottom: "4px", display: "block" } };

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: "24px" }}>
        <div style={{ color: "var(--red)", fontSize: "18px", fontWeight: 700, marginBottom: "4px" }}>[ADMIN]</div>
        <div style={{ color: "var(--gray)", fontSize: "13px" }}>$ admin --users --manage</div>
      </div>

      {/* Add user button */}
      <div style={{ marginBottom: "20px", display: "flex", gap: "12px" }}>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          style={{ padding: "8px 20px", background: "transparent", border: "1px solid var(--green)", color: "var(--green)", fontFamily: "inherit", fontSize: "12px", fontWeight: 700, cursor: "pointer", textTransform: "uppercase", letterSpacing: "0.1em" }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(0, 255, 136, 0.1)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
        >
          {showAddForm ? "[  CANCEL  ]" : "[  + ADD USER  ]"}
        </button>
        <div style={{ fontSize: "12px", color: "var(--gray)", alignSelf: "center" }}>
          {users.length} user{users.length !== 1 ? "s" : ""} registered
        </div>
      </div>

      {/* Add user form */}
      {showAddForm && (
        <div style={{ padding: "16px", border: "1px solid var(--green)", backgroundColor: "rgba(0, 255, 136, 0.03)", marginBottom: "20px" }}>
          <div style={{ fontSize: "11px", fontWeight: 700, color: "var(--green)", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "12px" }}>NEW USER</div>
          <div className="admin-form-grid-3" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px", marginBottom: "12px" }}>
            <div>
              <label style={s.label}>--email *</label>
              <input value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="user@example.com" style={{ width: "100%", padding: "6px 10px", backgroundColor: "var(--bg-input)", border: "1px solid var(--border)", color: "var(--white)", fontFamily: "inherit", fontSize: "12px" }} />
            </div>
            <div>
              <label style={s.label}>--role</label>
              <select value={newRole} onChange={(e) => setNewRole(e.target.value)} style={{ width: "100%", padding: "6px 10px", backgroundColor: "var(--bg-input)", border: "1px solid var(--border)", color: "var(--white)", fontFamily: "inherit", fontSize: "12px" }}>
                <option value="user">user</option>
                <option value="admin">admin</option>
              </select>
            </div>
            <div>
              <label style={s.label}>--max-runs/day</label>
              <input value={newMaxRuns} onChange={(e) => setNewMaxRuns(e.target.value)} type="number" placeholder="200 (default)" style={{ width: "100%", padding: "6px 10px", backgroundColor: "var(--bg-input)", border: "1px solid var(--border)", color: "var(--white)", fontFamily: "inherit", fontSize: "12px" }} />
            </div>
          </div>
          <div className="admin-form-grid-2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "12px" }}>
            <div>
              <label style={s.label}>--max-monthly-cost-cents</label>
              <input value={newMaxCost} onChange={(e) => setNewMaxCost(e.target.value)} type="number" placeholder="e.g. 5000 = $50" style={{ width: "100%", padding: "6px 10px", backgroundColor: "var(--bg-input)", border: "1px solid var(--border)", color: "var(--white)", fontFamily: "inherit", fontSize: "12px" }} />
            </div>
            <div>
              <label style={s.label}>--allowed-models <span style={{ color: "var(--gray)", fontWeight: 400, textTransform: "none" }}>(comma-sep, empty=all)</span></label>
              <input value={newModels} onChange={(e) => setNewModels(e.target.value)} placeholder="claude-sonnet-4-5-20250929,gemini-2.0-flash" style={{ width: "100%", padding: "6px 10px", backgroundColor: "var(--bg-input)", border: "1px solid var(--border)", color: "var(--white)", fontFamily: "inherit", fontSize: "12px" }} />
            </div>
          </div>
          <div style={{ marginBottom: "12px" }}>
            <label style={s.label}>--allowed-modules <span style={{ color: "var(--gray)", fontWeight: 400, textTransform: "none" }}>(toggle to restrict)</span></label>
            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
              {ALL_MODULES.map((mod) => {
                const active = newModules.includes(mod);
                return (
                  <button
                    key={mod}
                    type="button"
                    onClick={() => setNewModules(active ? newModules.filter((m) => m !== mod) : [...newModules, mod])}
                    style={{
                      padding: "4px 10px", border: "1px solid", fontFamily: "inherit", fontSize: "11px",
                      fontWeight: 700, cursor: "pointer", textTransform: "uppercase",
                      borderColor: active ? "var(--green)" : "#333",
                      backgroundColor: active ? "rgba(0, 255, 136, 0.1)" : "transparent",
                      color: active ? "var(--green)" : "#555",
                    }}
                  >
                    {mod}
                  </button>
                );
              })}
            </div>
          </div>
          {addError && <div style={{ color: "var(--red)", fontSize: "12px", marginBottom: "8px" }}>[ERROR] {addError}</div>}
          <button onClick={handleAddUser} style={{ padding: "6px 16px", background: "transparent", border: "1px solid var(--green)", color: "var(--green)", fontFamily: "inherit", fontSize: "12px", fontWeight: 700, cursor: "pointer", textTransform: "uppercase" }}>
            [  CREATE  ]
          </button>
        </div>
      )}

      {error && <div style={{ padding: "12px", backgroundColor: "rgba(255, 68, 68, 0.08)", border: "1px solid var(--red)", color: "var(--red)", fontSize: "13px", marginBottom: "16px" }}><span style={{ fontWeight: 700 }}>[ERROR]</span> {error}</div>}

      {/* Users table */}
      {loading ? (
        <div style={{ color: "var(--green)", fontSize: "13px" }}><span style={{ animation: "blink 1s step-end infinite" }}>_</span> Loading users...</div>
      ) : (
        <div className="admin-table-wrap" style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", fontSize: "12px", borderCollapse: "collapse", fontFamily: "inherit" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--green)", textAlign: "left" }}>
                {["EMAIL", "ROLE", "STATUS", "RUNS/DAY LIMIT", "MONTHLY $$ LIMIT", "MONTHLY COST", "MODULES", "TOTAL RUNS", "ACTIONS"].map((h) => (
                  <th key={h} style={{ padding: "8px 12px 8px 0", color: "var(--green)", fontWeight: 700, fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.1em", whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const isEditing = editingId === u.id;
                const isDetail = detailId === u.id;
                return (
                  <tr key={u.id}>
                    <td colSpan={9} style={{ padding: 0 }}>
                      {/* Main row */}
                      <div className="admin-user-row" style={{ display: "grid", gridTemplateColumns: "1fr 70px 80px 100px 100px 90px 120px 80px 150px", alignItems: "center", borderBottom: "1px solid rgba(30, 42, 58, 0.5)", padding: "6px 0" }}>
                        <div>
                          <span onClick={() => loadDetail(u.id)} style={{ color: "var(--white)", cursor: "pointer", textDecoration: "none" }}
                            onMouseEnter={(e) => { e.currentTarget.style.color = "var(--green)"; }}
                            onMouseLeave={(e) => { e.currentTarget.style.color = "var(--white)"; }}
                          >
                            <span style={{ color: isDetail ? "var(--green)" : "#444", marginRight: "4px", fontSize: "10px" }}>{isDetail ? "▼" : "▶"}</span>
                            {u.email}
                          </span>
                          {u.name && <span style={{ color: "var(--dim)", fontSize: "10px", marginLeft: "6px" }}>({u.name})</span>}
                        </div>
                        <div>
                          {isEditing ? (
                            <select value={editData.role || u.role} onChange={(e) => setEditData({ ...editData, role: e.target.value })} style={{ width: "60px", padding: "2px 4px", backgroundColor: "var(--bg-input)", border: "1px solid var(--green)", color: "var(--white)", fontFamily: "inherit", fontSize: "11px" }}>
                              <option value="user">user</option>
                              <option value="admin">admin</option>
                            </select>
                          ) : (
                            <span style={{ color: u.role === "admin" ? "var(--red)" : "var(--gray)", fontSize: "11px", fontWeight: 700, textTransform: "uppercase" }}>{u.role}</span>
                          )}
                        </div>
                        <div>
                          <span style={{ color: u.active ? "var(--green)" : "var(--red)", fontSize: "11px", fontWeight: 700 }}>{u.active ? "ACTIVE" : "DISABLED"}</span>
                        </div>
                        <div>
                          {isEditing ? (
                            <input type="number" value={editData.maxRunsPerDay ?? ""} onChange={(e) => setEditData({ ...editData, maxRunsPerDay: e.target.value === "" ? null : parseInt(e.target.value) })} placeholder="200" style={{ width: "70px", padding: "2px 4px", backgroundColor: "var(--bg-input)", border: "1px solid var(--green)", color: "var(--white)", fontFamily: "inherit", fontSize: "11px" }} />
                          ) : (
                            <span style={{ color: "var(--gray)", fontSize: "11px" }}>{u.maxRunsPerDay ?? "200"}</span>
                          )}
                        </div>
                        <div>
                          {isEditing ? (
                            <input type="number" value={editData.maxMonthlyCostCents ?? ""} onChange={(e) => setEditData({ ...editData, maxMonthlyCostCents: e.target.value === "" ? null : parseInt(e.target.value) })} placeholder="cents (∞)" style={{ width: "70px", padding: "2px 4px", backgroundColor: "var(--bg-input)", border: "1px solid var(--green)", color: "var(--white)", fontFamily: "inherit", fontSize: "11px" }} />
                          ) : (
                            <span style={{ color: "var(--gray)", fontSize: "11px" }}>{u.maxMonthlyCostCents != null ? `$${(u.maxMonthlyCostCents / 100).toFixed(2)}` : "∞"}</span>
                          )}
                        </div>
                        <div><span style={{ color: "var(--yellow)", fontSize: "11px" }}>${u.monthlyCost.toFixed(4)}</span></div>
                        <div>
                          {isEditing ? (
                            <div style={{ display: "flex", gap: "2px", flexWrap: "wrap" }}>
                              {ALL_MODULES.map((mod) => {
                                const editMods = editData.allowedModules;
                                const active = editMods === null || editMods === undefined || editMods.includes(mod);
                                return (
                                  <button
                                    key={mod}
                                    type="button"
                                    onClick={() => {
                                      const current = editData.allowedModules ?? [...ALL_MODULES];
                                      const updated = active ? current.filter((m) => m !== mod) : [...current, mod];
                                      setEditData({ ...editData, allowedModules: updated.length === ALL_MODULES.length ? null : updated });
                                    }}
                                    style={{
                                      padding: "1px 4px", border: "1px solid", fontFamily: "inherit", fontSize: "9px",
                                      fontWeight: 700, cursor: "pointer", textTransform: "uppercase",
                                      borderColor: active ? "var(--green)" : "#333",
                                      backgroundColor: active ? "rgba(0, 255, 136, 0.1)" : "transparent",
                                      color: active ? "var(--green)" : "#555",
                                    }}
                                  >
                                    {mod}
                                  </button>
                                );
                              })}
                            </div>
                          ) : (
                            <span style={{ fontSize: "10px", color: "var(--gray)" }}>
                              {u.allowedModules === null ? (
                                <span style={{ color: "var(--green)" }}>ALL</span>
                              ) : (
                                u.allowedModules.map((m) => m.toUpperCase()).join(", ")
                              )}
                            </span>
                          )}
                        </div>
                        <div><span style={{ color: "var(--cyan)", fontSize: "11px" }}>{u.totalRuns}</span></div>
                        <div style={{ display: "flex", gap: "4px" }}>
                          {isEditing ? (
                            <>
                              <button onClick={() => handleSaveEdit(u.id)} style={{ padding: "2px 8px", background: "transparent", border: "1px solid var(--green)", color: "var(--green)", fontFamily: "inherit", fontSize: "10px", cursor: "pointer" }}>SAVE</button>
                              <button onClick={() => { setEditingId(null); setEditData({}); }} style={{ padding: "2px 8px", background: "transparent", border: "1px solid var(--gray)", color: "var(--gray)", fontFamily: "inherit", fontSize: "10px", cursor: "pointer" }}>CANCEL</button>
                            </>
                          ) : (
                            <>
                              <button onClick={() => startEdit(u)} style={{ padding: "2px 8px", background: "transparent", border: "1px solid var(--cyan)", color: "var(--cyan)", fontFamily: "inherit", fontSize: "10px", cursor: "pointer" }}>EDIT</button>
                              <button onClick={() => handleToggleActive(u.id, u.active)} style={{ padding: "2px 8px", background: "transparent", border: `1px solid ${u.active ? "var(--red)" : "var(--green)"}`, color: u.active ? "var(--red)" : "var(--green)", fontFamily: "inherit", fontSize: "10px", cursor: "pointer" }}>{u.active ? "DISABLE" : "ENABLE"}</button>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Detail panel */}
                      {isDetail && detail && (
                        <div style={{ padding: "12px 16px", backgroundColor: "rgba(13, 17, 23, 0.8)", borderBottom: "1px solid rgba(0, 255, 136, 0.15)", borderLeft: "2px solid var(--green)", marginLeft: "8px" }}>
                          <div className="admin-detail-stats" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px", marginBottom: "12px" }}>
                            <div style={{ border: "1px solid var(--border)", padding: "8px" }}>
                              <div style={{ fontSize: "10px", color: "var(--yellow)", fontWeight: 700, textTransform: "uppercase" }}>Today</div>
                              <div style={{ fontSize: "18px", color: "var(--cyan)", fontWeight: 700 }}>{detail.stats.todayRuns} <span style={{ fontSize: "11px", color: "var(--gray)" }}>runs</span></div>
                            </div>
                            <div style={{ border: "1px solid var(--border)", padding: "8px" }}>
                              <div style={{ fontSize: "10px", color: "var(--yellow)", fontWeight: 700, textTransform: "uppercase" }}>This Month</div>
                              <div style={{ fontSize: "18px", color: "var(--cyan)", fontWeight: 700 }}>{detail.stats.monthlyRuns} <span style={{ fontSize: "11px", color: "var(--gray)" }}>runs</span></div>
                            </div>
                            <div style={{ border: "1px solid var(--border)", padding: "8px" }}>
                              <div style={{ fontSize: "10px", color: "var(--yellow)", fontWeight: 700, textTransform: "uppercase" }}>Monthly Cost</div>
                              <div style={{ fontSize: "18px", color: "var(--yellow)", fontWeight: 700 }}>${detail.stats.monthlyCost}</div>
                            </div>
                          </div>
                          {detail.user.allowedModules && detail.user.allowedModules.length > 0 && (
                            <div style={{ fontSize: "11px", color: "var(--gray)", marginBottom: "4px" }}>
                              <span style={{ color: "var(--green)" }}>--allowed-modules:</span>{" "}
                              {detail.user.allowedModules.map((m) => m.toUpperCase()).join(", ")}
                            </div>
                          )}
                          {detail.user.allowedModels && detail.user.allowedModels.length > 0 && (
                            <div style={{ fontSize: "11px", color: "var(--gray)", marginBottom: "8px" }}>
                              <span style={{ color: "var(--green)" }}>--allowed-models:</span> {Array.isArray(detail.user.allowedModels) ? detail.user.allowedModels.join(", ") : String(detail.user.allowedModels)}
                            </div>
                          )}
                          <div style={{ fontSize: "10px", color: "var(--gray)", marginBottom: "4px" }}>
                            <span style={{ color: "var(--yellow)" }}>JOINED:</span> {new Date(detail.user.createdAt).toLocaleDateString("sl-SI")}
                            <span style={{ marginLeft: "12px", color: "var(--yellow)" }}>LAST LOGIN:</span> {new Date(detail.user.lastLoginAt).toLocaleString("sl-SI")}
                          </div>
                          {/* Recent runs */}
                          <div style={{ marginTop: "8px" }}>
                            <div style={{ fontSize: "10px", fontWeight: 700, color: "var(--green)", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "4px" }}>Recent Runs</div>
                            <div style={{ maxHeight: "200px", overflowY: "auto" }}>
                              {detail.recentRuns.map((r) => (
                                <div key={r.id} style={{ display: "flex", gap: "8px", fontSize: "11px", padding: "3px 0", borderBottom: "1px solid rgba(30, 42, 58, 0.3)" }}>
                                  <span style={{ color: "var(--yellow)", fontWeight: 700, textTransform: "uppercase", width: "40px" }}>{r.type}</span>
                                  <span style={{ color: r.status === "done" ? "var(--green)" : r.status === "error" ? "var(--red)" : "var(--gray)", width: "50px" }}>{r.status}</span>
                                  <span style={{ color: "var(--gray)", flex: 1 }}>{r.model}</span>
                                  <span style={{ color: "var(--dim)" }}>{new Date(r.createdAt).toLocaleString("sl-SI", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
                                </div>
                              ))}
                              {detail.recentRuns.length === 0 && <div style={{ color: "#333", fontSize: "11px" }}>No runs yet</div>}
                            </div>
                          </div>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
