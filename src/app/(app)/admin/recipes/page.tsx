"use client";

import { useSession } from "next-auth/react";
import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

type Step = { id?: string; name: string; type: string; config: Record<string, unknown> };
type Recipe = {
  id: string; name: string; slug: string; description: string | null;
  status: string; inputKind: string; inputModes: string[] | null;
  defaultLang: string | null; isPreset: boolean; createdAt: string;
  steps: { id: string; stepIndex: number; name: string; type: string; config?: Record<string, unknown> }[];
  _count: { executions: number };
};

const STEP_TYPES = ["stt", "llm", "tts", "image", "output_format"];
const INPUT_KINDS = ["text", "audio", "image", "none"];
const INPUT_MODES = ["file", "url", "text"];

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
  const [formInputKind, setFormInputKind] = useState("text");
  const [formInputModes, setFormInputModes] = useState<string[]>([]);
  const [formDefaultLang, setFormDefaultLang] = useState("");
  const [formSteps, setFormSteps] = useState<Step[]>([]);
  const [formError, setFormError] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedStepIdx, setExpandedStepIdx] = useState<number | null>(null);

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
    setFormName(""); setFormDesc(""); setFormStatus("draft"); setFormInputKind("text");
    setFormInputModes([]); setFormDefaultLang(""); setFormSteps([]);
    setFormError(""); setEditingId(null); setExpandedStepIdx(null);
  }

  function addStep() {
    setFormSteps([...formSteps, { name: "", type: "llm", config: {} }]);
    setExpandedStepIdx(formSteps.length);
  }

  function removeStep(i: number) {
    setFormSteps(formSteps.filter((_, idx) => idx !== i));
    if (expandedStepIdx === i) setExpandedStepIdx(null);
  }

  function moveStep(i: number, direction: "up" | "down") {
    const newSteps = [...formSteps];
    const j = direction === "up" ? i - 1 : i + 1;
    if (j < 0 || j >= newSteps.length) return;
    [newSteps[i], newSteps[j]] = [newSteps[j], newSteps[i]];
    setFormSteps(newSteps);
    setExpandedStepIdx(j);
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

  function toggleInputMode(mode: string) {
    setFormInputModes((prev) =>
      prev.includes(mode) ? prev.filter((m) => m !== mode) : [...prev, mode]
    );
  }

  async function handleSubmit() {
    setFormError("");
    if (!formName.trim()) { setFormError("Name is required"); return; }
    if (formSteps.length === 0) { setFormError("Add at least one step"); return; }

    const recipeData = {
      name: formName,
      description: formDesc,
      status: formStatus,
      inputKind: formInputKind,
      inputModes: formInputModes.length > 0 ? formInputModes : null,
      defaultLang: formDefaultLang || null,
    };

    try {
      if (editingId) {
        await fetch(`/api/recipes/${editingId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(recipeData),
        });
        await fetch(`/api/recipes/${editingId}/steps`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ steps: formSteps }),
        });
      } else {
        const resp = await fetch("/api/recipes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(recipeData),
        });
        const data = await resp.json();
        if (!resp.ok) { setFormError(data.error); return; }
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
    setFormInputKind(recipe.inputKind || "text");
    setFormInputModes(recipe.inputModes || []);
    setFormDefaultLang(recipe.defaultLang || "");
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

  if (!session) return <div style={{ color: "var(--gray)" }}><span style={{ color: "var(--red)" }}>[ERROR]</span> Authentication required.</div>;
  if (!isAdmin) return <div style={{ color: "var(--red)" }}>[ACCESS DENIED] Admin privileges required.</div>;

  const st = {
    input: { width: "100%", padding: "6px 10px", backgroundColor: "var(--bg-input)", border: "1px solid var(--border)", color: "var(--white)", fontFamily: "inherit", fontSize: "12px" } as const,
    textarea: { width: "100%", padding: "6px 10px", backgroundColor: "var(--bg-input)", border: "1px solid var(--border)", color: "var(--white)", fontFamily: "inherit", fontSize: "11px", resize: "vertical" as const, minHeight: "60px" } as const,
    label: { fontSize: "10px", fontWeight: 700 as const, color: "var(--green)", textTransform: "uppercase" as const, letterSpacing: "0.1em", marginBottom: "3px", display: "block" } as const,
    labelDim: { fontSize: "10px", fontWeight: 700 as const, color: "var(--gray)", textTransform: "uppercase" as const, letterSpacing: "0.1em", marginBottom: "3px", display: "block" } as const,
  };

  return (
    <div>
      <div style={{ marginBottom: "24px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
          <Link href="/admin" className="no-underline" style={{ color: "var(--red)", fontSize: "18px", fontWeight: 700 }}>[ADMIN]</Link>
          <span style={{ color: "#333" }}>/</span>
          <span style={{ color: "#ff8800", fontSize: "18px", fontWeight: 700 }}>RECIPES</span>
        </div>
        <div style={{ color: "var(--gray)", fontSize: "13px" }}>$ admin --recipes --builder</div>
      </div>

      <div style={{ marginBottom: "20px", display: "flex", gap: "12px", alignItems: "center" }}>
        <button onClick={() => { if (showForm && !editingId) setShowForm(false); else { resetForm(); setShowForm(true); } }} style={{ padding: "8px 20px", background: "transparent", border: "1px solid var(--green)", color: "var(--green)", fontFamily: "inherit", fontSize: "12px", fontWeight: 700, cursor: "pointer", textTransform: "uppercase" }}>{showForm && !editingId ? "[  CANCEL  ]" : "[  + NEW RECIPE  ]"}</button>
        <span style={{ color: "var(--gray)", fontSize: "12px" }}>{recipes.length} recipes</span>
      </div>

      {showForm && (
        <div style={{ padding: "16px", border: `1px solid ${editingId ? "var(--cyan)" : "var(--green)"}`, backgroundColor: `rgba(${editingId ? "0, 229, 255" : "0, 255, 136"}, 0.03)`, marginBottom: "20px" }}>
          <div style={{ fontSize: "11px", fontWeight: 700, color: editingId ? "var(--cyan)" : "var(--green)", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "12px" }}>{editingId ? "EDIT RECIPE" : "NEW RECIPE"}</div>

          {/* Basic info */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr 100px", gap: "12px", marginBottom: "12px" }}>
            <div><label style={st.label}>--name *</label><input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="Pipeline Name" style={st.input} /></div>
            <div><label style={st.label}>--description</label><input value={formDesc} onChange={(e) => setFormDesc(e.target.value)} placeholder="What this pipeline does" style={st.input} /></div>
            <div><label style={st.label}>--status</label><select value={formStatus} onChange={(e) => setFormStatus(e.target.value)} style={st.input}><option value="draft">draft</option><option value="active">active</option><option value="archived">archived</option></select></div>
          </div>

          {/* Input configuration */}
          <div style={{ padding: "10px 12px", border: "1px dashed rgba(0, 229, 255, 0.3)", backgroundColor: "rgba(0, 229, 255, 0.02)", marginBottom: "12px" }}>
            <div style={{ fontSize: "10px", fontWeight: 700, color: "var(--cyan)", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "8px" }}>INPUT CONFIG</div>
            <div style={{ display: "flex", gap: "16px", alignItems: "flex-start", flexWrap: "wrap" }}>
              <div>
                <label style={st.labelDim}>Input Kind</label>
                <select value={formInputKind} onChange={(e) => setFormInputKind(e.target.value)} style={{ ...st.input, width: "120px" }}>
                  {INPUT_KINDS.map((k) => <option key={k} value={k}>{k.toUpperCase()}</option>)}
                </select>
              </div>
              <div>
                <label style={st.labelDim}>Default Lang</label>
                <select value={formDefaultLang} onChange={(e) => setFormDefaultLang(e.target.value)} style={{ ...st.input, width: "80px" }}>
                  <option value="">—</option>
                  <option value="sl">SL</option>
                  <option value="en">EN</option>
                </select>
              </div>
              <div>
                <label style={st.labelDim}>Input Modes</label>
                <div style={{ display: "flex", gap: "4px" }}>
                  {INPUT_MODES.map((m) => (
                    <button
                      key={m}
                      onClick={() => toggleInputMode(m)}
                      style={{
                        padding: "3px 10px", background: formInputModes.includes(m) ? "rgba(0, 229, 255, 0.1)" : "transparent",
                        border: `1px solid ${formInputModes.includes(m) ? "var(--cyan)" : "var(--border)"}`,
                        color: formInputModes.includes(m) ? "var(--cyan)" : "var(--gray)",
                        fontFamily: "inherit", fontSize: "10px", fontWeight: 700, cursor: "pointer",
                      }}
                    >
                      {m.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Steps */}
          <div style={{ marginBottom: "12px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
              <label style={st.label}>PIPELINE STEPS</label>
              <button onClick={addStep} style={{ padding: "4px 12px", background: "transparent", border: "1px solid var(--yellow)", color: "var(--yellow)", fontFamily: "inherit", fontSize: "10px", cursor: "pointer", fontWeight: 700 }}>+ ADD STEP</button>
            </div>
            {formSteps.map((step, i) => {
              const isStepExpanded = expandedStepIdx === i;
              return (
                <div key={i} style={{ marginBottom: "4px", border: `1px solid ${isStepExpanded ? "rgba(255, 136, 0, 0.4)" : "var(--border)"}`, backgroundColor: "rgba(13, 17, 23, 0.5)" }}>
                  {/* Step header row */}
                  <div style={{ display: "flex", gap: "8px", padding: "6px 8px", alignItems: "center" }}>
                    <span style={{ color: "var(--yellow)", fontWeight: 700, fontSize: "11px", minWidth: "24px" }}>#{i + 1}</span>
                    <select value={step.type} onChange={(e) => updateStep(i, "type", e.target.value)} style={{ ...st.input, width: "110px", padding: "4px 6px" }}>
                      {STEP_TYPES.map((t) => <option key={t} value={t}>{t.toUpperCase()}</option>)}
                    </select>
                    <input value={step.name} onChange={(e) => updateStep(i, "name", e.target.value)} placeholder="Step name" style={{ ...st.input, flex: 1, padding: "4px 6px" }} />
                    <button onClick={() => moveStep(i, "up")} disabled={i === 0} style={{ background: "transparent", border: "none", color: i === 0 ? "#333" : "var(--gray)", cursor: i === 0 ? "default" : "pointer", fontFamily: "inherit", fontSize: "12px", padding: "2px 4px" }}>&uarr;</button>
                    <button onClick={() => moveStep(i, "down")} disabled={i === formSteps.length - 1} style={{ background: "transparent", border: "none", color: i === formSteps.length - 1 ? "#333" : "var(--gray)", cursor: i === formSteps.length - 1 ? "default" : "pointer", fontFamily: "inherit", fontSize: "12px", padding: "2px 4px" }}>&darr;</button>
                    <button onClick={() => setExpandedStepIdx(isStepExpanded ? null : i)} style={{ background: "transparent", border: "none", color: isStepExpanded ? "#ff8800" : "var(--gray)", cursor: "pointer", fontFamily: "inherit", fontSize: "10px", padding: "2px 6px" }}>{isStepExpanded ? "CLOSE" : "CONFIG"}</button>
                    <button onClick={() => removeStep(i)} style={{ background: "transparent", border: "none", color: "var(--red)", cursor: "pointer", fontFamily: "inherit", fontSize: "14px", padding: "2px 4px" }}>x</button>
                  </div>

                  {/* Step config panel (expanded) */}
                  {isStepExpanded && (
                    <div style={{ padding: "8px 12px 10px", borderTop: "1px solid rgba(30, 42, 58, 0.5)" }}>
                      {step.type === "llm" && (
                        <div style={{ display: "grid", gap: "8px" }}>
                          <div style={{ display: "flex", gap: "8px" }}>
                            <div style={{ flex: "0 0 180px" }}>
                              <label style={st.labelDim}>Model ID</label>
                              <input value={(step.config.modelId as string) || ""} onChange={(e) => updateStep(i, "modelId", e.target.value)} placeholder="gpt-5-mini" style={st.input} />
                            </div>
                            <div style={{ flex: 1 }}>
                              <label style={st.labelDim}>User Prompt Template</label>
                              <input value={(step.config.userPromptTemplate as string) || ""} onChange={(e) => updateStep(i, "userPromptTemplate", e.target.value)} placeholder="{{input}}" style={st.input} />
                            </div>
                          </div>
                          <div>
                            <label style={st.labelDim}>System Prompt</label>
                            <textarea value={(step.config.systemPrompt as string) || ""} onChange={(e) => updateStep(i, "systemPrompt", e.target.value)} placeholder="System instructions..." style={st.textarea} />
                          </div>
                        </div>
                      )}
                      {step.type === "stt" && (
                        <div style={{ display: "flex", gap: "8px" }}>
                          <div>
                            <label style={st.labelDim}>Provider</label>
                            <input value={(step.config.provider as string) || "soniox"} onChange={(e) => updateStep(i, "provider", e.target.value)} style={{ ...st.input, width: "120px" }} />
                          </div>
                          <div>
                            <label style={st.labelDim}>Language</label>
                            <select value={(step.config.language as string) || "sl"} onChange={(e) => updateStep(i, "language", e.target.value)} style={{ ...st.input, width: "80px" }}>
                              <option value="sl">SL</option>
                              <option value="en">EN</option>
                            </select>
                          </div>
                          <div style={{ flex: 1 }}>
                            <label style={st.labelDim}>Description</label>
                            <input value={(step.config.description as string) || ""} onChange={(e) => updateStep(i, "description", e.target.value)} placeholder="Step description" style={st.input} />
                          </div>
                        </div>
                      )}
                      {step.type === "tts" && (
                        <div style={{ display: "flex", gap: "8px" }}>
                          <div>
                            <label style={st.labelDim}>Voice ID</label>
                            <input value={(step.config.voiceId as string) || ""} onChange={(e) => updateStep(i, "voiceId", e.target.value)} placeholder="voice_id" style={{ ...st.input, width: "160px" }} />
                          </div>
                        </div>
                      )}
                      {step.type === "output_format" && (
                        <div>
                          <label style={st.labelDim}>Formats (comma-separated)</label>
                          <input value={Array.isArray(step.config.formats) ? (step.config.formats as string[]).join(", ") : (step.config.formats as string) || ""} onChange={(e) => {
                            const newSteps = [...formSteps];
                            newSteps[i].config = { ...newSteps[i].config, formats: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) };
                            setFormSteps(newSteps);
                          }} placeholder="markdown, html, json, drupal_json" style={st.input} />
                        </div>
                      )}
                      {step.type === "image" && (
                        <div>
                          <label style={st.labelDim}>Prompt Template</label>
                          <textarea value={(step.config.promptTemplate as string) || ""} onChange={(e) => updateStep(i, "promptTemplate", e.target.value)} placeholder="Generate an image for..." style={st.textarea} />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            {formSteps.length === 0 && <div style={{ color: "#333", fontSize: "11px", padding: "8px" }}>No steps. Add steps to build the pipeline.</div>}
          </div>

          {formError && <div style={{ color: "var(--red)", fontSize: "12px", marginBottom: "8px" }}>[ERROR] {formError}</div>}
          <div style={{ display: "flex", gap: "8px" }}>
            <button onClick={handleSubmit} style={{ padding: "6px 16px", background: "transparent", border: `1px solid ${editingId ? "var(--cyan)" : "var(--green)"}`, color: editingId ? "var(--cyan)" : "var(--green)", fontFamily: "inherit", fontSize: "12px", fontWeight: 700, cursor: "pointer", textTransform: "uppercase" }}>{editingId ? "[  SAVE  ]" : "[  CREATE  ]"}</button>
            {editingId && <button onClick={() => { resetForm(); setShowForm(false); }} style={{ padding: "6px 16px", background: "transparent", border: "1px solid var(--gray)", color: "var(--gray)", fontFamily: "inherit", fontSize: "12px", fontWeight: 700, cursor: "pointer" }}>[  CANCEL  ]</button>}
          </div>
        </div>
      )}

      {error && <div style={{ padding: "12px", backgroundColor: "rgba(255, 68, 68, 0.08)", border: "1px solid var(--red)", color: "var(--red)", fontSize: "13px", marginBottom: "16px" }}>[ERROR] {error}</div>}

      {loading ? <div style={{ color: "var(--green)" }}>Loading...</div> : (
        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          {recipes.map((r) => {
            const isExpanded = expandedId === r.id;
            const statusColor = r.status === "active" ? "var(--green)" : r.status === "draft" ? "var(--yellow)" : "var(--gray)";
            return (
              <div key={r.id} style={{ border: `1px solid ${isExpanded ? "rgba(255, 136, 0, 0.3)" : "var(--border)"}` }}>
                <div onClick={() => setExpandedId(isExpanded ? null : r.id)} style={{ padding: "10px 16px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                    <span style={{ color: isExpanded ? "#ff8800" : "#444", fontSize: "10px" }}>{isExpanded ? "\u25BC" : "\u25B6"}</span>
                    <span style={{ color: "var(--white)", fontWeight: 600 }}>{r.name}</span>
                    {r.isPreset && <span style={{ padding: "1px 6px", backgroundColor: "rgba(255, 136, 0, 0.1)", border: "1px solid rgba(255, 136, 0, 0.3)", color: "#ff8800", fontSize: "8px", fontWeight: 700 }}>PRESET</span>}
                    {r.inputKind === "audio" && <span style={{ padding: "1px 6px", backgroundColor: "rgba(0, 229, 255, 0.1)", border: "1px solid rgba(0, 229, 255, 0.3)", color: "var(--cyan)", fontSize: "8px", fontWeight: 700 }}>AUDIO</span>}
                    {r.description && <span style={{ color: "var(--gray)", fontSize: "11px" }}>&mdash; {r.description}</span>}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                    <span style={{ color: statusColor, fontSize: "10px", fontWeight: 700, textTransform: "uppercase" }}>{r.status}</span>
                    <span style={{ color: "var(--gray)", fontSize: "10px" }}>{r.steps.length} steps | {r._count.executions} runs</span>
                  </div>
                </div>
                {isExpanded && (
                  <div style={{ padding: "0 16px 12px", borderTop: "1px solid rgba(30, 42, 58, 0.5)" }}>
                    {/* Recipe details */}
                    <div style={{ display: "flex", gap: "12px", padding: "6px 0", fontSize: "10px", color: "var(--gray)" }}>
                      <span>inputKind: <span style={{ color: "var(--cyan)" }}>{r.inputKind}</span></span>
                      {r.inputModes && <span>modes: <span style={{ color: "var(--cyan)" }}>{r.inputModes.join(", ")}</span></span>}
                      {r.defaultLang && <span>lang: <span style={{ color: "var(--yellow)" }}>{r.defaultLang}</span></span>}
                    </div>
                    <div style={{ margin: "4px 0 8px" }}>
                      {r.steps.map((s) => (
                        <div key={s.id} style={{ display: "flex", gap: "8px", padding: "4px 8px", fontSize: "11px", borderLeft: "2px solid #ff8800", marginBottom: "2px", backgroundColor: "rgba(13, 17, 23, 0.5)" }}>
                          <span style={{ color: "var(--yellow)", fontWeight: 700, width: "24px" }}>#{s.stepIndex + 1}</span>
                          <span style={{ color: "#ff8800", fontWeight: 700, textTransform: "uppercase", width: "80px" }}>{s.type}</span>
                          <span style={{ color: "var(--white)" }}>{s.name}</span>
                        </div>
                      ))}
                    </div>
                    <div style={{ display: "flex", gap: "8px" }}>
                      <button onClick={() => startEdit(r)} style={{ padding: "4px 12px", background: "transparent", border: "1px solid var(--cyan)", color: "var(--cyan)", fontFamily: "inherit", fontSize: "10px", cursor: "pointer", fontWeight: 700 }}>EDIT</button>
                      <button onClick={() => handleDelete(r.id)} style={{ padding: "4px 12px", background: "transparent", border: "1px solid var(--red)", color: "var(--red)", fontFamily: "inherit", fontSize: "10px", cursor: "pointer", fontWeight: 700 }}>DELETE</button>
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
