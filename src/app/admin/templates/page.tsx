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
  createdAt: string;
  creator: { email: string; name: string | null };
};

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

  if (!session) return <div style={{ color: "#5a6a7a" }}><span style={{ color: "#ff4444" }}>[ERROR]</span> Authentication required.</div>;
  if (!isAdmin) return <div style={{ color: "#ff4444" }}><span style={{ fontWeight: 700 }}>[ACCESS DENIED]</span> Admin privileges required.</div>;

  const s = {
    label: { fontSize: "11px", fontWeight: 700 as const, color: "#00ff88", textTransform: "uppercase" as const, letterSpacing: "0.1em", marginBottom: "4px", display: "block" },
    input: { width: "100%", padding: "6px 10px", backgroundColor: "#111820", border: "1px solid #1e2a3a", color: "#e0e0e0", fontFamily: "inherit", fontSize: "12px" },
    textarea: { width: "100%", padding: "8px 10px", backgroundColor: "#111820", border: "1px solid #1e2a3a", color: "#e0e0e0", fontFamily: "inherit", fontSize: "12px", resize: "vertical" as const, minHeight: "80px" },
  };

  return (
    <div>
      {/* Breadcrumb */}
      <div style={{ marginBottom: "24px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
          <Link href="/admin" className="no-underline" style={{ color: "#ff4444", fontSize: "18px", fontWeight: 700 }}>[ADMIN]</Link>
          <span style={{ color: "#333" }}>/</span>
          <span style={{ color: "#ffcc00", fontSize: "18px", fontWeight: 700 }}>TEMPLATES</span>
        </div>
        <div style={{ color: "#5a6a7a", fontSize: "13px" }}>$ admin --templates --manage</div>
      </div>

      {/* Actions */}
      <div style={{ marginBottom: "20px", display: "flex", gap: "12px", alignItems: "center" }}>
        <button
          onClick={() => { if (showForm && !editingId) { setShowForm(false); } else { resetForm(); setShowForm(true); } }}
          style={{ padding: "8px 20px", background: "transparent", border: "1px solid #00ff88", color: "#00ff88", fontFamily: "inherit", fontSize: "12px", fontWeight: 700, cursor: "pointer", textTransform: "uppercase", letterSpacing: "0.1em" }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(0, 255, 136, 0.1)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
        >
          {showForm && !editingId ? "[  CANCEL  ]" : "[  + NEW TEMPLATE  ]"}
        </button>
        <div style={{ fontSize: "12px", color: "#5a6a7a" }}>
          {templates.length} template{templates.length !== 1 ? "s" : ""} | {templates.filter(t => t.isActive).length} active
        </div>
      </div>

      {/* Form */}
      {showForm && (
        <div style={{ padding: "16px", border: `1px solid ${editingId ? "#00e5ff" : "#00ff88"}`, backgroundColor: `rgba(${editingId ? "0, 229, 255" : "0, 255, 136"}, 0.03)`, marginBottom: "20px" }}>
          <div style={{ fontSize: "11px", fontWeight: 700, color: editingId ? "#00e5ff" : "#00ff88", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "12px" }}>
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
            <label style={s.label}>--system-prompt * <span style={{ color: "#5a6a7a", fontWeight: 400, textTransform: "none" }}>(instructions for the AI)</span></label>
            <textarea value={formData.systemPrompt} onChange={(e) => setFormData({ ...formData, systemPrompt: e.target.value })} placeholder="You are a professional journalist..." style={{ ...s.textarea, minHeight: "120px" }} />
          </div>
          <div style={{ marginBottom: "12px" }}>
            <label style={s.label}>--user-prompt-template <span style={{ color: "#5a6a7a", fontWeight: 400, textTransform: "none" }}>(optional, use {"{{input}}"} as placeholder)</span></label>
            <textarea value={formData.userPromptTemplate} onChange={(e) => setFormData({ ...formData, userPromptTemplate: e.target.value })} placeholder='e.g. Write an article based on: {{input}}' style={s.textarea} />
          </div>
          <div style={{ marginBottom: "12px" }}>
            <label style={s.label}>--knowledge-text <span style={{ color: "#5a6a7a", fontWeight: 400, textTransform: "none" }}>(inline reference material)</span></label>
            <textarea value={formData.knowledgeText} onChange={(e) => setFormData({ ...formData, knowledgeText: e.target.value })} placeholder="Paste reference text, style guides, rules..." style={s.textarea} />
          </div>
          <div style={{ display: "flex", gap: "16px", alignItems: "center", marginBottom: "12px" }}>
            <label style={{ fontSize: "11px", color: "#e0e0e0", display: "flex", alignItems: "center", gap: "6px", cursor: "pointer" }}>
              <input type="checkbox" checked={formData.isActive} onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })} />
              <span style={{ color: "#00ff88", fontWeight: 700, textTransform: "uppercase", fontSize: "10px" }}>Active</span>
            </label>
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <label style={{ fontSize: "10px", color: "#00ff88", fontWeight: 700, textTransform: "uppercase" }}>Sort order:</label>
              <input type="number" value={formData.sortOrder} onChange={(e) => setFormData({ ...formData, sortOrder: parseInt(e.target.value) || 0 })} style={{ ...s.input, width: "60px" }} />
            </div>
          </div>
          {formError && <div style={{ color: "#ff4444", fontSize: "12px", marginBottom: "8px" }}>[ERROR] {formError}</div>}
          <div style={{ display: "flex", gap: "8px" }}>
            <button onClick={handleSubmit} style={{ padding: "6px 16px", background: "transparent", border: `1px solid ${editingId ? "#00e5ff" : "#00ff88"}`, color: editingId ? "#00e5ff" : "#00ff88", fontFamily: "inherit", fontSize: "12px", fontWeight: 700, cursor: "pointer", textTransform: "uppercase" }}>
              {editingId ? "[  SAVE  ]" : "[  CREATE  ]"}
            </button>
            {editingId && (
              <button onClick={() => { resetForm(); setShowForm(false); }} style={{ padding: "6px 16px", background: "transparent", border: "1px solid #5a6a7a", color: "#5a6a7a", fontFamily: "inherit", fontSize: "12px", fontWeight: 700, cursor: "pointer", textTransform: "uppercase" }}>
                [  CANCEL  ]
              </button>
            )}
          </div>
        </div>
      )}

      {error && <div style={{ padding: "12px", backgroundColor: "rgba(255, 68, 68, 0.08)", border: "1px solid #ff4444", color: "#ff4444", fontSize: "13px", marginBottom: "16px" }}><span style={{ fontWeight: 700 }}>[ERROR]</span> {error}</div>}

      {/* Templates table */}
      {loading ? (
        <div style={{ color: "#00ff88", fontSize: "13px" }}><span style={{ animation: "blink 1s step-end infinite" }}>_</span> Loading templates...</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", fontSize: "12px", borderCollapse: "collapse", fontFamily: "inherit" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #00ff88", textAlign: "left" }}>
                {["NAME", "SLUG", "CATEGORY", "STATUS", "ORDER", "ACTIONS"].map((h) => (
                  <th key={h} style={{ padding: "8px 12px 8px 0", color: "#00ff88", fontWeight: 700, fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.1em", whiteSpace: "nowrap" }}>{h}</th>
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
                          <span onClick={() => setExpandedId(isExpanded ? null : t.id)} style={{ color: "#e0e0e0", cursor: "pointer" }}
                            onMouseEnter={(e) => { e.currentTarget.style.color = "#00ff88"; }}
                            onMouseLeave={(e) => { e.currentTarget.style.color = "#e0e0e0"; }}
                          >
                            <span style={{ color: isExpanded ? "#00ff88" : "#444", marginRight: "4px", fontSize: "10px" }}>{isExpanded ? "▼" : "▶"}</span>
                            {t.name}
                          </span>
                          {t.description && <div style={{ color: "#5a6a7a", fontSize: "10px", marginTop: "2px", paddingLeft: "14px" }}>{t.description}</div>}
                        </div>
                        <div style={{ color: "#5a6a7a", fontSize: "11px" }}>{t.slug}</div>
                        <div><span style={{ color: "#ffcc00", fontSize: "10px", fontWeight: 700, textTransform: "uppercase", padding: "2px 6px", border: "1px solid rgba(255, 204, 0, 0.3)", borderRadius: "2px" }}>{t.category}</span></div>
                        <div><span style={{ color: t.isActive ? "#00ff88" : "#ff4444", fontSize: "11px", fontWeight: 700 }}>{t.isActive ? "ON" : "OFF"}</span></div>
                        <div style={{ color: "#5a6a7a", fontSize: "11px" }}>{t.sortOrder}</div>
                        <div style={{ display: "flex", gap: "4px" }}>
                          <button onClick={() => startEdit(t)} style={{ padding: "2px 8px", background: "transparent", border: "1px solid #00e5ff", color: "#00e5ff", fontFamily: "inherit", fontSize: "10px", cursor: "pointer" }}>EDIT</button>
                          <button onClick={() => handleToggleActive(t.id, t.isActive)} style={{ padding: "2px 8px", background: "transparent", border: `1px solid ${t.isActive ? "#ffcc00" : "#00ff88"}`, color: t.isActive ? "#ffcc00" : "#00ff88", fontFamily: "inherit", fontSize: "10px", cursor: "pointer" }}>{t.isActive ? "DISABLE" : "ENABLE"}</button>
                          <button onClick={() => handleDelete(t.id)} style={{ padding: "2px 8px", background: "transparent", border: "1px solid #ff4444", color: "#ff4444", fontFamily: "inherit", fontSize: "10px", cursor: "pointer" }}>DEL</button>
                        </div>
                      </div>

                      {/* Expanded detail */}
                      {isExpanded && (
                        <div style={{ padding: "12px 16px", backgroundColor: "rgba(13, 17, 23, 0.8)", borderBottom: "1px solid rgba(0, 255, 136, 0.15)", borderLeft: "2px solid #00ff88", marginLeft: "8px" }}>
                          <div style={{ marginBottom: "8px" }}>
                            <div style={{ fontSize: "10px", fontWeight: 700, color: "#00ff88", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "4px" }}>System Prompt</div>
                            <div style={{ padding: "8px", backgroundColor: "#0a0e14", border: "1px solid #1e2a3a", fontSize: "11px", color: "#e0e0e0", whiteSpace: "pre-wrap", maxHeight: "200px", overflowY: "auto" }}>{t.systemPrompt}</div>
                          </div>
                          {t.userPromptTemplate && (
                            <div style={{ marginBottom: "8px" }}>
                              <div style={{ fontSize: "10px", fontWeight: 700, color: "#ffcc00", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "4px" }}>User Prompt Template</div>
                              <div style={{ padding: "8px", backgroundColor: "#0a0e14", border: "1px solid #1e2a3a", fontSize: "11px", color: "#e0e0e0", whiteSpace: "pre-wrap" }}>{t.userPromptTemplate}</div>
                            </div>
                          )}
                          {t.knowledgeText && (
                            <div style={{ marginBottom: "8px" }}>
                              <div style={{ fontSize: "10px", fontWeight: 700, color: "#00e5ff", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "4px" }}>Knowledge Text</div>
                              <div style={{ padding: "8px", backgroundColor: "#0a0e14", border: "1px solid #1e2a3a", fontSize: "11px", color: "#e0e0e0", whiteSpace: "pre-wrap", maxHeight: "150px", overflowY: "auto" }}>{t.knowledgeText.substring(0, 500)}{t.knowledgeText.length > 500 ? "..." : ""}</div>
                            </div>
                          )}
                          <div style={{ fontSize: "10px", color: "#5a6a7a" }}>
                            Created by <span style={{ color: "#e0e0e0" }}>{t.creator.email}</span> on {new Date(t.createdAt).toLocaleDateString("sl-SI")}
                          </div>
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
