"use client";

import { useSession } from "next-auth/react";
import { useState, useRef, useEffect, useCallback } from "react";
import StatusBadge from "@/app/components/StatusBadge";
import CostPreview from "@/app/components/CostPreview";

type HistoryRun = {
  id: string;
  status: string;
  createdAt: string;
  model: string;
  preview?: string;
};

type STTToken = {
  text: string;
  start_ms: number;
  end_ms: number;
  speaker?: string;
};

const LANGUAGES = [
  { code: "auto", label: "Auto-detect" },
  { code: "en", label: "English" },
  { code: "sl", label: "Slovenian" },
  { code: "de", label: "German" },
  { code: "fr", label: "French" },
  { code: "es", label: "Spanish" },
  { code: "it", label: "Italian" },
  { code: "pt", label: "Portuguese" },
  { code: "hr", label: "Croatian" },
  { code: "sr", label: "Serbian" },
  { code: "bs", label: "Bosnian" },
  { code: "nl", label: "Dutch" },
  { code: "pl", label: "Polish" },
  { code: "cs", label: "Czech" },
  { code: "sk", label: "Slovak" },
  { code: "hu", label: "Hungarian" },
  { code: "ro", label: "Romanian" },
  { code: "bg", label: "Bulgarian" },
  { code: "uk", label: "Ukrainian" },
  { code: "ru", label: "Russian" },
  { code: "ar", label: "Arabic" },
  { code: "zh", label: "Chinese" },
  { code: "ja", label: "Japanese" },
  { code: "ko", label: "Korean" },
  { code: "tr", label: "Turkish" },
];

function formatSRTTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const millis = ms % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")},${String(millis).padStart(3, "0")}`;
}

function generateSRT(tokens: STTToken[]): string {
  if (tokens.length === 0) return "";
  const segments: { text: string; start_ms: number; end_ms: number }[] = [];
  let currentWords: string[] = [];
  let segStart = tokens[0].start_ms;
  let segEnd = tokens[0].end_ms;

  for (const token of tokens) {
    const trimmed = token.text.trim();
    if (!trimmed) continue;
    currentWords.push(trimmed);
    segEnd = token.end_ms;
    const lineText = currentWords.join(" ");
    if (currentWords.length >= 10 || lineText.length >= 80) {
      segments.push({ text: lineText, start_ms: segStart, end_ms: segEnd });
      currentWords = [];
      segStart = segEnd;
    }
  }
  if (currentWords.length > 0) {
    segments.push({ text: currentWords.join(" "), start_ms: segStart, end_ms: segEnd });
  }

  return segments
    .map((seg, i) => `${i + 1}\n${formatSRTTime(seg.start_ms)} --> ${formatSRTTime(seg.end_ms)}\n${seg.text}`)
    .join("\n\n");
}

