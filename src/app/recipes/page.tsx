"use client";

import { useSession } from "next-auth/react";
import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

type Recipe = {
  id: string; name: string; slug: string; description: string | null;
  steps: { id: string; stepIndex: number; name: string; type: string }[];
  _count: { executions: number };
};

type Execution = {
  id: string; status: string; progress: number; currentStep: number; totalSteps: number;
  startedAt: string; finishedAt: string | null; errorMessage: string | null;
  recipe: { name: string; slug: string };
};

export default function RecipesPage() {
  const { data: session } = useSession();
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [loading, setLoading] = useState(false);
  const [executing, setExecuting] = useState<string | null>(null);
  const [inputText, setInputText] = useState("");
  const [selectedRecipeId, setSelectedRecipeId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [recipeResp, execResp] = await Promise.all([
        fetch("/api/recipes"),
        fetch("/api/recipes/executions"),
      ]);
      const [recipeData, execData] = await Promise.all([recipeResp.json(), execResp.json()]);
      setRecipes(recipeData.recipes || []);
      setExecutions(execData.executions || []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (session) load();
  }, [session, load]);

  // Poll for running executions
  useEffect(() => {
    const hasRunning = executions.some((e) => e.status === "running" || e.status === "pending");
    if (!hasRunning) return;
    const interval = setInterval(load, 3000);
    return () => clearInterval(interval);
  }, [executions, load]);

  async function handleExecute(recipeId: string) {
    setExecuting(recipeId);
    try {
      await fetch(`/api/recipes/${recipeId}/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inputData: inputText ? { text: inputText } : null }),
      });
      setInputText("");
      setSelectedRecipeId(null);
      load();
    } catch { /* ignore */ }
    finally { setExecuting(null); }
  }

  if (!session) return <div style={{ color: "#5a6a7a" }}><span style={{ color: "#ff4444" }}>[ERROR]</span> Authentication required.</div>;

  const statusColor = (s: string) => {
    if (s === "done") return "#00ff88";
    if (s === "running" || s === "pending") return "#ffcc00";
    if (s === "error") return "#ff4444";
    return "#5a6a7a";
  };

  return (
    <div>
      <div style={{ marginBottom: "24px" }}>
        <div style={{ color: "#ff8800", fontSize: "18px", fontWeight: 700, marginBottom: "4px" }}>[RECIPES]</div>
        <div style={{ color: "#5a6a7a", fontSize: "13px" }}>$ recipes --list --execute</div>
      </div>

      {loading && <div style={{ color: "#00ff88", fontSize: "13px", marginBottom: "12px" }}>Loading...</div>}

      {/* Available recipes */}
      <div style={{ marginBottom: "32px" }}>
        <div style={{ fontSize: "11px", fontWeight: 700, color: "#ff8800", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "12px" }}>AVAILABLE RECIPES</div>
        <div style={{ display: "grid", gap: "8px" }}>
          {recipes.filter(r => r.steps.length > 0).map((r) => (
            <div key={r.id} style={{ border: "1px solid #1e2a3a", padding: "12px 16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                <div>
                  <span style={{ color: "#e0e0e0", fontWeight: 700, fontSize: "14px" }}>{r.name}</span>
                  {r.description && <span style={{ color: "#5a6a7a", fontSize: "12px", marginLeft: "8px" }}>{r.description}</span>}
                </div>
                <span style={{ color: "#5a6a7a", fontSize: "10px" }}>{r.steps.length} steps</span>
              </div>
              <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "8px" }}>
                {r.steps.map((s) => (
                  <span key={s.id} style={{ padding: "2px 8px", backgroundColor: "rgba(255, 136, 0, 0.1)", border: "1px solid rgba(255, 136, 0, 0.2)", color: "#ff8800", fontSize: "10px", fontWeight: 700, textTransform: "uppercase" }}>
                    {s.type}: {s.name}
                  </span>
                ))}
              </div>
              {selectedRecipeId === r.id ? (
                <div style={{ display: "flex", gap: "8px", alignItems: "flex-end" }}>
                  <textarea
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    placeholder="Paste input text (optional — e.g. transcript, article text)..."
                    style={{ flex: 1, padding: "8px", backgroundColor: "#111820", border: "1px solid #1e2a3a", color: "#e0e0e0", fontFamily: "inherit", fontSize: "12px", resize: "vertical", minHeight: "60px" }}
                  />
                  <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                    <button
                      onClick={() => handleExecute(r.id)}
                      disabled={executing === r.id}
                      style={{ padding: "8px 16px", background: "transparent", border: "1px solid #00ff88", color: "#00ff88", fontFamily: "inherit", fontSize: "11px", fontWeight: 700, cursor: "pointer", textTransform: "uppercase" }}
                    >
                      {executing === r.id ? "..." : "RUN"}
                    </button>
                    <button
                      onClick={() => { setSelectedRecipeId(null); setInputText(""); }}
                      style={{ padding: "4px 16px", background: "transparent", border: "1px solid #5a6a7a", color: "#5a6a7a", fontFamily: "inherit", fontSize: "10px", cursor: "pointer" }}
                    >
                      CANCEL
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setSelectedRecipeId(r.id)}
                  style={{ padding: "6px 16px", background: "transparent", border: "1px solid #00ff88", color: "#00ff88", fontFamily: "inherit", fontSize: "11px", fontWeight: 700, cursor: "pointer", textTransform: "uppercase" }}
                >
                  [  EXECUTE  ]
                </button>
              )}
            </div>
          ))}
          {recipes.filter(r => r.steps.length > 0).length === 0 && (
            <div style={{ color: "#333", fontSize: "12px", padding: "20px", textAlign: "center" }}>No recipes available. Admin must create and activate recipes.</div>
          )}
        </div>
      </div>

      {/* Recent executions */}
      {executions.length > 0 && (
        <div>
          <div style={{ fontSize: "11px", fontWeight: 700, color: "#ffcc00", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "12px" }}>RECENT EXECUTIONS</div>
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            {executions.map((e) => (
              <Link key={e.id} href={`/recipes/${e.id}`} className="no-underline" style={{ display: "flex", alignItems: "center", gap: "12px", padding: "8px 12px", backgroundColor: "rgba(13, 17, 23, 0.5)", border: "1px solid #1e2a3a", borderLeft: `3px solid ${statusColor(e.status)}` }}>
                <span style={{ color: statusColor(e.status), fontSize: "10px", fontWeight: 700, textTransform: "uppercase", width: "70px" }}>{e.status}</span>
                <span style={{ color: "#e0e0e0", fontSize: "12px", flex: 1 }}>{e.recipe.name}</span>
                {(e.status === "running" || e.status === "pending") && (
                  <span style={{ color: "#ffcc00", fontSize: "10px" }}>{e.progress}% — step {e.currentStep + 1}/{e.totalSteps}</span>
                )}
                <span style={{ color: "#5a6a7a", fontSize: "10px" }}>{new Date(e.startedAt).toLocaleString("sl-SI", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
