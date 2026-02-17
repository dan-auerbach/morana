"use client";

import { useSession } from "next-auth/react";
import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";

type Recipe = {
  id: string; name: string; slug: string; description: string | null;
  inputKind: string; inputModes: string[] | null; defaultLang: string | null;
  uiHints: Record<string, unknown> | null;
  steps: { id: string; stepIndex: number; name: string; type: string }[];
  _count: { executions: number };
};

type Execution = {
  id: string; status: string; progress: number; currentStep: number; totalSteps: number;
  startedAt: string; finishedAt: string | null; errorMessage: string | null;
  totalCostCents: number;
  recipe: { name: string; slug: string };
};

type Preset = {
  key: string; name: string; description: string; stepsCount: number; stepTypes: string[]; alreadyCreated: boolean;
};

type InputMode = "file" | "url" | "text";

export default function RecipesPage() {
  const { data: session } = useSession();
  const isAdmin = (session?.user as Record<string, unknown>)?.role === "admin";
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [loading, setLoading] = useState(false);
  const [executing, setExecuting] = useState<string | null>(null);
  const [selectedRecipeId, setSelectedRecipeId] = useState<string | null>(null);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [creatingPreset, setCreatingPreset] = useState(false);

  // Input state
  const [inputText, setInputText] = useState("");
  const [inputMode, setInputMode] = useState<InputMode>("text");
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [audioUrl, setAudioUrl] = useState("");
  const [language, setLanguage] = useState("sl");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const fetches = [fetch("/api/recipes"), fetch("/api/recipes/executions")];
      if (isAdmin) fetches.push(fetch("/api/recipes/presets"));
      const responses = await Promise.all(fetches);
      const data = await Promise.all(responses.map(r => r.json()));
      setRecipes(data[0].recipes || []);
      setExecutions(data[1].executions || []);
      if (data[2]) setPresets(data[2].presets || []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [isAdmin]);

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

  function resetInput() {
    setInputText(""); setAudioFile(null); setAudioUrl(""); setInputMode("text"); setLanguage("sl");
    setSelectedRecipeId(null);
  }

  function selectRecipe(recipe: Recipe) {
    setSelectedRecipeId(recipe.id);
    setLanguage(recipe.defaultLang || "sl");
    // Default to first available input mode
    const modes = recipe.inputModes as InputMode[] | null;
    if (modes && modes.length > 0) {
      setInputMode(modes[0]);
    } else if (recipe.inputKind === "audio") {
      setInputMode("file");
    } else {
      setInputMode("text");
    }
  }

  async function handleExecute(recipeId: string) {
    setExecuting(recipeId);
    try {
      const recipe = recipes.find(r => r.id === recipeId);
      const isAudio = recipe?.inputKind === "audio";

      let resp: Response;
      if (isAudio) {
        // Use FormData for audio recipes
        const formData = new FormData();
        formData.append("language", language);

        if (inputMode === "file" && audioFile) {
          formData.append("file", audioFile);
        } else if (inputMode === "url" && audioUrl) {
          formData.append("audioUrl", audioUrl);
        } else if (inputMode === "text" && inputText) {
          formData.append("transcriptText", inputText);
        }

        resp = await fetch(`/api/recipes/${recipeId}/execute`, {
          method: "POST",
          body: formData,
        });
      } else {
        // JSON for text recipes
        resp = await fetch(`/api/recipes/${recipeId}/execute`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ inputData: inputText ? { text: inputText } : null }),
        });
      }

      await resp.json();
      resetInput();
      // Execution is async — reload to show it in the list, polling tracks progress
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

  const selectedRecipe = recipes.find(r => r.id === selectedRecipeId);
  const availableModes = (selectedRecipe?.inputModes as InputMode[] | null) || (selectedRecipe?.inputKind === "audio" ? ["file", "url", "text"] as InputMode[] : ["text"] as InputMode[]);

  return (
    <div>
      <div style={{ marginBottom: "24px" }}>
        <div style={{ color: "#ff8800", fontSize: "18px", fontWeight: 700, marginBottom: "4px" }}>[RECIPES]</div>
        <div style={{ color: "#5a6a7a", fontSize: "13px" }}>$ recipes --list --execute</div>
      </div>

      {loading && <div style={{ color: "#00ff88", fontSize: "13px", marginBottom: "12px" }}>Loading...</div>}

      {/* Admin: Create from preset + Sync existing */}
      {isAdmin && presets.length > 0 && (
        <div style={{ marginBottom: "24px", padding: "12px 16px", border: "1px dashed rgba(255, 136, 0, 0.4)", backgroundColor: "rgba(255, 136, 0, 0.03)" }}>
          <div style={{ fontSize: "11px", fontWeight: 700, color: "#ff8800", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "8px" }}>
            RECIPE PRESETS (Admin)
          </div>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            {presets.map((p) => (
              <button
                key={p.key}
                disabled={creatingPreset}
                onClick={async () => {
                  setCreatingPreset(true);
                  try {
                    if (p.alreadyCreated) {
                      // Sync: update existing recipe from preset code
                      await fetch("/api/recipes/presets", {
                        method: "PUT",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ presetKey: p.key }),
                      });
                    } else {
                      // Create: instantiate new recipe from preset
                      await fetch("/api/recipes/presets", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ presetKey: p.key }),
                      });
                    }
                    load();
                  } catch { /* ignore */ }
                  finally { setCreatingPreset(false); }
                }}
                style={{
                  padding: "8px 16px", background: "transparent",
                  border: `1px solid ${p.alreadyCreated ? "#00e5ff" : "#ff8800"}`,
                  color: p.alreadyCreated ? "#00e5ff" : "#ff8800",
                  fontFamily: "inherit", fontSize: "11px", fontWeight: 700,
                  cursor: creatingPreset ? "wait" : "pointer", textTransform: "uppercase",
                }}
              >
                {p.alreadyCreated ? "SYNC" : "+"} {p.name}
                <span style={{ fontSize: "9px", color: "#5a6a7a", marginLeft: "6px" }}>
                  ({p.stepTypes.join(" \u2192 ")})
                </span>
              </button>
            ))}
          </div>
          <div style={{ fontSize: "10px", color: "#5a6a7a", marginTop: "6px" }}>
            {presets.some(p => !p.alreadyCreated) ? "Click + to create from preset." : ""}{" "}
            {presets.some(p => p.alreadyCreated) ? "Click SYNC to update steps from code." : ""}
          </div>
        </div>
      )}

      {/* Available recipes */}
      <div style={{ marginBottom: "32px" }}>
        <div style={{ fontSize: "11px", fontWeight: 700, color: "#ff8800", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "12px" }}>AVAILABLE RECIPES</div>
        <div style={{ display: "grid", gap: "8px" }}>
          {recipes.filter(r => r.steps.length > 0).map((r) => (
            <div key={r.id} style={{ border: "1px solid #1e2a3a", padding: "12px 16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                <div>
                  <span style={{ color: "#e0e0e0", fontWeight: 700, fontSize: "14px" }}>{r.name}</span>
                  {r.inputKind === "audio" && (
                    <span style={{ marginLeft: "8px", padding: "1px 6px", backgroundColor: "rgba(0, 229, 255, 0.1)", border: "1px solid rgba(0, 229, 255, 0.3)", color: "#00e5ff", fontSize: "9px", fontWeight: 700, textTransform: "uppercase" }}>AUDIO</span>
                  )}
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
                <div>
                  {/* Input mode selector for audio recipes */}
                  {r.inputKind === "audio" && availableModes.length > 1 && (
                    <div style={{ display: "flex", gap: "4px", marginBottom: "8px" }}>
                      {availableModes.map((mode) => (
                        <button
                          key={mode}
                          onClick={() => setInputMode(mode)}
                          style={{
                            padding: "4px 12px", background: inputMode === mode ? "rgba(0, 229, 255, 0.1)" : "transparent",
                            border: `1px solid ${inputMode === mode ? "#00e5ff" : "#1e2a3a"}`,
                            color: inputMode === mode ? "#00e5ff" : "#5a6a7a",
                            fontFamily: "inherit", fontSize: "10px", fontWeight: 700, cursor: "pointer", textTransform: "uppercase",
                          }}
                        >
                          {mode === "file" ? "UPLOAD FILE" : mode === "url" ? "AUDIO URL" : "PASTE TRANSCRIPT"}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Language selector for audio recipes */}
                  {r.inputKind === "audio" && (
                    <div style={{ display: "flex", gap: "8px", alignItems: "center", marginBottom: "8px" }}>
                      <span style={{ fontSize: "10px", fontWeight: 700, color: "#5a6a7a", textTransform: "uppercase" }}>Lang:</span>
                      {["sl", "en"].map((lang) => (
                        <button
                          key={lang}
                          onClick={() => setLanguage(lang)}
                          style={{
                            padding: "2px 10px", background: language === lang ? "rgba(255, 204, 0, 0.1)" : "transparent",
                            border: `1px solid ${language === lang ? "#ffcc00" : "#1e2a3a"}`,
                            color: language === lang ? "#ffcc00" : "#5a6a7a",
                            fontFamily: "inherit", fontSize: "10px", fontWeight: 700, cursor: "pointer",
                          }}
                        >
                          {lang.toUpperCase()}
                        </button>
                      ))}
                    </div>
                  )}

                  <div style={{ display: "flex", gap: "8px", alignItems: "flex-end" }}>
                    {/* Input area changes based on mode */}
                    {r.inputKind === "audio" && inputMode === "file" ? (
                      <div style={{ flex: 1 }}>
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept={(r.uiHints?.acceptAudio as string) || "audio/*"}
                          onChange={(e) => setAudioFile(e.target.files?.[0] || null)}
                          style={{ display: "none" }}
                        />
                        <button
                          onClick={() => fileInputRef.current?.click()}
                          style={{
                            width: "100%", padding: "16px", backgroundColor: "rgba(0, 229, 255, 0.03)",
                            border: `2px dashed ${audioFile ? "#00ff88" : "rgba(0, 229, 255, 0.3)"}`,
                            color: audioFile ? "#00ff88" : "#5a6a7a",
                            fontFamily: "inherit", fontSize: "12px", cursor: "pointer", textAlign: "center",
                          }}
                        >
                          {audioFile
                            ? `\u2713 ${audioFile.name} (${(audioFile.size / 1024 / 1024).toFixed(1)} MB)`
                            : "Click to select audio file (MP3, WAV, OGG, FLAC, M4A, AAC, WebM)"}
                        </button>
                      </div>
                    ) : r.inputKind === "audio" && inputMode === "url" ? (
                      <input
                        value={audioUrl}
                        onChange={(e) => setAudioUrl(e.target.value)}
                        placeholder="https://example.com/audio.mp3"
                        style={{ flex: 1, padding: "8px", backgroundColor: "#111820", border: "1px solid #1e2a3a", color: "#e0e0e0", fontFamily: "inherit", fontSize: "12px" }}
                      />
                    ) : (
                      <textarea
                        value={inputText}
                        onChange={(e) => setInputText(e.target.value)}
                        placeholder={r.inputKind === "audio" && inputMode === "text"
                          ? "Paste transcript text here (STT step will be skipped)..."
                          : (r.uiHints?.placeholder as string) || "Paste input text (optional \u2014 e.g. transcript, article text)..."}
                        style={{ flex: 1, padding: "8px", backgroundColor: "#111820", border: "1px solid #1e2a3a", color: "#e0e0e0", fontFamily: "inherit", fontSize: "12px", resize: "vertical", minHeight: "60px" }}
                      />
                    )}
                    <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                      <button
                        onClick={() => handleExecute(r.id)}
                        disabled={executing === r.id}
                        style={{
                          padding: "8px 16px", background: executing === r.id ? "rgba(255, 204, 0, 0.08)" : "transparent",
                          border: `1px solid ${executing === r.id ? "#ffcc00" : "#00ff88"}`,
                          color: executing === r.id ? "#ffcc00" : "#00ff88",
                          fontFamily: "inherit", fontSize: "11px", fontWeight: 700,
                          cursor: executing === r.id ? "wait" : "pointer", textTransform: "uppercase",
                          animation: executing === r.id ? "blink 1.2s step-end infinite" : "none",
                        }}
                      >
                        {executing === r.id ? "QUEUED..." : "RUN"}
                      </button>
                      <button
                        onClick={resetInput}
                        style={{ padding: "4px 16px", background: "transparent", border: "1px solid #5a6a7a", color: "#5a6a7a", fontFamily: "inherit", fontSize: "10px", cursor: "pointer" }}
                      >
                        CANCEL
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => selectRecipe(r)}
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
                  <span style={{ color: "#ffcc00", fontSize: "10px" }}>{e.progress}% &mdash; step {e.currentStep + 1}/{e.totalSteps}</span>
                )}
                {e.status === "done" && e.totalCostCents > 0 && (
                  <span style={{ color: "#ffcc00", fontSize: "10px", fontWeight: 700 }}>${(e.totalCostCents / 100).toFixed(4)}</span>
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
