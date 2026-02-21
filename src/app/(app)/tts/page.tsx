"use client";

import { useSession } from "next-auth/react";
import { useState, useEffect, useCallback } from "react";
import StatusBadge from "@/app/components/StatusBadge";
import CostPreview from "@/app/components/CostPreview";

type Voice = { id: string; name: string };
type HistoryRun = {
  id: string;
  status: string;
  createdAt: string;
  model: string;
  preview?: string;
};

const TTS_MODELS = [
  { id: "eleven_v3",              label: "Eleven v3",          langs: "70+", charLimit: 5000 },
  { id: "eleven_flash_v2_5",     label: "Flash v2.5 (fast)",  langs: "32",  charLimit: 40000 },
  { id: "eleven_multilingual_v2", label: "Multilingual v2",    langs: "29",  charLimit: 10000 },
  { id: "eleven_turbo_v2_5",     label: "Turbo v2.5",         langs: "32",  charLimit: 40000 },
];

const OUTPUT_FORMATS = [
  { id: "mp3_44100_128", label: "MP3 HQ (128kbps)" },
  { id: "mp3_22050_32",  label: "MP3 LQ (32kbps)" },
  { id: "pcm_24000",     label: "PCM (WAV)" },
  { id: "opus_48000_128", label: "Opus (128kbps)" },
];

const LABEL_STYLE: React.CSSProperties = {
  display: "block", marginBottom: "6px", fontSize: "11px",
  fontWeight: 700, color: "var(--green)", textTransform: "uppercase",
  letterSpacing: "0.1em",
};

