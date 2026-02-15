"use client";

import { useSession } from "next-auth/react";
import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

type StepResult = {
  id: string; stepIndex: number; status: string;
  inputPreview: string | null; outputPreview: string | null;
  outputFull: { text?: string } | null;
  startedAt: string | null; finishedAt: string | null;
  errorMessage: string | null;
};

type Execution = {
  id: string; status: string; progress: number; currentStep: number; totalSteps: number;
  startedAt: string; finishedAt: string | null; errorMessage: string | null;
  recipe: { name: string; slug: string };
  stepResults: StepResult[];
};

export default function ExecutionDetailPage() {
  const { data: session } = useSession();
  const params = useParams();
  const id = params.id as string;
  const [execution, setExecution] = useState<Execution | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedStep, setExpandedStep] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const resp = await fetch(`/api/recipes/executions/${id}`);
      const data = await resp.json();
      setExecution(data.execution || null);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  // Poll while running
  useEffect(() => {
    if (!execution || (execution.status !== "running" && execution.status !== "pending")) return;
    const interval = setInterval(load, 2000);
    return () => clearInterval(interval);
  }, [execution, load]);

  if (!session) return <div style={{ color: "#ff4444" }}>[ERROR] Authentication required.</div>;
  if (loading) return <div style={{ color: "#00ff88" }}>Loading...</div>;
  if (!execution) return <div style={{ color: "#ff4444" }}>[ERROR] Execution not found.</div>;

  const statusColor = (s: string) => {
    if (s === "done") return "#00ff88";
    if (s === "running" || s === "pending") return "#ffcc00";
    if (s === "error") return "#ff4444";
    return "#5a6a7a";
  };

  return (
    <div>
      <div style={{ marginBottom: "24px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
          <Link href="/recipes" className="no-underline" style={{ color: "#ff8800", fontSize: "18px", fontWeight: 700 }}>[RECIPES]</Link>
          <span style={{ color: "#333" }}>/</span>
          <span style={{ color: "#e0e0e0", fontSize: "18px", fontWeight: 700 }}>{execution.recipe.name}</span>
        </div>
        <div style={{ color: "#5a6a7a", fontSize: "13px" }}>Execution {id.substring(0, 8)}...</div>
      </div>

      {/* Status bar */}
      <div style={{ marginBottom: "20px", padding: "12px 16px", border: `1px solid ${statusColor(execution.status)}`, backgroundColor: `rgba(${execution.status === "done" ? "0, 255, 136" : execution.status === "error" ? "255, 68, 68" : "255, 204, 0"}, 0.05)` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
          <span style={{ color: statusColor(execution.status), fontWeight: 700, fontSize: "14px", textTransform: "uppercase" }}>{execution.status}</span>
          <span style={{ color: "#5a6a7a", fontSize: "11px" }}>
            {new Date(execution.startedAt).toLocaleString("sl-SI")}
            {execution.finishedAt && ` — ${Math.round((new Date(execution.finishedAt).getTime() - new Date(execution.startedAt).getTime()) / 1000)}s`}
          </span>
        </div>
        {/* Progress bar */}
        <div style={{ height: "4px", backgroundColor: "#1e2a3a", borderRadius: "2px", overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${execution.progress}%`, backgroundColor: statusColor(execution.status), transition: "width 0.5s" }} />
        </div>
        <div style={{ fontSize: "10px", color: "#5a6a7a", marginTop: "4px" }}>Step {Math.min(execution.currentStep + 1, execution.totalSteps)} of {execution.totalSteps} — {execution.progress}%</div>
        {execution.errorMessage && <div style={{ color: "#ff4444", fontSize: "12px", marginTop: "8px" }}>[ERROR] {execution.errorMessage}</div>}
      </div>

      {/* Step results */}
      <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
        {execution.stepResults.map((sr) => {
          const isExpanded = expandedStep === sr.stepIndex;
          return (
            <div key={sr.id} style={{ border: `1px solid ${isExpanded ? statusColor(sr.status) : "#1e2a3a"}` }}>
              <div onClick={() => setExpandedStep(isExpanded ? null : sr.stepIndex)} style={{ padding: "10px 16px", cursor: "pointer", display: "flex", alignItems: "center", gap: "12px" }}>
                <span style={{ color: "#ffcc00", fontWeight: 700, fontSize: "11px" }}>#{sr.stepIndex + 1}</span>
                <span style={{ color: statusColor(sr.status), fontWeight: 700, fontSize: "10px", textTransform: "uppercase", width: "60px" }}>{sr.status}</span>
                <span style={{ color: "#e0e0e0", fontSize: "12px", flex: 1 }}>{sr.outputPreview ? sr.outputPreview.substring(0, 100) + "..." : "—"}</span>
                <span style={{ color: isExpanded ? statusColor(sr.status) : "#444", fontSize: "10px" }}>{isExpanded ? "▼" : "▶"}</span>
              </div>
              {isExpanded && (
                <div style={{ padding: "0 16px 12px", borderTop: "1px solid rgba(30, 42, 58, 0.5)" }}>
                  {sr.inputPreview && (
                    <div style={{ marginTop: "8px" }}>
                      <div style={{ fontSize: "10px", color: "#00e5ff", fontWeight: 700, marginBottom: "4px" }}>INPUT</div>
                      <div style={{ padding: "8px", backgroundColor: "#0a0e14", border: "1px solid #1e2a3a", fontSize: "11px", color: "#8b949e", maxHeight: "100px", overflowY: "auto", whiteSpace: "pre-wrap" }}>{sr.inputPreview}</div>
                    </div>
                  )}
                  {sr.outputFull && (sr.outputFull as { text?: string }).text && (
                    <div style={{ marginTop: "8px" }}>
                      <div style={{ fontSize: "10px", color: "#00ff88", fontWeight: 700, marginBottom: "4px" }}>OUTPUT</div>
                      <div style={{ padding: "8px", backgroundColor: "#0a0e14", border: "1px solid #1e2a3a", fontSize: "11px", color: "#e0e0e0", maxHeight: "300px", overflowY: "auto", whiteSpace: "pre-wrap" }}>{(sr.outputFull as { text?: string }).text}</div>
                    </div>
                  )}
                  {sr.errorMessage && (
                    <div style={{ marginTop: "8px", color: "#ff4444", fontSize: "11px" }}>[ERROR] {sr.errorMessage}</div>
                  )}
                  {sr.finishedAt && sr.startedAt && (
                    <div style={{ marginTop: "4px", fontSize: "10px", color: "#5a6a7a" }}>
                      Duration: {Math.round((new Date(sr.finishedAt).getTime() - new Date(sr.startedAt).getTime()) / 1000)}s
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