export default function STTPage() {
  const { data: session } = useSession();
  const [mode, setMode] = useState<"file" | "url">("file");
  const [language, setLanguage] = useState("auto");
  const [diarize, setDiarize] = useState(true);
  const [translateTo, setTranslateTo] = useState("");
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [runId, setRunId] = useState("");
  const [status, setStatus] = useState("");
  const [transcript, setTranscript] = useState("");
  const [tokens, setTokens] = useState<STTToken[] | null>(null);
  const [translatedText, setTranslatedText] = useState<string | null>(null);
  const [stats, setStats] = useState<{ latencyMs: number; durationSeconds: number } | null>(null);
  const [fileName, setFileName] = useState("");
  const [fileSizeBytes, setFileSizeBytes] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  // Rough estimate: ~1MB per minute for compressed audio
  const estimatedDurationSec = fileSizeBytes > 0 ? Math.max(10, (fileSizeBytes / 1_000_000) * 60) : 0;

  // History sidebar
  const [history, setHistory] = useState<HistoryRun[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // LLM action buttons
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionResult, setActionResult] = useState<string | null>(null);
  const [actionLabel, setActionLabel] = useState<string | null>(null);

  const loadHistory = useCallback(() => {
    fetch("/api/history?type=stt&limit=50")
      .then((r) => r.json())
      .then((d) => setHistory(d.runs || []));
  }, []);

  useEffect(() => {
    if (session) loadHistory();
  }, [session, loadHistory]);

  if (!session) {
    return (
      <div style={{ color: "#5a6a7a" }}>
        <span style={{ color: "#ff4444" }}>[ERROR]</span> Authentication required.
      </div>
    );
  }

  async function handleSubmit() {
    setLoading(true);
    setError("");
    setTranscript("");
    setTokens(null);
    setTranslatedText(null);
    setStatus("running");
    setStats(null);
    setActionResult(null);
    setActionLabel(null);

    try {
      let resp: Response;
      if (mode === "file") {
        const file = fileRef.current?.files?.[0];
        if (!file) throw new Error("No file selected");
        const formData = new FormData();
        formData.append("file", file);
        formData.append("language", language);
        if (diarize) formData.append("diarize", "true");
        if (translateTo) formData.append("translateTo", translateTo);
        resp = await fetch("/api/runs/stt", { method: "POST", body: formData });
      } else {
        if (!url) throw new Error("URL is required");
        resp = await fetch("/api/runs/stt", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url, lang: language, diarize, translateTo: translateTo || undefined }),
        });
      }
      let data;
      const respText = await resp.text();
      try { data = JSON.parse(respText); } catch { throw new Error(respText.slice(0, 200) || `Request failed (${resp.status})`); }
      if (!resp.ok) throw new Error(data.error || "Request failed");
      setRunId(data.runId);
      setStatus(data.status);
      if (data.text) setTranscript(data.text);
      if (data.tokens) setTokens(data.tokens);
      if (data.translatedText) setTranslatedText(data.translatedText);
      if (data.latencyMs) setStats({ latencyMs: data.latencyMs, durationSeconds: data.durationSeconds || 0 });
      loadHistory();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setStatus("error");
    } finally {
      setLoading(false);
    }
  }

  async function loadHistoryItem(id: string) {
    try {
      const resp = await fetch(`/api/runs/${id}`);
      const data = await resp.json();
      if (data.output?.text) {
        setTranscript(data.output.text);
        setTokens(data.output.tokens || null);
        setTranslatedText(data.output.translatedText || null);
        setRunId(data.id);
        setStatus(data.status);
        setStats({
          latencyMs: data.output.latencyMs || 0,
          durationSeconds: data.output.durationSeconds || 0,
        });
        setError("");
        setActionResult(null);
        setActionLabel(null);
      }
      if (data.errorMessage) {
        setError(data.errorMessage);
        setTranscript("");
      }
    } catch {
      // ignore
    }
  }

  async function runLLMAction(promptText: string, label: string) {
    if (!transcript || actionLoading) return;
    setActionLoading(label);
    setActionResult(null);
    setActionLabel(label);
    try {
      const resp = await fetch("/api/runs/llm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          modelId: "claude-sonnet-4-5-20250929",
          prompt: promptText,
          sourceText: transcript,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "Request failed");
      setActionResult(data.text);
    } catch (err: unknown) {
      setActionResult(`[ERROR] ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setActionLoading(null);
    }
  }

  const actionButtons = [
    {
      label: "Povzetek po alinejah",
      prompt: "Povzemi spodnje besedilo po alinejah (bullet points). Bodi jedrnat. Piši v slovenščini.",
    },
    {
      label: "Povzetek za SMS",
      prompt: "Povzami spodnje besedilo v obliki primernem za SMS sporočilo (kratko, max 2-3 stavki). Piši v slovenščini.",
    },
    {
      label: "Translate to English",
      prompt: "Translate the following text to English. Keep the meaning accurate.",
    },
    {
      label: "Ključne točke",
      prompt: "Izlušči ključne točke iz spodnjega besedila. Naštej jih kot numbered list. Piši v slovenščini.",
    },
  ];

  return (
    <div className="page-with-sidebar" style={{ display: "flex", gap: "0", margin: "-24px -16px", height: "calc(100vh - 57px)" }}>
      {/* History sidebar */}
      <div
        className="page-sidebar"
        style={{
          width: sidebarOpen ? "240px" : "0px",
          minWidth: sidebarOpen ? "240px" : "0px",
          borderRight: sidebarOpen ? "1px solid #1e2a3a" : "none",
          backgroundColor: "#0a0e14",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          transition: "all 0.2s",
        }}
      >
        <div style={{ padding: "12px", fontSize: "11px", fontWeight: 700, color: "#ffcc00", textTransform: "uppercase", letterSpacing: "0.1em", borderBottom: "1px solid #1e2a3a" }}>
          STT History
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "4px 8px" }}>
          {history.map((r) => (
            <div
              key={r.id}
              onClick={() => loadHistoryItem(r.id)}
              style={{
                padding: "8px 10px",
                marginBottom: "2px",
                cursor: "pointer",
                backgroundColor: r.id === runId ? "rgba(0, 255, 136, 0.08)" : "transparent",
                border: r.id === runId ? "1px solid rgba(0, 255, 136, 0.2)" : "1px solid transparent",
                borderRadius: "4px",
                transition: "all 0.15s",
              }}
              onMouseEnter={(e) => { if (r.id !== runId) e.currentTarget.style.backgroundColor = "rgba(0, 255, 136, 0.04)"; }}
              onMouseLeave={(e) => { if (r.id !== runId) e.currentTarget.style.backgroundColor = "transparent"; }}
            >
              <div style={{ color: r.id === runId ? "#e0e0e0" : "#8b949e", fontSize: "11px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginBottom: "3px" }}>
                {r.preview || r.id.slice(0, 16) + "..."}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <span style={{ color: "#444", fontSize: "9px" }}>
                  {new Date(r.createdAt).toLocaleString("sl-SI", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
            </div>
          ))}
          {history.length === 0 && (
            <div style={{ color: "#333", fontSize: "11px", textAlign: "center", padding: "20px 0" }}>No STT runs yet</div>
          )}
        </div>
      </div>

      {/* Main area */}
      <div className="page-main" style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, overflowY: "auto" }}>
        {/* Header */}
        <div style={{ padding: "10px 16px", borderBottom: "1px solid #1e2a3a", backgroundColor: "#0d1117", display: "flex", alignItems: "center", gap: "12px", flexShrink: 0 }}>
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            style={{ background: "transparent", border: "1px solid #1e2a3a", color: "#5a6a7a", cursor: "pointer", padding: "4px 8px", fontFamily: "inherit", fontSize: "12px" }}
          >
            {sidebarOpen ? "<<" : ">>"}
          </button>
          <span style={{ color: "#00ff88", fontSize: "14px", fontWeight: 700 }}>[STT]</span>
          <span style={{ color: "#5a6a7a", fontSize: "12px" }}>$ stt --input {mode} --lang {language}</span>
        </div>

        {/* Content */}
        <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "16px" }}>
          {/* Mode tabs */}
          <div style={{ display: "flex", gap: "0" }}>
            {(["file", "url"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                style={{
                  padding: "8px 20px", fontSize: "12px", fontWeight: 700, fontFamily: "inherit",
                  textTransform: "uppercase", letterSpacing: "0.1em", cursor: "pointer",
                  border: "1px solid", borderRight: m === "file" ? "none" : undefined,
                  backgroundColor: mode === m ? "#0d1117" : "transparent",
                  color: mode === m ? "#00ff88" : "#5a6a7a",
                  borderColor: mode === m ? "#00ff88" : "#1e2a3a",
                }}
              >
                [{m.toUpperCase()}]
              </button>
            ))}
          </div>

          {/* File upload or URL input */}
          {mode === "file" ? (
            <div>
              <label style={{ display: "block", marginBottom: "6px", fontSize: "11px", fontWeight: 700, color: "#00ff88", textTransform: "uppercase", letterSpacing: "0.1em" }}>--input-file</label>
              <div
                style={{ border: "2px dashed #00ff88", backgroundColor: "#0d1117", padding: "24px", textAlign: "center", cursor: "pointer", transition: "all 0.2s" }}
                onClick={() => fileRef.current?.click()}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "rgba(0, 255, 136, 0.05)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "#0d1117"; }}
              >
                {fileName ? (
                  <>
                    <div style={{ color: "#00ff88", fontSize: "13px", marginBottom: "4px" }}>✓ {fileName}</div>
                    <div style={{ color: "#5a6a7a", fontSize: "11px" }}>Click to change file</div>
                  </>
                ) : (
                  <>
                    <div style={{ color: "#00ff88", fontSize: "13px", marginBottom: "4px" }}>[ DROP AUDIO FILE OR CLICK ]</div>
                    <div style={{ color: "#5a6a7a", fontSize: "11px" }}>Supported: .mp3, .wav, .m4a, .ogg, .flac, .aac, .webm</div>
                    <div style={{ color: "#ff4444", fontSize: "10px", marginTop: "4px" }}>Video files not supported — extract audio first</div>
                  </>
                )}
              </div>
              <input ref={fileRef} type="file" accept="audio/*,.mp3,.wav,.ogg,.flac,.m4a,.aac,.webm" style={{ display: "none" }} onChange={(e) => { const file = e.target.files?.[0]; if (file) { setFileName(file.name); setFileSizeBytes(file.size); setError(""); } }} />
            </div>
          ) : (
            <div>
              <label style={{ display: "block", marginBottom: "6px", fontSize: "11px", fontWeight: 700, color: "#00ff88", textTransform: "uppercase", letterSpacing: "0.1em" }}>--input-url</label>
              <input value={url} onChange={(e) => setUrl(e.target.value)} type="url" placeholder="https://example.com/audio.mp3" style={{ width: "100%", padding: "8px 12px", backgroundColor: "#111820", border: "1px solid #1e2a3a", color: "#e0e0e0", fontFamily: "inherit", fontSize: "13px" }} />
            </div>
          )}

          {/* Language + Options row */}
          <div style={{ display: "flex", gap: "16px", flexWrap: "wrap", alignItems: "flex-end" }}>
            <div>
              <label style={{ display: "block", marginBottom: "6px", fontSize: "11px", fontWeight: 700, color: "#00ff88", textTransform: "uppercase", letterSpacing: "0.1em" }}>--lang</label>
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                style={{ padding: "8px 12px", backgroundColor: "#111820", border: "1px solid #1e2a3a", color: "#e0e0e0", fontFamily: "inherit", fontSize: "13px" }}
              >
                {LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code}>{l.code} ({l.label})</option>
                ))}
              </select>
            </div>

            <div>
              <label style={{ display: "block", marginBottom: "6px", fontSize: "11px", fontWeight: 700, color: "#00ff88", textTransform: "uppercase", letterSpacing: "0.1em" }}>--translate-to</label>
              <select
                value={translateTo}
                onChange={(e) => setTranslateTo(e.target.value)}
                style={{ padding: "8px 12px", backgroundColor: "#111820", border: "1px solid #1e2a3a", color: "#e0e0e0", fontFamily: "inherit", fontSize: "13px" }}
              >
                <option value="">None</option>
                {LANGUAGES.filter((l) => l.code !== "auto" && l.code !== language).map((l) => (
                  <option key={l.code} value={l.code}>{l.code} ({l.label})</option>
                ))}
              </select>
            </div>

            <button
              onClick={() => setDiarize(!diarize)}
              style={{
                padding: "8px 14px", background: diarize ? "rgba(0, 255, 136, 0.1)" : "transparent",
                border: `1px solid ${diarize ? "#00ff88" : "#1e2a3a"}`,
                color: diarize ? "#00ff88" : "#5a6a7a", fontFamily: "inherit", fontSize: "12px",
                cursor: "pointer", transition: "all 0.2s",
              }}
            >
              {diarize ? "[x]" : "[ ]"} Speaker diarization
            </button>
          </div>

          {/* Cost preview */}
          {(fileName || url) && (
            <div style={{ alignSelf: "flex-start" }}>
              <CostPreview type="stt" modelId="soniox" pricing={{ input: 0.35, output: 0, unit: "per_minute" }} durationSeconds={estimatedDurationSec || 60} />
            </div>
          )}

          {/* Transcribe button */}
          <button
            onClick={handleSubmit}
            disabled={loading}
            style={{
              alignSelf: "flex-start", padding: "8px 24px", background: "transparent",
              border: `1px solid ${loading ? "#5a6a7a" : "#00ff88"}`,
              color: loading ? "#5a6a7a" : "#00ff88", fontFamily: "inherit", fontSize: "13px",
              fontWeight: 700, cursor: loading ? "not-allowed" : "pointer",
              textTransform: "uppercase", letterSpacing: "0.1em", opacity: loading ? 0.5 : 1,
              transition: "all 0.2s",
            }}
            onMouseEnter={(e) => { if (!loading) { e.currentTarget.style.background = "rgba(0, 255, 136, 0.1)"; e.currentTarget.style.boxShadow = "0 0 15px rgba(0, 255, 136, 0.2)"; } }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.boxShadow = "none"; }}
          >
            {loading ? "[  PROCESSING...  ]" : "[  TRANSCRIBE  ]"}
          </button>

          {/* Error */}
          {error && (
            <div style={{ padding: "12px", backgroundColor: "rgba(255, 68, 68, 0.08)", border: "1px solid #ff4444", color: "#ff4444", fontSize: "13px" }}>
              <span style={{ fontWeight: 700 }}>[ERROR]</span> {error}
            </div>
          )}

          {/* Run status + stats */}
          {runId && (
            <div style={{ fontSize: "12px", color: "#5a6a7a", display: "flex", alignItems: "center", gap: "10px", padding: "8px 0", borderTop: "1px solid #1e2a3a" }}>
              <span><span style={{ color: "#ffcc00" }}>RUN:</span> <span style={{ color: "#e0e0e0" }}>{runId.slice(0, 8)}...</span></span>
              <StatusBadge status={status} />
            </div>
          )}
          {stats && (
            <div style={{ display: "flex", gap: "20px", fontSize: "12px", padding: "8px 0", borderTop: "1px solid #1e2a3a" }}>
              <span><span style={{ color: "#ffcc00" }}>DURATION:</span> <span style={{ color: "#00e5ff" }}>{stats.durationSeconds.toFixed(1)}s</span></span>
              <span><span style={{ color: "#ffcc00" }}>LATENCY:</span> <span style={{ color: "#00e5ff" }}>{(stats.latencyMs / 1000).toFixed(1)}s</span></span>
            </div>
          )}

          {/* Transcript output */}
          {transcript && (
            <div style={{ border: "1px solid #00ff88", backgroundColor: "#0d1117" }}>
              <div style={{ padding: "8px 12px", borderBottom: "1px solid #1e2a3a", fontSize: "11px", fontWeight: 700, color: "#00ff88", textTransform: "uppercase", letterSpacing: "0.1em", backgroundColor: "rgba(0, 255, 136, 0.05)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span>TRANSCRIPT:</span>
                {tokens && tokens.length > 0 && (
                  <button
                    onClick={() => {
                      const srt = generateSRT(tokens);
                      const blob = new Blob([srt], { type: "text/srt" });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = "transcript.srt";
                      a.click();
                      URL.revokeObjectURL(url);
                    }}
                    style={{ padding: "3px 10px", background: "transparent", border: "1px solid #00ff88", color: "#00ff88", fontFamily: "inherit", fontSize: "10px", cursor: "pointer", textTransform: "uppercase", letterSpacing: "0.05em" }}
                  >
                    Download SRT
                  </button>
                )}
              </div>
              <div style={{ padding: "16px", whiteSpace: "pre-wrap", fontSize: "13px", color: "#e0e0e0", lineHeight: "1.6" }}>
                {diarize && transcript.includes("[Speaker")
                  ? transcript.split("\n\n").map((block, i) => {
                      const match = block.match(/^\[(.+?)\]\s*/);
                      if (!match) return <div key={i}>{block}</div>;
                      const speaker = match[1];
                      const text = block.slice(match[0].length);
                      const colors = ["#00ff88", "#00e5ff", "#ffcc00", "#ff6b9d", "#b388ff", "#ff9800"];
                      const speakerNum = parseInt(speaker.replace(/\D/g, "") || "0");
                      const color = colors[speakerNum % colors.length];
                      return (
                        <div key={i} style={{ marginBottom: "12px" }}>
                          <span style={{ display: "inline-block", padding: "2px 8px", backgroundColor: `${color}20`, border: `1px solid ${color}`, color, fontSize: "10px", fontWeight: 700, borderRadius: "3px", marginBottom: "4px", marginRight: "8px" }}>
                            {speaker}
                          </span>
                          <span>{text}</span>
                        </div>
                      );
                    })
                  : transcript}
              </div>
            </div>
          )}

          {/* Translation output */}
          {translatedText && (
            <div style={{ border: "1px solid #00e5ff", backgroundColor: "#0d1117" }}>
              <div style={{ padding: "8px 12px", borderBottom: "1px solid #1e2a3a", fontSize: "11px", fontWeight: 700, color: "#00e5ff", textTransform: "uppercase", letterSpacing: "0.1em", backgroundColor: "rgba(0, 229, 255, 0.05)" }}>
                TRANSLATION:
              </div>
              <div style={{ padding: "16px", whiteSpace: "pre-wrap", fontSize: "13px", color: "#e0e0e0", lineHeight: "1.6" }}>
                {translatedText}
              </div>
            </div>
          )}

          {/* LLM Action Buttons */}
          {transcript && (
            <div>
              <div style={{ fontSize: "11px", fontWeight: 700, color: "#ffcc00", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "8px" }}>
                ACTIONS → LLM:
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                {actionButtons.map((btn) => (
                  <button
                    key={btn.label}
                    onClick={() => runLLMAction(btn.prompt, btn.label)}
                    disabled={!!actionLoading}
                    style={{
                      padding: "6px 14px", background: "transparent",
                      border: `1px solid ${actionLoading === btn.label ? "#00e5ff" : "#00e5ff"}`,
                      color: actionLoading === btn.label ? "#00e5ff" : "#00e5ff",
                      fontFamily: "inherit", fontSize: "11px", cursor: actionLoading ? "not-allowed" : "pointer",
                      opacity: actionLoading && actionLoading !== btn.label ? 0.4 : 1,
                      transition: "all 0.2s",
                    }}
                    onMouseEnter={(e) => { if (!actionLoading) { e.currentTarget.style.background = "rgba(0, 229, 255, 0.1)"; e.currentTarget.style.boxShadow = "0 0 10px rgba(0, 229, 255, 0.15)"; } }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.boxShadow = "none"; }}
                  >
                    {actionLoading === btn.label ? "[ PROCESSING... ]" : btn.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* LLM Action Result */}
          {actionResult && (
            <div style={{ border: "1px solid #00e5ff", backgroundColor: "#0d1117" }}>
              <div style={{ padding: "8px 12px", borderBottom: "1px solid #1e2a3a", fontSize: "11px", fontWeight: 700, color: "#00e5ff", textTransform: "uppercase", letterSpacing: "0.1em", backgroundColor: "rgba(0, 229, 255, 0.05)" }}>
                {actionLabel || "LLM RESULT"}:
              </div>
              <div style={{ padding: "16px", whiteSpace: "pre-wrap", fontSize: "13px", color: "#e0e0e0", lineHeight: "1.6" }}>
                {actionResult}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
