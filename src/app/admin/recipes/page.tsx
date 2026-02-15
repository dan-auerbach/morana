"use client";

import { useSession } from "next-auth/react";
import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

type Step = { id?: string; name: string; type: string; config: Record<string, unknown> };
type Recipe = {
  id: string; name: string; slug: string; description: string | null;
  status: string; createdAt: string;
  steps: { id: string; stepIndex: number; name: string; type: string }[];
  _count: { executions: number };
};

const STEP_TYPES = ["stt", "llm", "tts", "image", "output_format"];

export default function AdminRecipesPage() {
  const { data: session } = useSession();
  const isAdmin = (session?.user as Record<string, unknown>)?.role === "admin";

  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Form
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formName, setFormName] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [formStatus, setFormStatus] = useState("draft");
  const [formSteps, setFormSteps] = useState<Step[]>([]);
  const [formError, setFormError] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const loadRecipes = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await fetch("/api/recipes");
      const data = await resp.json();
      setRecipes(data.recipes || []);
    } catch { setError("Failed to load"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (session && isAdmin) loadRecipes();
  }, [session, isAdmin, loadRecipes]);

  function resetForm() {
    setFormName(""); setFormDesc(""); setFormStatus("draft"); setFormSteps([]); setFormError(""); setEditingId(null);
  }

  function addStep() {
    setFormSteps([...formSteps, { name: "", type: "llm", config: {} }]);
  }

  function removeStep(i: number) {
    setFormSteps(formSteps.filter((_, idx) => idx !== i));
  }

  function updateStep(i: number, field: string, value: string) {
    const newSteps = [...formSteps];
    if (field === "name" || field === "type") {
      (newSteps[i] as Record<string, unknown>)[field] = value;
    } else {
      newSteps[i].config = { ...newSteps[i].config, [field]: value };
    }
    setFormSteps(newSteps);
  }

  async function handleSubmit() {
    setFormError("");
    if (!formName.trim()) { setFormError("Name is required"); return; }
    if (formSteps.length === 0) { setFormError("Add at least one step"); return; }

    try {
      if (editingId) {
        // Update recipe
        await fetch(`/api/recipes/${editingId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: formName, description: formDesc, status: formStatus }),
        });
        // Update steps
        await fetch(`/api/recipes/${editingId}/steps`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ steps: formSteps }),
        });
      } else {
        // Create recipe
        const resp = await fetch("/api/recipes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: formName, description: formDesc, status: formStatus }),
        });
        const data = await resp.json();
        if (!resp.ok) { setFormError(data.error); return; }
        // Add steps
        if (formSteps.length > 0) {
          await fetch(`/api/recipes/${data.recipe.id}/steps`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ steps: formSteps }),
          });
        }
      }
      resetForm(); setShowForm(false); loadRecipes();
    } catch { setFormError("Failed"); }
  }

  async function startEdit(recipe: Recipe) {
    setEditingId(recipe.id);
    setFormName(recipe.name);
    setFormDesc(recipe.description || "");
    setFormStatus(recipe.status);
    // Load full recipe with step configs
    const resp = await fetch(`/api/recipes/${recipe.id}`);
    const data = await resp.json();
    if (data.recipe?.steps) {
      setFormSteps(data.recipe.steps.map((s: { name: string; type: string; config: Record<string, unknown> }) => ({
        name: s.name, type: s.type, config: s.config || {},
      })));
    }
    setShowForm(true);
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete recipe?")) return;
    await fetch(`/api/recipes/${id}`, { method: "DELETE" });
    loadRecipes();
  }

  if (!session) return <div style={{ color: "#5a6a7a" }}><span style={{ color: "#ff4444" }}>[ERROR]</span> Authentication required.</div>;
  if (!isAdmin) return <div style={{ color: "#ff4444" }}>[ACCESS DENIED] Admin privileges required.</div>;

  const s = {
    input: { width: "100%", padding: "6px 10px", backgroundColor: "#111820", border: "1px solid #1e2a3a", color: "#e0e0e0", fontFamily: "inherit", fontSize: "12px" } as const,
    label: { fontSize: "11px", fontWeight: 700 as const, color: "#00ff88", textTransform: "uppercase" as const, letterSpacing: "0.1em", marginBottom: "4px", display: "block" } as const,
  };

  return (
    <div>
      <div style={{ marginBottom: "24px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
          <Link href="/admin" className="no-underline" style={{ color: "#ff4444", fontSize: "18px", fontWeight: 700 }}>[ADMIN]</Link>
          <span style={{ color: "#333" }}>/</span>
          <span style={{ color: "#ff8800", fontSize: "18px", fontWeight: 700 }}>RECIPES</span>
        </div>
        <div style={{ color: "#5a6a7a", fontSize: "13px" }}>$ admin --recipes --builder</div>
      </div>

      <div style={{ marginBottom: "20px", display: "flex", gap: "12px", alignItems: "center" }}>
        <button onClick={() => { if (showForm && !editingId) setShowForm(false); else { resetForm(); setShowForm(true); } }} style={{ padding: "8px 20px", background: "transparent", border: "1px solid #00ff88", color: "#00ff88", fontFamily: "inherit", fontSize: "12px", fontWeight: 700, cursor: "pointer", textTransform: "uppercase" }}>{showForm && !editingId ? "[  CANCEL  ]" : "[  + NEW RECIPE  ]"}</button>
        <span style={{ color: "#5a6a7a", fontSize: "12px" }}>{recipes.length} recipes</span>
      </div>

      {showForm && (
        <div style={{ padding: "16px", border: `1px solid ${editingId ? "#00e5ff" : "#00ff88"}`, backgroundColor: `rgba(${editingId ? "0, 229, 255" : "0, 255, 136"}, 0.03)`, marginBottom: "20px" }}>
          <div style={{ fontSize: "11px", fontWeight: 700, color: editingId ? "#00e5ff" : "#00ff88", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "12px" }}>{editingId ? "EDIT RECIPE" : "NEW RECIPE"}</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr 120px", gap: "12px", marginBottom: "12px" }}>
            <div><label style={s.label}>--name *</label><input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="Novinar Pipeline" style={s.input} /></div>
            <div><label style={s.label}>--description</label><input value={formDesc} onChange={(e) => setFormDesc(e.target.value)} placeholder="Multi-step pipeline" style={s.input} /></div>
            <div><label style={s.label}>--status</label><select value={formStatus} onChange={(e) => setFormStatus(e.target.value)} style={s.input}><option value="draft">draft</option><option value="active">active</option><option value="archived">archived</option></select></div>
          </div>

          {/* Steps */}
          <div style={{ marginBottom: "12px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
              <label style={s.label}>PIPELINE STEPS</label>
              <button onClick={addStep} style={{ padding: "4px 12px", background: "transparent", border: "1px solid #ffcc00", color: "#ffcc00", fontFamily: "inherit", fontSize: "10px", cursor: "pointer", fontWeight: 700 }}>+ ADD STEP</button>
            </div>
            {formSteps.map((step, i) => (
              <div key={i} style={{ display: "flex", gap: "8px", marginBottom: "6px", padding: "8px", backgroundColor: "rgba(13, 17, 23, 0.5)", border: "1px solid #1e2a3a", alignItems: "flex-start" }}>
                <span style={{ color: "#ffcc00", fontWeight: 700, fontSize: "11px", minWidth: "24px", paddingTop: "6px" }}>#{i + 1}</span>
                <div style={{ flex: "0 0 100px" }}>
                  <select value={step.type} onChange={(e) => updateStep(i, "type", e.target.value)} style={{ ...s.input, width: "100px" }}>
                    {STEP_TYPES.map((t) => <option key={t} value={t}>{t.toUpperCase()}</option>)}
                  </select>
                </div>
                <input value={step.name} onChange={(e) => updateStep(i, "name", e.target.value)} placeholder="Step name" style={{ ...s.input, flex: 1 }} />
                {step.type === "llm" && (
                  <>
                    <input value={(step.config.modelId as string) || ""} onChange={(e) => updateStep(i, "modelId", e.target.value)} placeholder="model ID" style={{ ...s.input, width: "140px" }} />
                    <input value={(step.config.systemPrompt as string) || ""} onChange={(e) => updateStep(i, "systemPrompt", e.target.value)} placeholder="system prompt" style={{ ...s.input, flex: 2 }} />
                  </>
                )}
                <button onClick={() => removeStep(i)} style={{ background: "transparent", border: "none", color: "#ff4444", cursor: "pointer", fontFamily: "inherit", fontSize: "14px", padding: "4px" }}>x</button>
              </div>
            ))}
            {formSteps.length === 0 && <div style={{ color: "#333", fontSize: "11px", padding: "8px" }}>No steps. Add steps to build the pipeline.</div>}
          </div>

          {formError && <div style={{ color: "#ff4444", fontSize: "12px", marginBottom: "8px" }}>[ERROR] {formError}</div>}
          <div style={{ display: "flex", gap: "8px" }}>
            <button onClick={handleSubmit} style={{ padding: "6px 16px", background: "transparent", border: `1px solid ${editingId ? "#00e5ff" : "#00ff88"}`, color: editingId ? "#00e5ff" : "#00ff88", fontFamily: "inherit", fontSize: "12px", fontWeight: 700, cursor: "pointer", textTransform: "uppercase" }}>{editingId ? "[  SAVE  ]" : "[  CREATE  ]"}</button>
            {editingId && <button onClick={() => { resetForm(); setShowForm(false); }} style={{ padding: "6px 16px", background: "transparent", border: "1px solid #5a6a7a", color: "#5a6a7a", fontFamily: "inherit", fontSize: "12px", fontWeight: 700, cursor: "pointer" }}>[  CANCEL  ]</button>}
          </div>
        </div>
      )}

      {error && <div style={{ padding: "12px", backgroundColor: "rgba(255, 68, 68, 0.08)", border: "1px solid #ff4444", color: "#ff4444", fontSize: "13px", marginBottom: "16px" }}>[ERROR] {error}</div>}

      {loading ? <div style={{ color: "#00ff88" }}>Loading...</div> : (
        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          {recipes.map((r) => {
            const isExpanded = expandedId === r.id;
            const statusColor = r.status === "active" ? "#00ff88" : r.status === "draft" ? "#ffcc00" : "#5a6a7a";
            return (
              <div key={r.id} style={{ border: `1px solid ${isExpanded ? "rgba(255, 136, 0, 0.3)" : "#1e2a3a"}` }}>
                <div onClick={() => setExpandedId(isExpanded ? null : r.id)} style={{ padding: "10px 16px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                    <span style={{ color: isExpanded ? "#ff8800" : "#444", fontSize: "10px" }}>{isExpanded ? "▼" : "▶"}</span>
                    <span style={{ color: "#e0e0e0", fontWeight: 600 }}>{r.name}</span>
                    {r.description && <span style={{ color: "#5a6a7a", fontSize: "11px" }}>— {r.description}</span>}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                    <span style={{ color: statusColor, fontSize: "10px", fontWeight: 700, textTransform: "uppercase" }}>{r.status}</span>
                    <span style={{ color: "#5a6a7a", fontSize: "10px" }}>{r.steps.length} steps | {r._count.executions} runs</span>
                  </div>
                </div>
                {isExpanded && (
                  <div style={{ padding: "0 16px 12px", borderTop: "1px solid rgba(30, 42, 58, 0.5)" }}>
                    <div style={{ margin: "8px 0" }}>
                      {r.steps.map((s) => (
                        <div key={s.id} style={{ display: "flex", gap: "8px", padding: "4px 8px", fontSize: "11px", borderLeft: "2px solid #ff8800", marginBottom: "2px", backgroundColor: "rgba(13, 17, 23, 0.5)" }}>
                          <span style={{ color: "#ffcc00", fontWeight: 700, width: "24px" }}>#{s.stepIndex + 1}</span>
                          <span style={{ color: "#ff8800", fontWeight: 700, textTransform: "uppercase", width: "60px" }}>{s.type}</span>
                          <span style={{ color: "#e0e0e0" }}>{s.name}</span>
                        </div>
                      ))}
                    </div>
                    <div style={{ display: "flex", gap: "8px" }}>
                      <button onClick={() => startEdit(r)} style={{ padding: "4px 12px", background: "transparent", border: "1px solid #00e5ff", color: "#00e5ff", fontFamily: "inherit", fontSize: "10px", cursor: "pointer", fontWeight: 700 }}>EDIT</button>
                      <button onClick={() => handleDelete(r.id)} style={{ padding: "4px 12px", background: "transparent", border: "1px solid #ff4444", color: "#ff4444", fontFamily: "inherit", fontSize: "10px", cursor: "pointer", fontWeight: 700 }}>DELETE</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {recipes.length === 0 && <div style={{ color: "#333", fontSize: "12px", textAlign: "center", padding: "20px" }}>No recipes yet.</div>}
        </div>
      )}
    </div>
  );
}
