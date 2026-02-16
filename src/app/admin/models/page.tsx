"use client";

import { useSession } from "next-auth/react";
import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

type AIModel = {
  id: string;
  modelId: string;
  label: string;
  provider: string;
  isEnabled: boolean;
  isDefault: boolean;
  sortOrder: number;
  pricingInput: number;
  pricingOutput: number;
  pricingUnit: string;
  createdAt: string;
};

const PROVIDERS = ["anthropic", "openai", "gemini"];
const PRICING_UNITS = ["1M_tokens", "1k_chars", "per_minute"];

function formatPricingUnit(unit: string): string {
  switch (unit) {
    case "1M_tokens": return "1M tok";
    case "1k_chars": return "1k chr";
    case "per_minute": return "min";
    default: return unit;
  }
}

export default function AdminModelsPage() {
  const { data: session } = useSession();
  const isAdmin = (session?.user as Record<string, unknown>)?.role === "admin";

  const [models, setModels] = useState<AIModel[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Create form
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    modelId: "",
    label: "",
    provider: "openai",
    pricingInput: "",
    pricingOutput: "",
    pricingUnit: "1M_tokens",
    sortOrder: "0",
  });
  const [formError, setFormError] = useState("");

  // Inline edit
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editField, setEditField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  // Full row edit
  const [rowEditId, setRowEditId] = useState<string | null>(null);
  const [rowEditData, setRowEditData] = useState({
    modelId: "",
    label: "",
    provider: "",
    pricingInput: "",
    pricingOutput: "",
    pricingUnit: "",
    sortOrder: "",
  });
  const [rowEditError, setRowEditError] = useState("");

  const loadModels = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const resp = await fetch("/api/admin/models");
      const data = await resp.json();
      if (data.error) {
        setError(data.error);
        return;
      }
      setModels(data.models || []);
    } catch {
      setError("Failed to load models");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (session && isAdmin) loadModels();
  }, [session, isAdmin, loadModels]);

  function resetForm() {
    setFormData({
      modelId: "",
      label: "",
      provider: "openai",
      pricingInput: "",
      pricingOutput: "",
      pricingUnit: "1M_tokens",
      sortOrder: "0",
    });
    setFormError("");
  }

  async function handleCreate() {
    setFormError("");
    if (!formData.modelId.trim()) {
      setFormError("modelId is required");
      return;
    }
    if (!formData.label.trim()) {
      setFormError("label is required");
      return;
    }

    try {
      const resp = await fetch("/api/admin/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          modelId: formData.modelId.trim(),
          label: formData.label.trim(),
          provider: formData.provider,
          pricingInput: formData.pricingInput ? parseFloat(formData.pricingInput) : 0,
          pricingOutput: formData.pricingOutput ? parseFloat(formData.pricingOutput) : 0,
          pricingUnit: formData.pricingUnit,
          sortOrder: formData.sortOrder ? parseInt(formData.sortOrder) : 0,
          isEnabled: true,
          isDefault: false,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setFormError(data.error || "Failed to create model");
        return;
      }
      resetForm();
      setShowForm(false);
      loadModels();
    } catch {
      setFormError("Request failed");
    }
  }

  async function handleToggleEnabled(model: AIModel) {
    try {
      await fetch(`/api/admin/models/${model.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isEnabled: !model.isEnabled }),
      });
      loadModels();
    } catch { /* ignore */ }
  }

  async function handleToggleDefault(model: AIModel) {
    try {
      await fetch(`/api/admin/models/${model.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isDefault: !model.isDefault }),
      });
      loadModels();
    } catch { /* ignore */ }
  }

  // Inline pricing edit: start editing
  function startInlineEdit(modelId: string, field: string, currentValue: number) {
    setEditingId(modelId);
    setEditField(field);
    setEditValue(String(currentValue));
  }

  // Inline pricing edit: save on blur or Enter
  async function saveInlineEdit(modelId: string) {
    if (!editField) return;
    try {
      await fetch(`/api/admin/models/${modelId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [editField]: parseFloat(editValue) || 0 }),
      });
      setEditingId(null);
      setEditField(null);
      setEditValue("");
      loadModels();
    } catch { /* ignore */ }
  }

  function cancelInlineEdit() {
    setEditingId(null);
    setEditField(null);
    setEditValue("");
  }

  // Full row edit
  function startRowEdit(model: AIModel) {
    setRowEditId(model.id);
    setRowEditData({
      modelId: model.modelId,
      label: model.label,
      provider: model.provider,
      pricingInput: String(model.pricingInput),
      pricingOutput: String(model.pricingOutput),
      pricingUnit: model.pricingUnit,
      sortOrder: String(model.sortOrder),
    });
    setRowEditError("");
  }

  async function handleRowEditSave() {
    if (!rowEditId) return;
    setRowEditError("");
    if (!rowEditData.modelId.trim()) {
      setRowEditError("modelId is required");
      return;
    }
    if (!rowEditData.label.trim()) {
      setRowEditError("label is required");
      return;
    }

    try {
      const resp = await fetch(`/api/admin/models/${rowEditId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          modelId: rowEditData.modelId.trim(),
          label: rowEditData.label.trim(),
          provider: rowEditData.provider,
          pricingInput: rowEditData.pricingInput ? parseFloat(rowEditData.pricingInput) : 0,
          pricingOutput: rowEditData.pricingOutput ? parseFloat(rowEditData.pricingOutput) : 0,
          pricingUnit: rowEditData.pricingUnit,
          sortOrder: rowEditData.sortOrder ? parseInt(rowEditData.sortOrder) : 0,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setRowEditError(data.error || "Failed to update");
        return;
      }
      setRowEditId(null);
      loadModels();
    } catch {
      setRowEditError("Request failed");
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this model?")) return;
    try {
      await fetch(`/api/admin/models/${id}`, { method: "DELETE" });
      loadModels();
    } catch { /* ignore */ }
  }

  if (!session) {
    return (
      <div style={{ color: "#5a6a7a" }}>
        <span style={{ color: "#ff4444" }}>[ERROR]</span> Authentication required.
      </div>
    );
  }
  if (!isAdmin) {
    return (
      <div style={{ color: "#ff4444" }}>
        <span style={{ fontWeight: 700 }}>[ACCESS DENIED]</span> Admin privileges required.
      </div>
    );
  }

  const s = {
    label: {
      fontSize: "11px",
      fontWeight: 700 as const,
      color: "#00ff88",
      textTransform: "uppercase" as const,
      letterSpacing: "0.1em",
      marginBottom: "4px",
      display: "block",
    },
    input: {
      width: "100%",
      padding: "6px 10px",
      backgroundColor: "#111820",
      border: "1px solid #1e2a3a",
      color: "#e0e0e0",
      fontFamily: "inherit",
      fontSize: "12px",
    },
  };

  return (
    <div>
      {/* Header / Breadcrumb */}
      <div style={{ marginBottom: "24px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
          <Link href="/admin" className="no-underline" style={{ color: "#ff4444", fontSize: "18px", fontWeight: 700 }}>
            [ADMIN]
          </Link>
          <span style={{ color: "#333" }}>/</span>
          <span style={{ color: "#ff8800", fontSize: "18px", fontWeight: 700 }}>[MODELS]</span>
        </div>
        <div style={{ color: "#5a6a7a", fontSize: "13px" }}>$ models --config --admin</div>
      </div>

      {/* Actions bar */}
      <div style={{ marginBottom: "20px", display: "flex", gap: "12px", alignItems: "center" }}>
        <button
          onClick={() => {
            if (showForm) {
              setShowForm(false);
            } else {
              resetForm();
              setShowForm(true);
            }
          }}
          style={{
            padding: "8px 20px",
            background: "transparent",
            border: "1px solid #00ff88",
            color: "#00ff88",
            fontFamily: "inherit",
            fontSize: "12px",
            fontWeight: 700,
            cursor: "pointer",
            textTransform: "uppercase",
            letterSpacing: "0.1em",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(0, 255, 136, 0.1)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
        >
          {showForm ? "[  CANCEL  ]" : "[  + NEW MODEL  ]"}
        </button>
        <div style={{ fontSize: "12px", color: "#5a6a7a" }}>
          {models.length} model{models.length !== 1 ? "s" : ""} | {models.filter((m) => m.isEnabled).length} enabled
        </div>
      </div>

      {/* Create form */}
      {showForm && (
        <div style={{
          padding: "16px",
          border: "1px solid #00ff88",
          backgroundColor: "rgba(0, 255, 136, 0.03)",
          marginBottom: "20px",
        }}>
          <div style={{
            fontSize: "11px",
            fontWeight: 700,
            color: "#00ff88",
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            marginBottom: "12px",
          }}>
            NEW MODEL
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px", marginBottom: "12px" }}>
            <div>
              <label style={s.label}>--model-id *</label>
              <input
                value={formData.modelId}
                onChange={(e) => setFormData({ ...formData, modelId: e.target.value })}
                placeholder="e.g. gpt-4o-mini"
                style={s.input}
              />
            </div>
            <div>
              <label style={s.label}>--label *</label>
              <input
                value={formData.label}
                onChange={(e) => setFormData({ ...formData, label: e.target.value })}
                placeholder="e.g. GPT-4o Mini"
                style={s.input}
              />
            </div>
            <div>
              <label style={s.label}>--provider</label>
              <select
                value={formData.provider}
                onChange={(e) => setFormData({ ...formData, provider: e.target.value })}
                style={s.input}
              >
                {PROVIDERS.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 0.6fr", gap: "12px", marginBottom: "12px" }}>
            <div>
              <label style={s.label}>--pricing-input</label>
              <input
                type="number"
                step="0.01"
                value={formData.pricingInput}
                onChange={(e) => setFormData({ ...formData, pricingInput: e.target.value })}
                placeholder="0.00"
                style={s.input}
              />
            </div>
            <div>
              <label style={s.label}>--pricing-output</label>
              <input
                type="number"
                step="0.01"
                value={formData.pricingOutput}
                onChange={(e) => setFormData({ ...formData, pricingOutput: e.target.value })}
                placeholder="0.00"
                style={s.input}
              />
            </div>
            <div>
              <label style={s.label}>--pricing-unit</label>
              <select
                value={formData.pricingUnit}
                onChange={(e) => setFormData({ ...formData, pricingUnit: e.target.value })}
                style={s.input}
              >
                {PRICING_UNITS.map((u) => (
                  <option key={u} value={u}>{u}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={s.label}>--sort</label>
              <input
                type="number"
                value={formData.sortOrder}
                onChange={(e) => setFormData({ ...formData, sortOrder: e.target.value })}
                placeholder="0"
                style={s.input}
              />
            </div>
          </div>
          {formError && (
            <div style={{ color: "#ff4444", fontSize: "12px", marginBottom: "8px" }}>
              [ERROR] {formError}
            </div>
          )}
          <button
            onClick={handleCreate}
            style={{
              padding: "6px 16px",
              background: "transparent",
              border: "1px solid #00ff88",
              color: "#00ff88",
              fontFamily: "inherit",
              fontSize: "12px",
              fontWeight: 700,
              cursor: "pointer",
              textTransform: "uppercase",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(0, 255, 136, 0.1)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
          >
            [  CREATE  ]
          </button>
        </div>
      )}

      {/* Error display */}
      {error && (
        <div style={{
          padding: "12px",
          backgroundColor: "rgba(255, 68, 68, 0.08)",
          border: "1px solid #ff4444",
          color: "#ff4444",
          fontSize: "13px",
          marginBottom: "16px",
        }}>
          <span style={{ fontWeight: 700 }}>[ERROR]</span> {error}
        </div>
      )}

      {/* Models table */}
      {loading ? (
        <div style={{ color: "#00ff88", fontSize: "13px" }}>
          <span style={{ animation: "blink 1s step-end infinite" }}>_</span> Loading models...
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", fontSize: "12px", borderCollapse: "collapse", fontFamily: "inherit" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #00ff88", textAlign: "left" }}>
                {["MODEL ID", "LABEL", "PROVIDER", "ENABLED", "DEFAULT", "PRICING", "SORT", "ACTIONS"].map((h) => (
                  <th
                    key={h}
                    style={{
                      padding: "8px 12px 8px 0",
                      color: "#00ff88",
                      fontWeight: 700,
                      fontSize: "10px",
                      textTransform: "uppercase",
                      letterSpacing: "0.1em",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {models.map((m) => {
                const isRowEditing = rowEditId === m.id;
                return (
                  <tr key={m.id}>
                    <td colSpan={8} style={{ padding: 0 }}>
                      {/* Main row */}
                      <div style={{
                        display: "grid",
                        gridTemplateColumns: "1.2fr 1fr 0.8fr 0.5fr 0.5fr 1.4fr 0.4fr 1.2fr",
                        alignItems: "center",
                        borderBottom: "1px solid rgba(30, 42, 58, 0.5)",
                        padding: "8px 0",
                      }}>
                        {/* Model ID */}
                        <div style={{ color: "#e0e0e0", fontSize: "12px", fontWeight: 600 }}>{m.modelId}</div>

                        {/* Label */}
                        <div style={{ color: "#5a6a7a", fontSize: "11px" }}>{m.label}</div>

                        {/* Provider badge */}
                        <div>
                          <span style={{
                            color: m.provider === "anthropic" ? "#ff8800" : m.provider === "openai" ? "#00e5ff" : "#ffcc00",
                            fontSize: "10px",
                            fontWeight: 700,
                            textTransform: "uppercase",
                            padding: "2px 6px",
                            border: `1px solid ${m.provider === "anthropic" ? "rgba(255, 136, 0, 0.3)" : m.provider === "openai" ? "rgba(0, 229, 255, 0.3)" : "rgba(255, 204, 0, 0.3)"}`,
                          }}>
                            {m.provider}
                          </span>
                        </div>

                        {/* Enabled toggle */}
                        <div>
                          <span
                            onClick={() => handleToggleEnabled(m)}
                            style={{
                              cursor: "pointer",
                              fontSize: "11px",
                              fontWeight: 700,
                              color: m.isEnabled ? "#00ff88" : "#ff4444",
                            }}
                            title={m.isEnabled ? "Click to disable" : "Click to enable"}
                          >
                            {m.isEnabled ? "\u25CF ON" : "\u25CF OFF"}
                          </span>
                        </div>

                        {/* Default toggle */}
                        <div>
                          <span
                            onClick={() => handleToggleDefault(m)}
                            style={{
                              cursor: "pointer",
                              fontSize: "13px",
                              color: m.isDefault ? "#ffcc00" : "#333",
                            }}
                            title={m.isDefault ? "Default model (click to unset)" : "Click to set as default"}
                          >
                            {m.isDefault ? "\u2605" : "\u2606"}
                          </span>
                        </div>

                        {/* Pricing (inline editable) */}
                        <div style={{ fontSize: "10px", color: "#5a6a7a" }}>
                          {editingId === m.id && editField === "pricingInput" ? (
                            <input
                              type="number"
                              step="0.01"
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              onBlur={() => saveInlineEdit(m.id)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") saveInlineEdit(m.id);
                                if (e.key === "Escape") cancelInlineEdit();
                              }}
                              autoFocus
                              style={{
                                width: "60px",
                                padding: "2px 4px",
                                backgroundColor: "#111820",
                                border: "1px solid #00e5ff",
                                color: "#00e5ff",
                                fontFamily: "inherit",
                                fontSize: "10px",
                              }}
                            />
                          ) : (
                            <span
                              onClick={() => startInlineEdit(m.id, "pricingInput", m.pricingInput)}
                              style={{ cursor: "pointer", color: "#00e5ff" }}
                              title="Click to edit input pricing"
                            >
                              in: ${m.pricingInput.toFixed(2)}
                            </span>
                          )}
                          <span style={{ color: "#5a6a7a" }}> / </span>
                          {editingId === m.id && editField === "pricingOutput" ? (
                            <input
                              type="number"
                              step="0.01"
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              onBlur={() => saveInlineEdit(m.id)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") saveInlineEdit(m.id);
                                if (e.key === "Escape") cancelInlineEdit();
                              }}
                              autoFocus
                              style={{
                                width: "60px",
                                padding: "2px 4px",
                                backgroundColor: "#111820",
                                border: "1px solid #ff8800",
                                color: "#ff8800",
                                fontFamily: "inherit",
                                fontSize: "10px",
                              }}
                            />
                          ) : (
                            <span
                              onClick={() => startInlineEdit(m.id, "pricingOutput", m.pricingOutput)}
                              style={{ cursor: "pointer", color: "#ff8800" }}
                              title="Click to edit output pricing"
                            >
                              out: ${m.pricingOutput.toFixed(2)}
                            </span>
                          )}
                          <span style={{ color: "#5a6a7a" }}> / {formatPricingUnit(m.pricingUnit)}</span>
                        </div>

                        {/* Sort order */}
                        <div style={{ color: "#5a6a7a", fontSize: "11px" }}>{m.sortOrder}</div>

                        {/* Actions */}
                        <div style={{ display: "flex", gap: "4px" }}>
                          <button
                            onClick={() => isRowEditing ? setRowEditId(null) : startRowEdit(m)}
                            style={{
                              padding: "2px 8px",
                              background: "transparent",
                              border: `1px solid ${isRowEditing ? "#ffcc00" : "#00e5ff"}`,
                              color: isRowEditing ? "#ffcc00" : "#00e5ff",
                              fontFamily: "inherit",
                              fontSize: "10px",
                              cursor: "pointer",
                            }}
                          >
                            {isRowEditing ? "CLOSE" : "EDIT"}
                          </button>
                          <button
                            onClick={() => handleDelete(m.id)}
                            style={{
                              padding: "2px 8px",
                              background: "transparent",
                              border: "1px solid #ff4444",
                              color: "#ff4444",
                              fontFamily: "inherit",
                              fontSize: "10px",
                              cursor: "pointer",
                            }}
                          >
                            DEL
                          </button>
                        </div>
                      </div>

                      {/* Inline full edit form */}
                      {isRowEditing && (
                        <div style={{
                          padding: "12px 16px",
                          backgroundColor: "rgba(0, 229, 255, 0.03)",
                          borderBottom: "1px solid rgba(0, 229, 255, 0.2)",
                          borderLeft: "2px solid #00e5ff",
                          marginLeft: "8px",
                        }}>
                          <div style={{
                            fontSize: "10px",
                            fontWeight: 700,
                            color: "#00e5ff",
                            textTransform: "uppercase",
                            letterSpacing: "0.1em",
                            marginBottom: "8px",
                          }}>
                            EDIT MODEL
                          </div>
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "10px", marginBottom: "10px" }}>
                            <div>
                              <label style={{ ...s.label, color: "#00e5ff" }}>--model-id</label>
                              <input
                                value={rowEditData.modelId}
                                onChange={(e) => setRowEditData({ ...rowEditData, modelId: e.target.value })}
                                style={s.input}
                              />
                            </div>
                            <div>
                              <label style={{ ...s.label, color: "#00e5ff" }}>--label</label>
                              <input
                                value={rowEditData.label}
                                onChange={(e) => setRowEditData({ ...rowEditData, label: e.target.value })}
                                style={s.input}
                              />
                            </div>
                            <div>
                              <label style={{ ...s.label, color: "#00e5ff" }}>--provider</label>
                              <select
                                value={rowEditData.provider}
                                onChange={(e) => setRowEditData({ ...rowEditData, provider: e.target.value })}
                                style={s.input}
                              >
                                {PROVIDERS.map((p) => (
                                  <option key={p} value={p}>{p}</option>
                                ))}
                              </select>
                            </div>
                          </div>
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 0.6fr", gap: "10px", marginBottom: "10px" }}>
                            <div>
                              <label style={{ ...s.label, color: "#00e5ff" }}>--pricing-input</label>
                              <input
                                type="number"
                                step="0.01"
                                value={rowEditData.pricingInput}
                                onChange={(e) => setRowEditData({ ...rowEditData, pricingInput: e.target.value })}
                                style={s.input}
                              />
                            </div>
                            <div>
                              <label style={{ ...s.label, color: "#00e5ff" }}>--pricing-output</label>
                              <input
                                type="number"
                                step="0.01"
                                value={rowEditData.pricingOutput}
                                onChange={(e) => setRowEditData({ ...rowEditData, pricingOutput: e.target.value })}
                                style={s.input}
                              />
                            </div>
                            <div>
                              <label style={{ ...s.label, color: "#00e5ff" }}>--pricing-unit</label>
                              <select
                                value={rowEditData.pricingUnit}
                                onChange={(e) => setRowEditData({ ...rowEditData, pricingUnit: e.target.value })}
                                style={s.input}
                              >
                                {PRICING_UNITS.map((u) => (
                                  <option key={u} value={u}>{u}</option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label style={{ ...s.label, color: "#00e5ff" }}>--sort</label>
                              <input
                                type="number"
                                value={rowEditData.sortOrder}
                                onChange={(e) => setRowEditData({ ...rowEditData, sortOrder: e.target.value })}
                                style={s.input}
                              />
                            </div>
                          </div>
                          {rowEditError && (
                            <div style={{ color: "#ff4444", fontSize: "12px", marginBottom: "8px" }}>
                              [ERROR] {rowEditError}
                            </div>
                          )}
                          <div style={{ display: "flex", gap: "8px" }}>
                            <button
                              onClick={handleRowEditSave}
                              style={{
                                padding: "4px 12px",
                                background: "transparent",
                                border: "1px solid #00e5ff",
                                color: "#00e5ff",
                                fontFamily: "inherit",
                                fontSize: "10px",
                                fontWeight: 700,
                                cursor: "pointer",
                                textTransform: "uppercase",
                              }}
                              onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(0, 229, 255, 0.1)"; }}
                              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                            >
                              [  SAVE  ]
                            </button>
                            <button
                              onClick={() => setRowEditId(null)}
                              style={{
                                padding: "4px 12px",
                                background: "transparent",
                                border: "1px solid #5a6a7a",
                                color: "#5a6a7a",
                                fontFamily: "inherit",
                                fontSize: "10px",
                                fontWeight: 700,
                                cursor: "pointer",
                                textTransform: "uppercase",
                              }}
                            >
                              [  CANCEL  ]
                            </button>
                          </div>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
              {models.length === 0 && (
                <tr>
                  <td colSpan={8} style={{ padding: "20px 0", textAlign: "center", color: "#333", fontSize: "12px" }}>
                    No models configured. Add one above.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
