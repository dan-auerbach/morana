"use client";

import { useSession } from "next-auth/react";
import { useState, useEffect, useCallback } from "react";
import StatusBadge from "../components/StatusBadge";

type Voice = { id: string; name: string };
type HistoryRun = {
  id: string;
  status: string;
  createdAt: string;
  model: string;
  preview?: string;
};

export default function TTSPage() {
  const { data: session } = useSession();
  const [voices, setVoices] = useState<Voice[]>([]);
  const [voiceId, setVoiceId] = useState("");
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [runId, setRunId] = useState("");
  const [status, setStatus] = useState("");
  const [audioUrl, setAudioUrl] = useState("");
  const [stats, setStats] = useState<{ latencyMs: number; chars: number } | null>(null);

  // History sidebar
  const [history, setHistory] = useState<HistoryRun[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  useEffect(() => {
    fetch("/api/voices")
      .then((r) => r.json())
      .then((d) => {
        setVoices(d.voices || []);
        if (d.voices?.length) setVoiceId(d.voices[0].id);
      });
  }, []);

  const loadHistory = useCallback(() => {
    fetch("/api/history?type=tts&limit=50")
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
    setAudioUrl("");
    setStatus("running");
    setStats(null);

    try {
      const resp = await fetch("/api/runs/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, voiceId }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "Request failed");
      setRunId(data.runId);
      setStatus(data.status);
      if (data.audioUrl) setAudioUrl(data.audioUrl);
      if (data.latencyMs) setStats({ latencyMs: data.latencyMs, chars: data.chars });
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
      setRunId(data.id);
      setStatus(data.status);
      setError("");
      if (data.input?.text) setText(data.input.text);
      if (data.input?.voiceId) setVoiceId(data.input.voiceId);
      if (data.output?.audioUrl) {
        setAudioUrl(data.output.audioUrl);
      }
      if (data.output?.latencyMs) {
        setStats({ latencyMs: data.output.latencyMs, chars: data.output.chars || 0 });
      }
      if (data.errorMessage) {
        setError(data.errorMessage);
        setAudioUrl("");
      }
    } catch {
      // ignore
    }
  }

  const selectedVoice = voices.find((v) => v.id === voiceId);
  const cmdLine = `$ tts --voice ${selectedVoice?.name?.toLowerCase().replace(/\s+/g, "-") || "..."} --synthesize`;
  const charPercent = Math.min((text.length / 10000) * 100, 100);
  const charColor = charPercent > 90 ? "#ff4444" : charPercent > 70 ? "#ffcc00" : "#5a6a7a";

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
          TTS History
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
            <div style={{ color: "#333", fontSize: "11px", textAlign: "center", padding: "20px 0" }}>No TTS runs yet</div>
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
          <span style={{ color: "#00ff88", fontSize: "14px", fontWeight: 700 }}>[TTS]</span>
          <span style={{ color: "#5a6a7a", fontSize: "12px" }}>{cmdLine}</span>
        </div>

        {/* Content */}
        <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "16px" }}>
          {/* Text input */}
          <div>
            <label style={{ display: "block", marginBottom: "6px", fontSize: "11px", fontWeight: 700, color: "#00ff88", textTransform: "uppercase", letterSpacing: "0.1em" }}>--text</label>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={5}
              placeholder="Enter text to synthesize..."
              style={{ width: "100%", padding: "8px 12px", backgroundColor: "#111820", border: "1px solid #1e2a3a", color: "#e0e0e0", fontFamily: "inherit", fontSize: "13px", resize: "vertical" }}
            />
            <div style={{ marginTop: "6px", fontSize: "11px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ color: charColor }}>
                <span style={{ color: "#ffcc00" }}>CHARS:</span> {text.length.toLocaleString()} / 10,000
              </span>
              <div style={{ width: "120px", height: "4px", backgroundColor: "#1e2a3a", overflow: "hidden" }}>
                <div style={{ width: `${charPercent}%`, height: "100%", backgroundColor: charColor === "#ff4444" ? "#ff4444" : charColor === "#ffcc00" ? "#ffcc00" : "#00ff88", transition: "width 0.2s" }} />
              </div>
            </div>
          </div>

          {/* Voice select */}
          <div>
            <label style={{ display: "block", marginBottom: "6px", fontSize: "11px", fontWeight: 700, color: "#00ff88", textTransform: "uppercase", letterSpacing: "0.1em" }}>--voice</label>
            <select
              value={voiceId}
              onChange={(e) => setVoiceId(e.target.value)}
              style={{ width: "100%", padding: "8px 12px", backgroundColor: "#111820", border: "1px solid #1e2a3a", color: "#e0e0e0", fontFamily: "inherit", fontSize: "13px" }}
            >
              {voices.map((v) => (
                <option key={v.id} value={v.id}>{v.name}</option>
              ))}
            </select>
          </div>

          {/* Synthesize button */}
          <button
            onClick={handleSubmit}
            disabled={loading || !text || !voiceId}
            style={{
              alignSelf: "flex-start", padding: "8px 24px", background: "transparent",
              border: `1px solid ${loading ? "#5a6a7a" : "#00ff88"}`,
              color: loading ? "#5a6a7a" : "#00ff88", fontFamily: "inherit", fontSize: "13px",
              fontWeight: 700, cursor: loading || !text || !voiceId ? "not-allowed" : "pointer",
              textTransform: "uppercase", letterSpacing: "0.1em",
              opacity: loading || !text || !voiceId ? 0.5 : 1, transition: "all 0.2s",
            }}
            onMouseEnter={(e) => { if (!loading && text && voiceId) { e.currentTarget.style.background = "rgba(0, 255, 136, 0.1)"; e.currentTarget.style.boxShadow = "0 0 15px rgba(0, 255, 136, 0.2)"; } }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.boxShadow = "none"; }}
          >
            {loading ? "[  PROCESSING...  ]" : "[  SYNTHESIZE  ]"}
          </button>

          {/* Error */}
          {error && (
            <div style={{ padding: "12px", backgroundColor: "rgba(255, 68, 68, 0.08)", border: "1px solid #ff4444", color: "#ff4444", fontSize: "13px" }}>
              <span style={{ fontWeight: 700 }}>[ERROR]</span> {error}
            </div>
          )}

          {/* Run status */}
          {runId && (
            <div style={{ fontSize: "12px", color: "#5a6a7a", display: "flex", alignItems: "center", gap: "10px", padding: "8px 0", borderTop: "1px solid #1e2a3a" }}>
              <span><span style={{ color: "#ffcc00" }}>RUN:</span> <span style={{ color: "#e0e0e0" }}>{runId.slice(0, 8)}...</span></span>
              <StatusBadge status={status} />
            </div>
          )}

          {/* Stats */}
          {stats && (
            <div style={{ display: "flex", gap: "20px", fontSize: "12px", padding: "8px 0", borderTop: "1px solid #1e2a3a" }}>
              <span><span style={{ color: "#ffcc00" }}>CHARS:</span> <span style={{ color: "#00e5ff" }}>{stats.chars}</span></span>
              <span><span style={{ color: "#ffcc00" }}>LATENCY:</span> <span style={{ color: "#00e5ff" }}>{(stats.latencyMs / 1000).toFixed(1)}s</span></span>
            </div>
          )}

          {/* Audio output */}
          {audioUrl && (
            <div style={{ border: "1px solid #00ff88", backgroundColor: "#0d1117" }}>
              <div style={{ padding: "8px 12px", borderBottom: "1px solid #1e2a3a", fontSize: "11px", fontWeight: 700, color: "#00ff88", textTransform: "uppercase", letterSpacing: "0.1em", backgroundColor: "rgba(0, 255, 136, 0.05)" }}>
                AUDIO OUTPUT:
              </div>
              <div style={{ padding: "16px" }}>
                <audio controls src={audioUrl} style={{ width: "100%", height: "40px", filter: "hue-rotate(100deg) saturate(1.5)" }} />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
