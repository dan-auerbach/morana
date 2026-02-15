"use client";

import { useSession } from "next-auth/react";
import { useState, useRef, useEffect, useCallback } from "react";
import StatusBadge from "../components/StatusBadge";

type HistoryRun = {
  id: string;
  status: string;
  createdAt: string;
  model: string;
  preview?: string;
};

export default function ImagePage() {
  const { data: session } = useSession();
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [runId, setRunId] = useState("");
  const [status, setStatus] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [responseText, setResponseText] = useState("");
  const [stats, setStats] = useState<{ latencyMs: number } | null>(null);

  // Image upload
  const [uploadedImage, setUploadedImage] = useState<string | null>(null);
  const [uploadedImageName, setUploadedImageName] = useState("");
  const [uploadedImageMime, setUploadedImageMime] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  // History sidebar
  const [history, setHistory] = useState<HistoryRun[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const loadHistory = useCallback(() => {
    fetch("/api/history?type=image&limit=50")
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

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const allowedTypes = ["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"];
    if (!allowedTypes.includes(file.type)) {
      setError(`Unsupported format: ${file.type}. Use PNG, JPEG, WebP, or GIF.`);
      return;
    }

    if (file.size > 20 * 1024 * 1024) {
      setError("Image exceeds 20MB limit");
      return;
    }

    setUploadedImageName(file.name);
    setUploadedImageMime(file.type);
    setError("");

    const reader = new FileReader();
    reader.onload = () => {
      setUploadedImage(reader.result as string);
    };
    reader.readAsDataURL(file);
  }

  function removeUploadedImage() {
    setUploadedImage(null);
    setUploadedImageName("");
    setUploadedImageMime("");
    if (fileRef.current) fileRef.current.value = "";
  }

  async function handleSubmit() {
    if (!prompt.trim() || loading) return;
    setLoading(true);
    setError("");
    setImageUrl("");
    setResponseText("");
    setStatus("running");
    setStats(null);

    try {
      const formData = new FormData();
      formData.append("prompt", prompt);

      // If there's an uploaded image, convert data URI back to blob
      if (uploadedImage && uploadedImageMime) {
        const base64Data = uploadedImage.split(",")[1];
        const binaryStr = atob(base64Data);
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) {
          bytes[i] = binaryStr.charCodeAt(i);
        }
        const blob = new Blob([bytes], { type: uploadedImageMime });
        formData.append("image", blob, uploadedImageName || "image.png");
      }

      const resp = await fetch("/api/runs/image", {
        method: "POST",
        body: formData,
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "Request failed");

      setRunId(data.runId);
      setStatus(data.status);
      if (data.imageUrl) setImageUrl(data.imageUrl);
      if (data.text) setResponseText(data.text);
      if (data.latencyMs) setStats({ latencyMs: data.latencyMs });
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
      setImageUrl("");
      setResponseText("");
      if (data.input?.prompt) setPrompt(data.input.prompt);
      if (data.output?.text) setResponseText(data.output.text);
      if (data.output?.latencyMs) setStats({ latencyMs: data.output.latencyMs });
      // Load image from R2 signed URL if available
      if (data.files?.length > 0 && data.files[0].url) {
        setImageUrl(data.files[0].url);
      }
      if (data.errorMessage) {
        setError(data.errorMessage);
      }
    } catch {
      // ignore
    }
  }

  const charPercent = Math.min((prompt.length / 10000) * 100, 100);
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
          Image History
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
            <div style={{ color: "#333", fontSize: "11px", textAlign: "center", padding: "20px 0" }}>No image runs yet</div>
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
          <span style={{ color: "#00ff88", fontSize: "14px", fontWeight: 700 }}>[IMAGE]</span>
          <span style={{ color: "#5a6a7a", fontSize: "12px" }}>$ image --model gemini-2.5-flash --generate</span>
        </div>

        {/* Content */}
        <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "16px" }}>
          {/* Prompt input */}
          <div>
            <label style={{ display: "block", marginBottom: "6px", fontSize: "11px", fontWeight: 700, color: "#00ff88", textTransform: "uppercase", letterSpacing: "0.1em" }}>--prompt</label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={4}
              placeholder="Describe the image to generate, or instructions for editing the uploaded image..."
              style={{ width: "100%", padding: "8px 12px", backgroundColor: "#111820", border: "1px solid #1e2a3a", color: "#e0e0e0", fontFamily: "inherit", fontSize: "13px", resize: "vertical" }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
            />
            <div style={{ marginTop: "6px", fontSize: "11px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ color: charColor }}>
                <span style={{ color: "#ffcc00" }}>CHARS:</span> {prompt.length.toLocaleString()} / 10,000
              </span>
              <div style={{ width: "120px", height: "4px", backgroundColor: "#1e2a3a", overflow: "hidden" }}>
                <div style={{ width: `${charPercent}%`, height: "100%", backgroundColor: charColor === "#ff4444" ? "#ff4444" : charColor === "#ffcc00" ? "#ffcc00" : "#00ff88", transition: "width 0.2s" }} />
              </div>
            </div>
          </div>

          {/* Image upload */}
          <div>
            <label style={{ display: "block", marginBottom: "6px", fontSize: "11px", fontWeight: 700, color: "#00ff88", textTransform: "uppercase", letterSpacing: "0.1em" }}>--input-image <span style={{ color: "#5a6a7a", fontWeight: 400, textTransform: "none" }}>(optional, for editing)</span></label>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              onChange={handleFileSelect}
              style={{ display: "none" }}
            />
            {!uploadedImage ? (
              <button
                onClick={() => fileRef.current?.click()}
                style={{
                  padding: "10px 20px",
                  background: "transparent",
                  border: "1px dashed #1e2a3a",
                  color: "#5a6a7a",
                  fontFamily: "inherit",
                  fontSize: "12px",
                  cursor: "pointer",
                  width: "100%",
                  textAlign: "center",
                  transition: "all 0.2s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = "rgba(0, 255, 136, 0.4)";
                  e.currentTarget.style.color = "#00ff88";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = "#1e2a3a";
                  e.currentTarget.style.color = "#5a6a7a";
                }}
              >
                [  UPLOAD IMAGE  ] — PNG, JPEG, WebP, GIF (max 20MB)
              </button>
            ) : (
              <div style={{ border: "1px solid #1e2a3a", backgroundColor: "#111820", padding: "12px", display: "flex", alignItems: "center", gap: "12px" }}>
                <img
                  src={uploadedImage}
                  alt="Uploaded"
                  style={{ width: "80px", height: "80px", objectFit: "cover", border: "1px solid #1e2a3a" }}
                />
                <div style={{ flex: 1 }}>
                  <div style={{ color: "#e0e0e0", fontSize: "12px" }}>{uploadedImageName}</div>
                  <div style={{ color: "#5a6a7a", fontSize: "11px", marginTop: "2px" }}>{uploadedImageMime}</div>
                </div>
                <button
                  onClick={removeUploadedImage}
                  style={{
                    background: "transparent",
                    border: "1px solid rgba(255, 68, 68, 0.3)",
                    color: "#ff4444",
                    padding: "4px 10px",
                    fontFamily: "inherit",
                    fontSize: "11px",
                    cursor: "pointer",
                    textTransform: "uppercase",
                  }}
                >
                  Remove
                </button>
              </div>
            )}
          </div>

          {/* Generate button */}
          <button
            onClick={handleSubmit}
            disabled={loading || !prompt.trim()}
            style={{
              alignSelf: "flex-start", padding: "8px 24px", background: "transparent",
              border: `1px solid ${loading ? "#5a6a7a" : "#00ff88"}`,
              color: loading ? "#5a6a7a" : "#00ff88", fontFamily: "inherit", fontSize: "13px",
              fontWeight: 700, cursor: loading || !prompt.trim() ? "not-allowed" : "pointer",
              textTransform: "uppercase", letterSpacing: "0.1em",
              opacity: loading || !prompt.trim() ? 0.5 : 1, transition: "all 0.2s",
            }}
            onMouseEnter={(e) => { if (!loading && prompt.trim()) { e.currentTarget.style.background = "rgba(0, 255, 136, 0.1)"; e.currentTarget.style.boxShadow = "0 0 15px rgba(0, 255, 136, 0.2)"; } }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.boxShadow = "none"; }}
          >
            {loading ? "[  GENERATING...  ]" : uploadedImage ? "[  EDIT IMAGE  ]" : "[  GENERATE  ]"}
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
              <span><span style={{ color: "#ffcc00" }}>LATENCY:</span> <span style={{ color: "#00e5ff" }}>{(stats.latencyMs / 1000).toFixed(1)}s</span></span>
              <span><span style={{ color: "#ffcc00" }}>MODEL:</span> <span style={{ color: "#00e5ff" }}>gemini-2.5-flash-image</span></span>
            </div>
          )}

          {/* Response text */}
          {responseText && (
            <div style={{ padding: "12px", backgroundColor: "rgba(0, 255, 136, 0.04)", border: "1px solid rgba(0, 255, 136, 0.15)", fontSize: "13px", color: "#e0e0e0", whiteSpace: "pre-wrap", lineHeight: "1.6" }}>
              <div style={{ fontSize: "11px", fontWeight: 700, color: "#00ff88", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "8px" }}>
                MODEL RESPONSE:
              </div>
              {responseText}
            </div>
          )}

          {/* Generated image output */}
          {imageUrl && (
            <div style={{ border: "1px solid #00ff88", backgroundColor: "#0d1117" }}>
              <div style={{ padding: "8px 12px", borderBottom: "1px solid #1e2a3a", fontSize: "11px", fontWeight: 700, color: "#00ff88", textTransform: "uppercase", letterSpacing: "0.1em", backgroundColor: "rgba(0, 255, 136, 0.05)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span>GENERATED IMAGE:</span>
                <a
                  href={imageUrl}
                  download={`morana-image-${runId?.slice(0, 8) || "output"}.png`}
                  style={{ color: "#00e5ff", fontSize: "10px", textDecoration: "none", border: "1px solid rgba(0, 229, 255, 0.3)", padding: "2px 8px", textTransform: "uppercase" }}
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "rgba(0, 229, 255, 0.1)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
                >
                  Download
                </a>
              </div>
              <div style={{ padding: "16px", display: "flex", justifyContent: "center" }}>
                <img
                  src={imageUrl}
                  alt="Generated image"
                  style={{ maxWidth: "100%", maxHeight: "600px", border: "1px solid #1e2a3a" }}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