const INPUT_STYLE: React.CSSProperties = {
  width: "100%", padding: "8px 12px", backgroundColor: "var(--bg-input)",
  border: "1px solid var(--border)", color: "var(--white)",
  fontFamily: "inherit", fontSize: "13px",
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

  // New settings
  const [modelId, setModelId] = useState("eleven_v3");
  const [outputFormat, setOutputFormat] = useState("mp3_44100_128");
  const [languageCode, setLanguageCode] = useState("");
  const [stability, setStability] = useState(0.5);
  const [similarityBoost, setSimilarityBoost] = useState(0.75);
  const [style, setStyle] = useState(0);
  const [speed, setSpeed] = useState(1.0);
  const [showSettings, setShowSettings] = useState(false);

  // SFX mode
  const [mode, setMode] = useState<"tts" | "sfx">("tts");
  const [sfxPrompt, setSfxPrompt] = useState("");
  const [sfxDuration, setSfxDuration] = useState(5);
  const [sfxInfluence, setSfxInfluence] = useState(0.3);

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
      <div style={{ color: "var(--gray)" }}>
        <span style={{ color: "var(--red)" }}>[ERROR]</span> Authentication required.
      </div>
    );
  }

  const currentModel = TTS_MODELS.find((m) => m.id === modelId) || TTS_MODELS[0];
  const charLimit = currentModel.charLimit;
  const charPercent = Math.min((text.length / charLimit) * 100, 100);
  const charColor = charPercent > 90 ? "var(--red)" : charPercent > 70 ? "var(--yellow)" : "var(--gray)";

  async function handleTTSSubmit() {
    setLoading(true);
    setError("");
    setAudioUrl("");
    setStatus("running");
    setStats(null);

    try {
      const resp = await fetch("/api/runs/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          voiceId,
          modelId,
          outputFormat,
          ...(languageCode && { languageCode }),
          voiceSettings: { stability, similarityBoost: similarityBoost, style, speed },
        }),
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

  async function handleSFXSubmit() {
    setLoading(true);
    setError("");
    setAudioUrl("");
    setStatus("running");
    setStats(null);

    try {
      const resp = await fetch("/api/runs/sfx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: sfxPrompt,
          durationSeconds: sfxDuration,
          promptInfluence: sfxInfluence,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "Request failed");
      setRunId(data.runId);
      setStatus(data.status);
      if (data.audioUrl) setAudioUrl(data.audioUrl);
      if (data.latencyMs) setStats({ latencyMs: data.latencyMs, chars: sfxPrompt.length });
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
      setAudioUrl("");
      if (data.input?.text) setText(data.input.text);
      if (data.input?.voiceId) setVoiceId(data.input.voiceId);
      if (data.input?.modelId) setModelId(data.input.modelId);
      if (data.input?.outputFormat) setOutputFormat(data.input.outputFormat);
      if (data.input?.languageCode) setLanguageCode(data.input.languageCode);
      if (data.input?.voiceSettings) {
        const vs = data.input.voiceSettings;
        if (vs.stability !== undefined) setStability(vs.stability);
        if (vs.similarityBoost !== undefined) setSimilarityBoost(vs.similarityBoost);
        if (vs.style !== undefined) setStyle(vs.style);
        if (vs.speed !== undefined) setSpeed(vs.speed);
      }
      // Audio URL via proxy endpoint
      const audioFile = data.files?.find((f: { id: string; mime: string }) => f.mime?.startsWith("audio/"));
      if (audioFile) {
        setAudioUrl(`/api/files/${audioFile.id}`);
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
  const cmdLine = mode === "tts"
    ? `$ tts --voice ${selectedVoice?.name?.toLowerCase().replace(/\s+/g, "-") || "..."} --model ${modelId} --synthesize`
    : `$ sfx --generate --duration ${sfxDuration}s`;

  return (
    <div className="page-with-sidebar" style={{ display: "flex", gap: "0", margin: "-24px -16px", height: "calc(100vh - 57px)" }}>
      {/* History sidebar */}
      <div
        className="page-sidebar"
        style={{
          width: sidebarOpen ? "240px" : "0px",
          minWidth: sidebarOpen ? "240px" : "0px",
          borderRight: sidebarOpen ? "1px solid var(--border)" : "none",
          backgroundColor: "var(--bg)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          transition: "all 0.2s",
        }}
      >
        <div style={{ padding: "12px", fontSize: "11px", fontWeight: 700, color: "var(--yellow)", textTransform: "uppercase", letterSpacing: "0.1em", borderBottom: "1px solid var(--border)" }}>
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
              <div style={{ color: r.id === runId ? "var(--white)" : "var(--text-secondary)", fontSize: "11px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginBottom: "3px" }}>
                {r.preview || r.id.slice(0, 16) + "..."}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <span style={{ color: "var(--dim)", fontSize: "9px" }}>
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
        <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--border)", backgroundColor: "var(--bg-panel)", display: "flex", alignItems: "center", gap: "12px", flexShrink: 0 }}>
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            style={{ background: "transparent", border: "1px solid var(--border)", color: "var(--gray)", cursor: "pointer", padding: "4px 8px", fontFamily: "inherit", fontSize: "12px" }}
          >
            {sidebarOpen ? "<<" : ">>"}
          </button>
          <span style={{ color: "var(--green)", fontSize: "14px", fontWeight: 700 }}>[TTS]</span>

          {/* Mode toggle */}
          <div style={{ display: "flex", gap: "0" }}>
            {(["tts", "sfx"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                style={{
                  padding: "4px 12px", fontFamily: "inherit", fontSize: "11px",
                  fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em",
                  border: `1px solid ${mode === m ? (m === "sfx" ? "#ff8800" : "var(--green)") : "var(--border)"}`,
                  background: mode === m ? (m === "sfx" ? "rgba(255, 136, 0, 0.1)" : "rgba(0, 255, 136, 0.1)") : "transparent",
                  color: mode === m ? (m === "sfx" ? "#ff8800" : "var(--green)") : "var(--gray)",
                  cursor: "pointer",
                  borderRadius: m === "tts" ? "3px 0 0 3px" : "0 3px 3px 0",
                  marginLeft: m === "sfx" ? "-1px" : "0",
                }}
              >
                {m === "tts" ? "Speech" : "SFX"}
              </button>
            ))}
          </div>

          <span style={{ color: "var(--gray)", fontSize: "12px" }}>{cmdLine}</span>
        </div>

        {/* Content */}
        <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "16px" }}>

          {mode === "tts" ? (
            <>
              {/* Text input */}
              <div>
                <label style={LABEL_STYLE}>--text</label>
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  rows={5}
                  placeholder="Enter text to synthesize..."
                  style={{ ...INPUT_STYLE, resize: "vertical" }}
                />
                <div style={{ marginTop: "6px", fontSize: "11px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ color: charColor }}>
                    <span style={{ color: "var(--yellow)" }}>CHARS:</span> {text.length.toLocaleString()} / {charLimit.toLocaleString()}
                  </span>
                  <div style={{ width: "120px", height: "4px", backgroundColor: "var(--border)", overflow: "hidden" }}>
                    <div style={{ width: `${charPercent}%`, height: "100%", backgroundColor: charColor === "var(--red)" ? "var(--red)" : charColor === "var(--yellow)" ? "var(--yellow)" : "var(--green)", transition: "width 0.2s" }} />
                  </div>
                </div>
              </div>

              {/* Voice + Model row */}
              <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
                <div style={{ flex: "1 1 200px" }}>
                  <label style={LABEL_STYLE}>--voice</label>
                  <select value={voiceId} onChange={(e) => setVoiceId(e.target.value)} style={INPUT_STYLE}>
                    {voices.map((v) => (
                      <option key={v.id} value={v.id}>{v.name}</option>
                    ))}
                  </select>
                </div>
                <div style={{ flex: "1 1 200px" }}>
                  <label style={LABEL_STYLE}>--model</label>
                  <select value={modelId} onChange={(e) => setModelId(e.target.value)} style={INPUT_STYLE}>
                    {TTS_MODELS.map((m) => (
                      <option key={m.id} value={m.id}>{m.label} ({m.langs} langs)</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Output format + Language row */}
              <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
                <div style={{ flex: "1 1 200px" }}>
                  <label style={LABEL_STYLE}>--format</label>
                  <select value={outputFormat} onChange={(e) => setOutputFormat(e.target.value)} style={INPUT_STYLE}>
                    {OUTPUT_FORMATS.map((f) => (
                      <option key={f.id} value={f.id}>{f.label}</option>
                    ))}
                  </select>
                </div>
                <div style={{ flex: "1 1 200px" }}>
                  <label style={LABEL_STYLE}>--lang <span style={{ color: "var(--gray)", fontWeight: 400 }}>(optional)</span></label>
                  <input
                    value={languageCode}
                    onChange={(e) => setLanguageCode(e.target.value)}
                    placeholder="e.g. sl, en, de"
                    style={INPUT_STYLE}
                    maxLength={5}
                  />
                </div>
              </div>

              {/* Voice Settings (collapsible) */}
              <div style={{ border: "1px solid var(--border)", backgroundColor: "var(--bg)" }}>
                <button
                  onClick={() => setShowSettings(!showSettings)}
                  style={{
                    width: "100%", padding: "8px 12px",
                    background: "transparent", border: "none",
                    color: "var(--gray)", fontFamily: "inherit", fontSize: "11px",
                    fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em",
                    cursor: "pointer", textAlign: "left",
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                  }}
                >
                  <span>Voice Settings</span>
                  <span style={{ color: "var(--green)" }}>{showSettings ? "[-]" : "[+]"}</span>
                </button>

                {showSettings && (
                  <div style={{ padding: "12px", borderTop: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: "14px" }}>
                    {/* Stability */}
                    <SliderControl
                      label="--stability"
                      value={stability}
                      onChange={setStability}
                      min={0} max={1} step={0.05}
                      description="Lower = more expressive, Higher = more consistent"
                    />

                    {/* Similarity Boost */}
                    <SliderControl
                      label="--similarity"
                      value={similarityBoost}
                      onChange={setSimilarityBoost}
                      min={0} max={1} step={0.05}
                      description="How closely to match original voice"
                    />

                    {/* Style */}
                    <SliderControl
                      label="--style"
                      value={style}
                      onChange={setStyle}
                      min={0} max={1} step={0.05}
                      description="Style exaggeration (recommended: 0)"
                    />

                    {/* Speed */}
                    <SliderControl
                      label="--speed"
                      value={speed}
                      onChange={setSpeed}
                      min={0.7} max={1.2} step={0.05}
                      description="Speech rate multiplier"
                    />

                    <button
                      onClick={() => { setStability(0.5); setSimilarityBoost(0.75); setStyle(0); setSpeed(1.0); }}
                      style={{
                        alignSelf: "flex-start", padding: "4px 12px",
                        background: "transparent", border: "1px solid var(--border)",
                        color: "var(--gray)", fontFamily: "inherit", fontSize: "10px",
                        cursor: "pointer", textTransform: "uppercase",
                      }}
                    >
                      Reset Defaults
                    </button>
                  </div>
                )}
              </div>

              {/* Cost preview */}
              {text.length > 0 && (
                <div style={{ alignSelf: "flex-start" }}>
                  <CostPreview type="tts" modelId="elevenlabs" pricing={{ input: 0.30, output: 0, unit: "1k_chars" }} charCount={text.length} />
                </div>
              )}

              {/* Synthesize button */}
              <button
                onClick={handleTTSSubmit}
                disabled={loading || !text || !voiceId}
                style={{
                  alignSelf: "flex-start", padding: "8px 24px", background: "transparent",
                  border: `1px solid ${loading ? "var(--gray)" : "var(--green)"}`,
                  color: loading ? "var(--gray)" : "var(--green)", fontFamily: "inherit", fontSize: "13px",
                  fontWeight: 700, cursor: loading || !text || !voiceId ? "not-allowed" : "pointer",
                  textTransform: "uppercase", letterSpacing: "0.1em",
                  opacity: loading || !text || !voiceId ? 0.5 : 1, transition: "all 0.2s",
                }}
                onMouseEnter={(e) => { if (!loading && text && voiceId) { e.currentTarget.style.background = "rgba(0, 255, 136, 0.1)"; e.currentTarget.style.boxShadow = "0 0 15px rgba(0, 255, 136, 0.2)"; } }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.boxShadow = "none"; }}
              >
                {loading ? "[  PROCESSING...  ]" : "[  SYNTHESIZE  ]"}
              </button>
            </>
          ) : (
            /* ====== SFX MODE ====== */
            <>
              {/* SFX Prompt */}
              <div>
                <label style={LABEL_STYLE}>--prompt</label>
                <textarea
                  value={sfxPrompt}
                  onChange={(e) => setSfxPrompt(e.target.value)}
                  rows={3}
                  placeholder="Describe the sound effect... e.g. 'thunderstorm with heavy rain and distant thunder'"
                  style={{ ...INPUT_STYLE, resize: "vertical" }}
                />
                <div style={{ marginTop: "4px", fontSize: "10px", color: "var(--gray)" }}>
                  {sfxPrompt.length} / 1,000 chars
                </div>
              </div>

              {/* Duration + Influence row */}
              <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
                <div style={{ flex: "1 1 200px" }}>
                  <SliderControl
                    label="--duration"
                    value={sfxDuration}
                    onChange={setSfxDuration}
                    min={0.5} max={30} step={0.5}
                    description="Duration in seconds"
                    suffix="s"
                  />
                </div>
                <div style={{ flex: "1 1 200px" }}>
                  <SliderControl
                    label="--influence"
                    value={sfxInfluence}
                    onChange={setSfxInfluence}
                    min={0} max={1} step={0.05}
                    description="Prompt adherence (0=creative, 1=strict)"
                  />
                </div>
              </div>

              {/* Generate button */}
              <button
                onClick={handleSFXSubmit}
                disabled={loading || !sfxPrompt}
                style={{
                  alignSelf: "flex-start", padding: "8px 24px", background: "transparent",
                  border: `1px solid ${loading ? "var(--gray)" : "#ff8800"}`,
                  color: loading ? "var(--gray)" : "#ff8800", fontFamily: "inherit", fontSize: "13px",
                  fontWeight: 700, cursor: loading || !sfxPrompt ? "not-allowed" : "pointer",
                  textTransform: "uppercase", letterSpacing: "0.1em",
                  opacity: loading || !sfxPrompt ? 0.5 : 1, transition: "all 0.2s",
                }}
                onMouseEnter={(e) => { if (!loading && sfxPrompt) { e.currentTarget.style.background = "rgba(255, 136, 0, 0.1)"; e.currentTarget.style.boxShadow = "0 0 15px rgba(255, 136, 0, 0.2)"; } }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.boxShadow = "none"; }}
              >
                {loading ? "[  GENERATING...  ]" : "[  GENERATE SFX  ]"}
              </button>
            </>
          )}

          {/* Error */}
          {error && (
            <div style={{ padding: "12px", backgroundColor: "rgba(255, 68, 68, 0.08)", border: "1px solid var(--red)", color: "var(--red)", fontSize: "13px" }}>
              <span style={{ fontWeight: 700 }}>[ERROR]</span> {error}
            </div>
          )}

          {/* Run status */}
          {runId && (
            <div style={{ fontSize: "12px", color: "var(--gray)", display: "flex", alignItems: "center", gap: "10px", padding: "8px 0", borderTop: "1px solid var(--border)" }}>
              <span><span style={{ color: "var(--yellow)" }}>RUN:</span> <span style={{ color: "var(--white)" }}>{runId.slice(0, 8)}...</span></span>
              <StatusBadge status={status} />
            </div>
          )}

          {/* Stats */}
          {stats && (
            <div style={{ display: "flex", gap: "20px", fontSize: "12px", padding: "8px 0", borderTop: "1px solid var(--border)" }}>
              <span><span style={{ color: "var(--yellow)" }}>CHARS:</span> <span style={{ color: "var(--cyan)" }}>{stats.chars}</span></span>
              <span><span style={{ color: "var(--yellow)" }}>LATENCY:</span> <span style={{ color: "var(--cyan)" }}>{(stats.latencyMs / 1000).toFixed(1)}s</span></span>
            </div>
          )}

          {/* Audio output */}
          {audioUrl && (
            <div style={{ border: `1px solid ${mode === "sfx" ? "#ff8800" : "var(--green)"}`, backgroundColor: "var(--bg-panel)" }}>
              <div style={{
                padding: "8px 12px", borderBottom: "1px solid var(--border)",
                fontSize: "11px", fontWeight: 700,
                color: mode === "sfx" ? "#ff8800" : "var(--green)",
                textTransform: "uppercase", letterSpacing: "0.1em",
                backgroundColor: mode === "sfx" ? "rgba(255, 136, 0, 0.05)" : "rgba(0, 255, 136, 0.05)",
              }}>
                {mode === "sfx" ? "SFX OUTPUT:" : "AUDIO OUTPUT:"}
              </div>
              <div style={{ padding: "16px" }}>
                <audio controls src={audioUrl} style={{ width: "100%", height: "40px", filter: mode === "sfx" ? "hue-rotate(30deg) saturate(1.5)" : "hue-rotate(100deg) saturate(1.5)" }} />
              </div>
              {audioUrl.startsWith("/api/files/") && (
                <div style={{ padding: "0 16px 12px", textAlign: "right" }}>
                  <a
                    href={audioUrl}
                    download={mode === "sfx" ? "sound-effect.mp3" : "speech.mp3"}
                    style={{ color: "var(--gray)", fontSize: "10px", textDecoration: "none" }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = "var(--green)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = "var(--gray)"; }}
                  >
                    [DOWNLOAD]
                  </a>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Slider Component                                                   */
/* ------------------------------------------------------------------ */

function SliderControl({
  label, value, onChange, min, max, step, description, suffix,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
  description: string;
  suffix?: string;
}) {
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "4px" }}>
        <label style={{ fontSize: "11px", fontWeight: 700, color: "var(--green)", textTransform: "uppercase", letterSpacing: "0.1em" }}>
          {label}
        </label>
        <span style={{ fontSize: "12px", color: "var(--cyan)", fontFamily: "inherit" }}>
          {value.toFixed(step < 1 ? 2 : 1)}{suffix || ""}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{
          width: "100%", height: "4px",
          WebkitAppearance: "none", appearance: "none",
          background: `linear-gradient(to right, var(--green) 0%, var(--green) ${((value - min) / (max - min)) * 100}%, var(--border) ${((value - min) / (max - min)) * 100}%, var(--border) 100%)`,
          outline: "none", cursor: "pointer",
          borderRadius: "2px",
        }}
      />
      <div style={{ fontSize: "9px", color: "var(--dim)", marginTop: "2px" }}>{description}</div>
    </div>
  );
}
