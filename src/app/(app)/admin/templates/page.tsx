"use client";

import { useSession } from "next-auth/react";
import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

type Template = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  systemPrompt: string;
  userPromptTemplate: string | null;
  category: string;
  knowledgeText: string | null;
  isActive: boolean;
  sortOrder: number;
  currentVersion: number;
  createdAt: string;
  creator: { email: string; name: string | null };
};

type TemplateVersion = {
  id: string;
  versionNumber: number;
  systemPrompt: string;
  userPromptTemplate: string | null;
  knowledgeText: string | null;
  category: string;
  description: string | null;
  createdAt: string;
  author: { email: string; name: string | null };
};

type DiffLine = { type: "same" | "add" | "remove"; text: string };

const CATEGORIES = ["general", "journalism", "seo", "social", "legal", "email", "analysis"];

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export default function AdminTemplatesPage() {
  const { data: session } = useSession();
  const isAdmin = (session?.user as Record<string, unknown>)?.role === "admin";

  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Form state
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    slug: "",
    description: "",
    systemPrompt: "",
    userPromptTemplate: "",
    category: "general",
    knowledgeText: "",
    isActive: true,
    sortOrder: 0,
  });
  const [formError, setFormError] = useState("");

  // Expand detail
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Versioning state
  const [versions, setVersions] = useState<TemplateVersion[]>([]);
  const [showVersions, setShowVersions] = useState<string | null>(null);
  const [diffData, setDiffData] = useState<{ systemPrompt: DiffLine[] } | null>(null);
  const [diffVersions, setDiffVersions] = useState<[number, number] | null>(null);

  const loadTemplates = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await fetch("/api/admin/templates");
      const data = await resp.json();
      if (data.error) { setError(data.error); return; }
      setTemplates(data.templates || []);
    } catch { setError("Failed to load templates"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (session && isAdmin) loadTemplates();
  }, [session, isAdmin, loadTemplates]);

  function resetForm() {
    setFormData({ name: "", slug: "", description: "", systemPrompt: "", userPromptTemplate: "", category: "general", knowledgeText: "", isActive: true, sortOrder: 0 });
    setFormError("");
    setEditingId(null);
  }

  function startEdit(t: Template) {
    setFormData({
      name: t.name,
      slug: t.slug,
      description: t.description || "",
      systemPrompt: t.systemPrompt,
      userPromptTemplate: t.userPromptTemplate || "",
      category: t.category,
      knowledgeText: t.knowledgeText || "",
      isActive: t.isActive,
      sortOrder: t.sortOrder,
    });
    setEditingId(t.id);
    setShowForm(true);
    setFormError("");
  }

  async function handleSubmit() {
    setFormError("");
    if (!formData.name.trim()) { setFormError("Name is required"); return; }
    if (!formData.systemPrompt.trim()) { setFormError("System prompt is required"); return; }

    const payload = {
      ...formData,
      slug: formData.slug.trim() || slugify(formData.name),
    };

    try {
      const url = editingId ? `/api/admin/templates/${editingId}` : "/api/admin/templates";
      const method = editingId ? "PATCH" : "POST";
      const resp = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await resp.json();
      if (!resp.ok) { setFormError(data.error || "Failed"); return; }
      resetForm();
      setShowForm(false);
      loadTemplates();
    } catch { setFormError("Request failed"); }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this template?")) return;
    try {
      await fetch(`/api/admin/templates/${id}`, { method: "DELETE" });
      if (expandedId === id) setExpandedId(null);
      loadTemplates();
    } catch { /* ignore */ }
  }

  async function handleToggleActive(id: string, currentActive: boolean) {
    try {
      await fetch(`/api/admin/templates/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !currentActive }),
      });
      loadTemplates();
    } catch { /* ignore */ }
  }

  async function loadVersions(templateId: string) {
    try {
      const resp = await fetch(`/api/admin/templates/${templateId}/versions`);
      const data = await resp.json();
      setVersions(data.versions || []);
      setShowVersions(templateId);
      setDiffData(null);
      setDiffVersions(null);
    } catch { /* ignore */ }
  }

  async function handleDiff(templateId: string, vA: number, vB: number) {
    try {
      const resp = await fetch(`/api/admin/templates/${templateId}/versions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ versionA: vA, versionB: vB }),
      });
      const data = await resp.json();
      setDiffData(data.diff);
      setDiffVersions([vA, vB]);
    } catch { /* ignore */ }
  }

  async function handleRollback(templateId: string, versionId: string) {
    if (!confirm("Rollback to this version? A new version will be created.")) return;
    try {
      await fetch(`/api/admin/templates/${templateId}/versions/${versionId}`, {
        method: "POST",
      });
      loadTemplates();
      loadVersions(templateId);
    } catch { /* ignore */ }
  }

  if (!session) return <div style={{ color: "var(--gray)" }}><span style={{ color: "var(--red)" }}>[ERROR]</span> Authentication required.</div>;
  if (!isAdmin) return <div style={{ color: "var(--red)" }}><span style={{ fontWeight: 700 }}>[ACCESS DENIED]</span> Admin privileges required.</div>;

  const s = {
    label: { fontSize: "11px", fontWeight: 700 as const, color: "var(--green)", textTransform: "uppercase" as const, letterSpacing: "0.1em", marginBottom: "4px", display: "block" },
    input: { width: "100%", padding: "6px 10px", backgroundColor: "var(--bg-input)", border: "1px solid var(--border)", color: "var(--white)", fontFamily: "inherit", fontSize: "12px" },
    textarea: { width: "100%", padding: "8px 10px", backgroundColor: "var(--bg-input)", border: "1px solid var(--border)", color: "var(--white)", fontFamily: "inherit", fontSize: "12px", resize: "vertical" as const, minHeight: "80px" },
  };

  return (
    <div>
      {/* Breadcrumb */}
      <div style={{ marginBottom: "24px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
          <Link href="/admin" className="no-underline" style={{ color: "var(--red)", fontSize: "18px", fontWeight: 700 }}>[ADMIN]</Link>
          <span style={{ color: "#333" }}>/</span>
          <span style={{ color: "var(--yellow)", fontSize: "18px", fontWeight: 700 }}>TEMPLATES</span>
        </div>
        <div style={{ color: "var(--gray)", fontSize: "13px" }}>$ admin --templates --manage</div>
      </div>

      {/* Actions */}
      <div style={{ marginBottom: "20px", display: "flex", gap: "12px", alignItems: "center" }}>
        <button
          onClick={() => { if (showForm && !editingId) { setShowForm(false); } else { resetForm(); setShowForm(true); } }}
          style={{ padding: "8px 20px", background: "transparent", border: "1px solid var(--green)", color: "var(--green)", fontFamily: "inherit", fontSize: "12px", fontWeight: 700, cursor: "pointer", textTransform: "uppercase", letterSpacing: "0.1em" }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(0, 255, 136, 0.1)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
        >
          {showForm && !editingId ? "[  CANCEL  ]" : "[  + NEW TEMPLATE  ]"}
        </button>
        <div style={{ fontSize: "12px", color: "var(--gray)" }}>
          {templates.length} template{templates.length !== 1 ? "s" : ""} | {templates.filter(t => t.isActive).length} active
        </div>
      </div>

      {/* Form */}
      {showForm && (
        <div style={{ padding: "16px", border: `1px solid ${editingId ? "var(--cyan)" : "var(--green)"}`, backgroundColor: `rgba(${editingId ? "0, 229, 255" : "0, 255, 136"}, 0.03)`, marginBottom: "20px" }}>
          <div style={{ fontSize: "11px", fontWeight: 700, color: editingId ? "var(--cyan)" : "var(--green)", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "12px" }}>
            {editingId ? "EDIT TEMPLATE" : "NEW TEMPLATE"}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px", marginBottom: "12px" }}>
            <div>
              <label style={s.label}>--name *</label>
              <input value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} placeholder="e.g. Novinarski članek" style={s.input} />
            </div>
            <div>
              <label style={s.label}>--slug</label>
              <input value={formData.slug} onChange={(e) => setFormData({ ...formData, slug: e.target.value })} placeholder={formData.name ? slugify(formData.name) : "auto-generated"} style={s.input} />
            </div>
            <div>
              <label style={s.label}>--category</label>
              <select value={formData.category} onChange={(e) => setFormData({ ...formData, category: e.target.value })} style={s.input}>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div style={{ marginBottom: "12px" }}>
            <label style={s.label}>--description</label>
            <input value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} placeholder="Short description for users" style={s.input} />
          </div>
          <div style={{ marginBottom: "12px" }}>
            <label style={s.label}>--system-prompt * <span style={{ color: "var(--gray)", fontWeight: 400, textTransform: "none" }}>(instructions for the AI)</span></label>
            <textarea value={formData.systemPrompt} onChange={(e) => setFormData({ ...formData, systemPrompt: e.target.value })} placeholder="You are a professional journalist..." style={{ ...s.textarea, minHeight: "120px" }} />
          </div>
          <div style={{ marginBottom: "12px" }}>
            <label style={s.label}>--user-prompt-template <span style={{ color: "var(--gray)", fontWeight: 400, textTransform: "none" }}>(optional, use {"{{input}}"} as placeholder)</span></label>
            <textarea value={formData.userPromptTemplate} onChange={(e) => setFormData({ ...formData, userPromptTemplate: e.target.value })} placeholder='e.g. Write an article based on: {{input}}' style={s.textarea} />
          </div>
          <div style={{ marginBottom: "12px" }}>
            <label style={s.label}>--knowledge-text <span style={{ color: "var(--gray)", fontWeight: 400, textTransform: "none" }}>(inline reference material)</span></label>
            <textarea value={formData.knowledgeText} onChange={(e) => setFormData({ ...formData, knowledgeText: e.target.value })} placeholder="Paste reference text, style guides, rules..." style={s.textarea} />
          </div>
          <div style={{ display: "flex", gap: "16px", alignItems: "center", marginBottom: "12px" }}>
            <label style={{ fontSize: "11px", color: "var(--white)", display: "flex", alignItems: "center", gap: "6px", cursor: "pointer" }}>
              <input type="checkbox" checked={formData.isActive} onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })} />
              <span style={{ color: "var(--green)", fontWeight: 700, textTransform: "uppercase", fontSize: "10px" }}>Active</span>
            </label>
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <label style={{ fontSize: "10px", color: "var(--green)", fontWeight: 700, textTransform: "uppercase" }}>Sort order:</label>
              <input type="number" value={formData.sortOrder} onChange={(e) => setFormData({ ...formData, sortOrder: parseInt(e.target.value) || 0 })} style={{ ...s.input, width: "60px" }} />
            </div>
          </div>
          {formError && <div style={{ color: "var(--red)", fontSize: "12px", marginBottom: "8px" }}>[ERROR] {formError}</div>}
          <div style={{ display: "flex", gap: "8px" }}>
            <button onClick={handleSubmit} style={{ padding: "6px 16px", background: "transparent", border: `1px solid ${editingId ? "var(--cyan)" : "var(--green)"}`, color: editingId ? "var(--cyan)" : "var(--green)", fontFamily: "inherit", fontSize: "12px", fontWeight: 700, cursor: "pointer", textTransform: "uppercase" }}>
              {editingId ? "[  SAVE  ]" : "[  CREATE  ]"}
            </button>
            {editingId && (
              <button onClick={() => { resetForm(); setShowForm(false); }} style={{ padding: "6px 16px", background: "transparent", border: "1px solid var(--gray)", color: "var(--gray)", fontFamily: "inherit", fontSize: "12px", fontWeight: 700, cursor: "pointer", textTransform: "uppercase" }}>
                [  CANCEL  ]
              </button>
            )}
          </div>
        </div>
      )}

      {error && <div style={{ padding: "12px", backgroundColor: "rgba(255, 68, 68, 0.08)", border: "1px solid var(--red)", color: "var(--red)", fontSize: "13px", marginBottom: "16px" }}><span style={{ fontWeight: 700 }}>[ERROR]</span> {error}</div>}

      {/* Templates table */}
      {loading ? (
        <div style={{ color: "var(--green)", fontSize: "13px" }}><span style={{ animation: "blink 1s step-end infinite" }}>_</span> Loading templates...</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", fontSize: "12px", borderCollapse: "collapse", fontFamily: "inherit" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--green)", textAlign: "left" }}>
                {["NAME", "SLUG", "CATEGORY", "STATUS", "ORDER", "ACTIONS"].map((h) => (
                  <th key={h} style={{ padding: "8px 12px 8px 0", color: "var(--green)", fontWeight: 700, fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.1em", whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {templates.map((t) => {
                const isExpanded = expandedId === t.id;
                return (
                  <tr key={t.id}>
                    <td colSpan={6} style={{ padding: 0 }}>
                      {/* Main row */}
                      <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr 0.8fr 0.6fr 0.4fr 1.2fr", alignItems: "center", borderBottom: "1px solid rgba(30, 42, 58, 0.5)", padding: "8px 0" }}>
                        <div>
                          <span onClick={() => setExpandedId(isExpanded ? null : t.id)} style={{ color: "var(--white)", cursor: "pointer" }}
                            onMouseEnter={(e) => { e.currentTarget.style.color = "var(--green)"; }}
                            onMouseLeave={(e) => { e.currentTarget.style.color = "var(--white)"; }}
                          >
                            <span style={{ color: isExpanded ? "var(--green)" : "#444", marginRight: "4px", fontSize: "10px" }}>{isExpanded ? "▼" : "▶"}</span>
                            {t.name}
                          </span>
                          {t.description && <div style={{ color: "var(--gray)", fontSize: "10px", marginTop: "2px", paddingLeft: "14px" }}>{t.description}</div>}
                        </div>
                        <div style={{ color: "var(--gray)", fontSize: "11px" }}>{t.slug}</div>
                        <div><span style={{ color: "var(--yellow)", fontSize: "10px", fontWeight: 700, textTransform: "uppercase", padding: "2px 6px", border: "1px solid rgba(255, 204, 0, 0.3)", borderRadius: "2px" }}>{t.category}</span></div>
                        <div><span style={{ color: t.isActive ? "var(--green)" : "var(--red)", fontSize: "11px", fontWeight: 700 }}>{t.isActive ? "ON" : "OFF"}</span></div>
                        <div style={{ color: "var(--gray)", fontSize: "11px" }}>{t.sortOrder}</div>
                        <div style={{ display: "flex", gap: "4px" }}>
                          <button onClick={() => startEdit(t)} style={{ padding: "2px 8px", background: "transparent", border: "1px solid var(--cyan)", color: "var(--cyan)", fontFamily: "inherit", fontSize: "10px", cursor: "pointer" }}>EDIT</button>
                          <button onClick={() => handleToggleActive(t.id, t.isActive)} style={{ padding: "2px 8px", background: "transparent", border: `1px solid ${t.isActive ? "var(--yellow)" : "var(--green)"}`, color: t.isActive ? "var(--yellow)" : "var(--green)", fontFamily: "inherit", fontSize: "10px", cursor: "pointer" }}>{t.isActive ? "DISABLE" : "ENABLE"}</button>
                          <button onClick={() => handleDelete(t.id)} style={{ padding: "2px 8px", background: "transparent", border: "1px solid var(--red)", color: "var(--red)", fontFamily: "inherit", fontSize: "10px", cursor: "pointer" }}>DEL</button>
                        </div>
                      </div>

                      {/* Expanded detail */}
                      {isExpanded && (
                        <div style={{ padding: "12px 16px", backgroundColor: "rgba(13, 17, 23, 0.8)", borderBottom: "1px solid rgba(0, 255, 136, 0.15)", borderLeft: "2px solid var(--green)", marginLeft: "8px" }}>
                          <div style={{ marginBottom: "8px" }}>
                            <div style={{ fontSize: "10px", fontWeight: 700, color: "var(--green)", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "4px" }}>System Prompt</div>
                            <div style={{ padding: "8px", backgroundColor: "var(--bg)", border: "1px solid var(--border)", fontSize: "11px", color: "var(--white)", whiteSpace: "pre-wrap", maxHeight: "200px", overflowY: "auto" }}>{t.systemPrompt}</div>
                          </div>
                          {t.userPromptTemplate && (
                            <div style={{ marginBottom: "8px" }}>
                              <div style={{ fontSize: "10px", fontWeight: 700, color: "var(--yellow)", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "4px" }}>User Prompt Template</div>
                              <div style={{ padding: "8px", backgroundColor: "var(--bg)", border: "1px solid var(--border)", fontSize: "11px", color: "var(--white)", whiteSpace: "pre-wrap" }}>{t.userPromptTemplate}</div>
                            </div>
                          )}
                          {t.knowledgeText && (
                            <div style={{ marginBottom: "8px" }}>
                              <div style={{ fontSize: "10px", fontWeight: 700, color: "var(--cyan)", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "4px" }}>Knowledge Text</div>
                              <div style={{ padding: "8px", backgroundColor: "var(--bg)", border: "1px solid var(--border)", fontSize: "11px", color: "var(--white)", whiteSpace: "pre-wrap", maxHeight: "150px", overflowY: "auto" }}>{t.knowledgeText.substring(0, 500)}{t.knowledgeText.length > 500 ? "..." : ""}</div>
                            </div>
                          )}
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "8px" }}>
                            <div style={{ fontSize: "10px", color: "var(--gray)" }}>
                              Created by <span style={{ color: "var(--white)" }}>{t.creator.email}</span> on {new Date(t.createdAt).toLocaleDateString("sl-SI")}
                              <span style={{ marginLeft: "12px", color: "var(--yellow)" }}>v{t.currentVersion}</span>
                            </div>
                            <button
                              onClick={() => { showVersions === t.id ? setShowVersions(null) : loadVersions(t.id); }}
                              style={{ padding: "3px 10px", background: "transparent", border: "1px solid var(--yellow)", color: "var(--yellow)", fontFamily: "inherit", fontSize: "10px", fontWeight: 700, cursor: "pointer" }}
                            >
                              {showVersions === t.id ? "HIDE VERSIONS" : "VERSION HISTORY"}
                            </button>
                          </div>

                          {/* Version history panel */}
                          {showVersions === t.id && versions.length > 0 && (
                            <div style={{ marginTop: "12px", padding: "12px", backgroundColor: "var(--bg)", border: "1px solid rgba(255, 204, 0, 0.2)" }}>
                              <div style={{ fontSize: "10px", fontWeight: 700, color: "var(--yellow)", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "8px" }}>
                                VERSION HISTORY ({versions.length} versions)
                              </div>
                              <div style={{ display: "flex", flexDirection: "column", gap: "4px", maxHeight: "200px", overflowY: "auto" }}>
                                {versions.map((v) => (
                                  <div key={v.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "4px 8px", backgroundColor: v.versionNumber === t.currentVersion ? "rgba(255, 204, 0, 0.08)" : "transparent", border: `1px solid ${v.versionNumber === t.currentVersion ? "rgba(255, 204, 0, 0.3)" : "var(--border)"}` }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                      <span style={{ color: v.versionNumber === t.currentVersion ? "var(--yellow)" : "var(--gray)", fontSize: "11px", fontWeight: 700, minWidth: "30px" }}>v{v.versionNumber}</span>
                                      <span style={{ color: "var(--text-secondary)", fontSize: "10px" }}>{new Date(v.createdAt).toLocaleString("sl-SI", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
                                      <span style={{ color: "var(--gray)", fontSize: "10px" }}>{v.author.email}</span>
                                      {v.description && <span style={{ color: "var(--gray)", fontSize: "9px", fontStyle: "italic" }}>{v.description.substring(0, 40)}</span>}
                                    </div>
                                    <div style={{ display: "flex", gap: "4px" }}>
                                      {versions.length > 1 && v.versionNumber > 1 && (
                                        <button
                                          onClick={() => handleDiff(t.id, v.versionNumber - 1, v.versionNumber)}
                                          style={{ padding: "1px 6px", background: "transparent", border: "1px solid var(--cyan)", color: "var(--cyan)", fontFamily: "inherit", fontSize: "9px", cursor: "pointer" }}
                                        >
                                          DIFF
                                        </button>
                                      )}
                                      {v.versionNumber !== t.currentVersion && (
                                        <button
                                          onClick={() => handleRollback(t.id, v.id)}
                                          style={{ padding: "1px 6px", background: "transparent", border: "1px solid #ff8800", color: "#ff8800", fontFamily: "inherit", fontSize: "9px", cursor: "pointer" }}
                                        >
                                          ROLLBACK
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </div>

                              {/* Diff view */}
                              {diffData && diffVersions && (
                                <div style={{ marginTop: "8px", padding: "8px", backgroundColor: "var(--bg-input)", border: "1px solid var(--border)" }}>
                                  <div style={{ fontSize: "10px", fontWeight: 700, color: "var(--cyan)", marginBottom: "4px" }}>
                                    DIFF: v{diffVersions[0]} → v{diffVersions[1]}
                                  </div>
                                  <div style={{ fontSize: "11px", fontFamily: "monospace", maxHeight: "200px", overflowY: "auto" }}>
                                    {diffData.systemPrompt.map((line, i) => (
                                      <div key={i} style={{
                                        padding: "1px 4px",
                                        backgroundColor: line.type === "add" ? "rgba(0, 255, 136, 0.08)" : line.type === "remove" ? "rgba(255, 68, 68, 0.08)" : "transparent",
                                        color: line.type === "add" ? "var(--green)" : line.type === "remove" ? "var(--red)" : "var(--gray)",
                                      }}>
                                        <span style={{ marginRight: "4px" }}>{line.type === "add" ? "+" : line.type === "remove" ? "-" : " "}</span>
                                        {line.text}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
              {templates.length === 0 && (
                <tr><td colSpan={6} style={{ padding: "20px 0", textAlign: "center", color: "#333", fontSize: "12px" }}>No templates yet. Create one above.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
