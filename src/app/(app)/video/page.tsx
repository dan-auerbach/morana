"use client";

import { useSession } from "next-auth/react";
import { useState, useRef, useEffect, useCallback } from "react";
import StatusBadge from "@/app/components/StatusBadge";
import { useT } from "@/app/components/I18nProvider";

// ─── Types ─────────────────────────────────────────────────

type VideoOperation = "text2video" | "img2video" | "video2video";
type VideoResolution = "480p" | "720p";

type HistoryRun = {
  id: string;
  status: string;
  createdAt: string;
  model: string;
  provider: string;
  preview?: string;
};

const OPERATIONS: Array<{ id: VideoOperation; label: string; requiresFile: "image" | "video" | false }> = [
  { id: "text2video", label: "Text \u2192 Video", requiresFile: false },
  { id: "img2video", label: "Image \u2192 Video", requiresFile: "image" },
  { id: "video2video", label: "Video \u2192 Video", requiresFile: "video" },
];

const ASPECT_RATIOS = ["16:9", "4:3", "3:2", "1:1", "2:3", "3:4", "9:16"];

// ─── Component ─────────────────────────────────────────────

export default function VideoPage() {
  const { data: session } = useSession();
  const t = useT("video");

  // Controls
  const [operation, setOperation] = useState<VideoOperation>("text2video");
  const [prompt, setPrompt] = useState("");
  const [duration, setDuration] = useState(3);
  const [aspectRatio, setAspectRatio] = useState("16:9");
  const [resolution, setResolution] = useState<VideoResolution>("480p");

  // File upload
  const [uploadedFile, setUploadedFile] = useState<string | null>(null); // data URI
  const [uploadedFileName, setUploadedFileName] = useState("");
  const [uploadedFileMime, setUploadedFileMime] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  // Results
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [runId, setRunId] = useState("");
  const [status, setStatus] = useState("");
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [stats, setStats] = useState<{
    latencyMs?: number;
    width?: number;
    height?: number;
    fps?: number;
    duration?: number;
  } | null>(null);

  // History
  const [history, setHistory] = useState<HistoryRun[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const loadHistory = useCallback(() => {
    fetch("/api/history?type=video&limit=10")
      .then((r) => r.json())
      .then((d) => setHistory(d.runs || []));
  }, []);

  useEffect(() => {
    if (session) loadHistory();
  }, [session, loadHistory]);

  if (!session) {
    return (
      <div style={{ color: "var(--gray)" }}>
        <span style={{ color: "var(--red)" }}>[ERROR]</span> {t("authRequired")}
      </div>
    );
  }

  // ─── Cost preview ────────────────────────────────────────

  const costPerSec = resolution === "720p" ? 0.07 : 0.05;
  let estimatedCost = duration * costPerSec;
  if (operation === "img2video") estimatedCost += 0.002;
  if (operation === "video2video") estimatedCost += duration * 0.01;

  // ─── File handling ───────────────────────────────────────

  const currentOp = OPERATIONS.find((o) => o.id === operation)!;

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 50 * 1024 * 1024) {
      setError("File exceeds 50MB limit");
      return;
    }

    if (currentOp.requiresFile === "image") {
      const allowed = ["image/png", "image/jpeg", "image/jpg", "image/webp"];
      if (!allowed.includes(file.type)) {
        setError(t("unsupportedImage").replace("{type}", file.type));
        return;
      }
    } else if (currentOp.requiresFile === "video") {
      const allowed = ["video/mp4", "video/webm", "video/quicktime"];
      if (!allowed.includes(file.type)) {
        setError(t("unsupportedVideo").replace("{type}", file.type));
        return;
      }
    }

    setUploadedFileName(file.name);
    setUploadedFileMime(file.type);
    setError("");

    const reader = new FileReader();
    reader.onload = () => setUploadedFile(reader.result as string);
    reader.readAsDataURL(file);
  }

  function removeFile() {
    setUploadedFile(null);
    setUploadedFileName("");
    setUploadedFileMime("");
    if (fileRef.current) fileRef.current.value = "";
  }

  // ─── New video (reset) ──────────────────────────────────

  function resetForm() {
    setRunId("");
    setStatus("");
    setError("");
    setVideoUrl(null);
    setStats(null);
    setPrompt("");
    removeFile();
  }

  // ─── Submit ──────────────────────────────────────────────

  async function handleSubmit() {
    if (!prompt.trim() || loading) return;
    if (currentOp.requiresFile && !uploadedFile) return;

    setLoading(true);
    setError("");
    setVideoUrl(null);
    setStatus("queued");
    setStats(null);

    try {
      const formData = new FormData();
      formData.append("operation", operation);
      formData.append("prompt", prompt);
      formData.append("duration", String(duration));
      formData.append("aspectRatio", aspectRatio);
      formData.append("resolution", resolution);

      // Attach file if present
      if (uploadedFile && uploadedFileMime) {
        const base64Data = uploadedFile.split(",")[1];
        const binaryStr = atob(base64Data);
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) {
          bytes[i] = binaryStr.charCodeAt(i);
        }
        const blob = new Blob([bytes], { type: uploadedFileMime });
        formData.append("file", blob, uploadedFileName || "input");
      }

      const resp = await fetch("/api/runs/video", {
        method: "POST",
        body: formData,
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "Request failed");

      setRunId(data.runId);
      setStatus(data.status);

      if (data.status === "done") {
        setLoading(false);
        if (data.videoUrl) setVideoUrl(data.videoUrl);
        setStats({
          latencyMs: data.latencyMs,
          width: data.width,
          height: data.height,
          fps: data.fps,
          duration: data.duration,
        });
        loadHistory();
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setStatus("error");
      setLoading(false);
    }
  }

  // ─── Cancel ──────────────────────────────────────────────

  async function handleCancel() {
    if (!runId) return;
    try {
      await fetch(`/api/runs/video?runId=${runId}`, { method: "DELETE" });
      setLoading(false);
      setStatus("error");
      setError("Cancelled");
    } catch {
      // ignore
    }
  }

  // ─── Load history item ──────────────────────────────────

  async function loadHistoryItem(id: string) {
    try {
      const resp = await fetch(`/api/runs/${id}`);
      const data = await resp.json();
      setRunId(data.id);
      setStatus(data.status);
      setError("");
      setVideoUrl(null);
      setStats(null);

      if (data.input?.prompt) setPrompt(data.input.prompt);
      if (data.input?.operation) setOperation(data.input.operation);
      if (data.input?.duration) setDuration(data.input.duration);
      if (data.input?.aspectRatio) setAspectRatio(data.input.aspectRatio);
      if (data.input?.resolution) setResolution(data.input.resolution);

      if (data.output?.latencyMs) {
        setStats({
          latencyMs: data.output.latencyMs,
          width: data.output.width,
          height: data.output.height,
          fps: data.output.fps,
          duration: data.output.duration,
        });
      }

      // Load video file
      if (data.files?.length > 0) {
        const outputFile = data.files.find((f: { kind?: string }) => !f.kind || f.kind === "output");
        if (outputFile) {
          setVideoUrl(`/api/files/${outputFile.id}`);
        }
      }

      if (data.errorMessage) setError(data.errorMessage);
    } catch {
      // ignore
    }
  }

  // ─── Use output as input ────────────────────────────────

  function useAsInput() {
    if (!videoUrl) return;
    setOperation("video2video");
    fetch(videoUrl)
      .then((r) => r.blob())
      .then((blob) => {
        const reader = new FileReader();
        reader.onload = () => {
          setUploadedFile(reader.result as string);
          setUploadedFileName("input-video.mp4");
          setUploadedFileMime(blob.type || "video/mp4");
        };
        reader.readAsDataURL(blob);
      });
  }

  // ─── Derived ─────────────────────────────────────────────

  const charPercent = Math.min((prompt.length / 4096) * 100, 100);
  const charColor = charPercent > 90 ? "var(--red)" : charPercent > 70 ? "var(--yellow)" : "var(--gray)";

  // ─── Render ──────────────────────────────────────────────

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
        <div style={{ padding: "8px", borderBottom: "1px solid var(--border)" }}>
          <button
            onClick={resetForm}
            style={{
              width: "100%",
              padding: "7px 12px",
              background: "transparent",
              border: "1px solid var(--green)",
              color: "var(--green)",
              fontFamily: "inherit",
              fontSize: "11px",
              fontWeight: 700,
              cursor: "pointer",
              textTransform: "uppercase",
              letterSpacing: "0.1em",
              transition: "all 0.2s",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(0, 255, 136, 0.1)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
          >
            {t("newVideo")}
          </button>
        </div>
        <div style={{ padding: "8px 12px 4px", fontSize: "11px", fontWeight: 700, color: "var(--yellow)", textTransform: "uppercase", letterSpacing: "0.1em" }}>
          {t("history")}
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "4px 8px" }}>
          {history.slice(0, 10).map((r) => (
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
                <span style={{ color: r.model?.includes("720p") ? "#ff6b9d" : "#ff9d6b", fontSize: "9px" }}>
                  {r.model?.includes("720p") ? "720p" : "480p"}
                </span>
              </div>
            </div>
          ))}
          {history.length === 0 && (
            <div style={{ color: "#333", fontSize: "11px", textAlign: "center", padding: "20px 0" }}>{t("noRuns")}</div>
          )}
        </div>
      </div>

      {/* Main area */}
      <div className="page-main" style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, overflowY: "auto" }}>
        {/* Header */}
        <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--border)", backgroundColor: "var(--bg-panel)", display: "flex", alignItems: "center", gap: "12px", flexShrink: 0, flexWrap: "wrap" }}>
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            style={{ background: "transparent", border: "1px solid var(--border)", color: "var(--gray)", cursor: "pointer", padding: "4px 8px", fontFamily: "inherit", fontSize: "12px" }}
          >
            {sidebarOpen ? "<<" : ">>"}
          </button>
          <span style={{ color: "#ff6b9d", fontSize: "14px", fontWeight: 700 }}>{t("title")}</span>
          <span style={{ color: "var(--gray)", fontSize: "12px" }}>$ video --{operation} --{resolution}</span>
        </div>

        {/* Content */}
        <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "14px" }}>

          {/* Operation toggle */}
          <div>
            <label style={{ display: "block", marginBottom: "4px", fontSize: "11px", fontWeight: 700, color: "#ff6b9d", textTransform: "uppercase", letterSpacing: "0.1em" }}>{t("mode")}</label>
            <div style={{ display: "flex", border: "1px solid var(--border)", overflow: "hidden", width: "fit-content" }}>
              {OPERATIONS.map((op, idx) => (
                <button
                  key={op.id}
                  onClick={() => {
                    setOperation(op.id);
                    removeFile();
                  }}
                  style={{
                    padding: "6px 14px",
                    background: operation === op.id ? "rgba(255, 107, 157, 0.15)" : "transparent",
                    border: "none",
                    borderRight: idx < OPERATIONS.length - 1 ? "1px solid var(--border)" : "none",
                    color: operation === op.id ? "#ff6b9d" : "var(--gray)",
                    fontFamily: "inherit",
                    fontSize: "12px",
                    fontWeight: operation === op.id ? 700 : 400,
                    cursor: "pointer",
                  }}
                >
                  {op.label}
                </button>
              ))}
            </div>
          </div>

          {/* Prompt */}
          <div>
            <label style={{ display: "block", marginBottom: "4px", fontSize: "11px", fontWeight: 700, color: "var(--green)", textTransform: "uppercase", letterSpacing: "0.1em" }}>{t("prompt")}</label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={3}
              placeholder={
                operation === "text2video"
                  ? "Describe the video to generate..."
                  : operation === "img2video"
                    ? "Describe the motion and changes to apply..."
                    : "Describe the edit to apply to the video..."
              }
              style={{ width: "100%", padding: "8px 12px", backgroundColor: "var(--bg-input)", border: "1px solid var(--border)", color: "var(--white)", fontFamily: "inherit", fontSize: "13px", resize: "vertical" }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
            />
            <div style={{ marginTop: "4px", fontSize: "11px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ color: charColor }}>
                <span style={{ color: "var(--yellow)" }}>{t("chars")}</span> {prompt.length.toLocaleString()} / 4,096
              </span>
              <div style={{ width: "120px", height: "4px", backgroundColor: "var(--border)", overflow: "hidden" }}>
                <div style={{ width: `${charPercent}%`, height: "100%", backgroundColor: charColor === "var(--red)" ? "var(--red)" : charColor === "var(--yellow)" ? "var(--yellow)" : "var(--green)", transition: "width 0.2s" }} />
              </div>
            </div>
          </div>

          {/* File upload (img2video / video2video) */}
          {currentOp.requiresFile && (
            <div>
              <label style={{ display: "block", marginBottom: "4px", fontSize: "11px", fontWeight: 700, color: "#ff6b9d", textTransform: "uppercase", letterSpacing: "0.1em" }}>
                {currentOp.requiresFile === "image" ? t("inputImage") : t("inputVideo")}
              </label>
              <input
                ref={fileRef}
                type="file"
                accept={currentOp.requiresFile === "image" ? "image/png,image/jpeg,image/webp" : "video/mp4,video/webm"}
                onChange={handleFileSelect}
                style={{ display: "none" }}
              />
              {!uploadedFile ? (
                <button
                  onClick={() => fileRef.current?.click()}
                  style={{
                    padding: "10px 20px",
                    background: "transparent",
                    border: "1px dashed var(--border)",
                    color: "var(--gray)",
                    fontFamily: "inherit",
                    fontSize: "12px",
                    cursor: "pointer",
                    width: "100%",
                    textAlign: "center",
                    transition: "all 0.2s",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = "rgba(255, 107, 157, 0.4)"; e.currentTarget.style.color = "#ff6b9d"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.color = "var(--gray)"; }}
                >
                  {currentOp.requiresFile === "image"
                    ? t("uploadImage")
                    : t("uploadVideo")}
                </button>
              ) : (
                <div style={{ border: "1px solid var(--border)", backgroundColor: "var(--bg-input)", padding: "12px", display: "flex", alignItems: "center", gap: "12px" }}>
                  {currentOp.requiresFile === "image" && uploadedFile ? (
                    <img src={uploadedFile} alt="Input" style={{ width: "80px", height: "80px", objectFit: "cover", border: "1px solid var(--border)" }} />
                  ) : (
                    <div style={{ width: "80px", height: "80px", backgroundColor: "var(--bg)", border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", color: "#ff6b9d", fontSize: "20px" }}>
                      &#9654;
                    </div>
                  )}
                  <div style={{ flex: 1 }}>
                    <div style={{ color: "var(--white)", fontSize: "12px" }}>{uploadedFileName}</div>
                    <div style={{ color: "var(--gray)", fontSize: "11px", marginTop: "2px" }}>{uploadedFileMime}</div>
                  </div>
                  <button
                    onClick={removeFile}
                    style={{
                      background: "transparent",
                      border: "1px solid rgba(255, 68, 68, 0.3)",
                      color: "var(--red)",
                      padding: "4px 10px",
                      fontFamily: "inherit",
                      fontSize: "11px",
                      cursor: "pointer",
                      textTransform: "uppercase",
                    }}
                  >
                    {t("remove")}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Duration slider */}
          <div>
            <label style={{ display: "block", marginBottom: "4px", fontSize: "11px", fontWeight: 700, color: "#ff6b9d", textTransform: "uppercase", letterSpacing: "0.1em" }}>
              {t("duration")} <span style={{ color: "var(--white)", fontWeight: 400 }}>{duration}s</span>
            </label>
            <input
              type="range"
              min="1"
              max="15"
              step="1"
              value={duration}
              onChange={(e) => setDuration(parseInt(e.target.value, 10))}
              style={{ width: "100%", maxWidth: "400px", accentColor: "#ff6b9d" }}
            />
            <div style={{ fontSize: "10px", color: "var(--gray)", display: "flex", justifyContent: "space-between", maxWidth: "400px" }}>
              <span>1s</span>
              <span>15s</span>
            </div>
          </div>

          {/* Aspect ratio (text2video only) */}
          {operation === "text2video" && (
            <div>
              <label style={{ display: "block", marginBottom: "4px", fontSize: "11px", fontWeight: 700, color: "#ff6b9d", textTransform: "uppercase", letterSpacing: "0.1em" }}>{t("aspectRatio")}</label>
              <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
                {ASPECT_RATIOS.map((ar) => (
                  <button
                    key={ar}
                    onClick={() => setAspectRatio(ar)}
                    style={{
                      padding: "5px 12px",
                      background: aspectRatio === ar ? "rgba(255, 107, 157, 0.15)" : "transparent",
                      border: `1px solid ${aspectRatio === ar ? "#ff6b9d" : "var(--border)"}`,
                      color: aspectRatio === ar ? "#ff6b9d" : "var(--gray)",
                      fontFamily: "inherit",
                      fontSize: "12px",
                      cursor: "pointer",
                      fontWeight: aspectRatio === ar ? 700 : 400,
                    }}
                  >
                    {ar}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Resolution */}
          <div>
            <label style={{ display: "block", marginBottom: "4px", fontSize: "11px", fontWeight: 700, color: "#ff6b9d", textTransform: "uppercase", letterSpacing: "0.1em" }}>{t("resolution")}</label>
            <div style={{ display: "flex", gap: "4px" }}>
              {(["480p", "720p"] as const).map((res) => (
                <button
                  key={res}
                  onClick={() => setResolution(res)}
                  style={{
                    padding: "5px 16px",
                    background: resolution === res ? "rgba(255, 107, 157, 0.15)" : "transparent",
                    border: `1px solid ${resolution === res ? "#ff6b9d" : "var(--border)"}`,
                    color: resolution === res ? "#ff6b9d" : "var(--gray)",
                    fontFamily: "inherit",
                    fontSize: "12px",
                    cursor: "pointer",
                    fontWeight: resolution === res ? 700 : 400,
                  }}
                >
                  {res}
                </button>
              ))}
            </div>
          </div>

          {/* Cost preview */}
          {prompt.trim() && (
            <div
              style={{
                fontSize: "10px",
                fontFamily: "inherit",
                color: "var(--yellow)",
                padding: "4px 8px",
                backgroundColor: "rgba(255, 204, 0, 0.06)",
                border: "1px solid rgba(255, 204, 0, 0.15)",
                borderRadius: "2px",
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                alignSelf: "flex-start",
              }}
            >
              <span style={{ color: "var(--green)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                {t("cost")}
              </span>
              <span>~${estimatedCost.toFixed(2)} | {duration}s @ {resolution}</span>
            </div>
          )}

          {/* Action buttons */}
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <button
              onClick={handleSubmit}
              disabled={loading || !prompt.trim() || (currentOp.requiresFile && !uploadedFile)}
              style={{
                padding: "8px 24px",
                background: "transparent",
                border: `1px solid ${loading ? "var(--gray)" : "var(--green)"}`,
                color: loading ? "var(--gray)" : "var(--green)",
                fontFamily: "inherit",
                fontSize: "13px",
                fontWeight: 700,
                cursor: loading || !prompt.trim() ? "not-allowed" : "pointer",
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                opacity: loading || !prompt.trim() ? 0.5 : 1,
                transition: "all 0.2s",
              }}
              onMouseEnter={(e) => { if (!loading && prompt.trim()) { e.currentTarget.style.background = "rgba(0, 255, 136, 0.1)"; e.currentTarget.style.boxShadow = "0 0 15px rgba(0, 255, 136, 0.2)"; } }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.boxShadow = "none"; }}
            >
              {loading ? t("generating") : t("generateVideo")}
            </button>

            {loading && (
              <button
                onClick={handleCancel}
                style={{
                  padding: "8px 16px",
                  background: "transparent",
                  border: "1px solid var(--red)",
                  color: "var(--red)",
                  fontFamily: "inherit",
                  fontSize: "12px",
                  cursor: "pointer",
                  textTransform: "uppercase",
                }}
              >
                {t("cancel")}
              </button>
            )}
          </div>

          {/* Error */}
          {error && (
            <div style={{ padding: "12px", backgroundColor: "rgba(255, 68, 68, 0.08)", border: "1px solid var(--red)", color: "var(--red)", fontSize: "13px" }}>
              <span style={{ fontWeight: 700 }}>[ERROR]</span> {error}
            </div>
          )}

          {/* Run status */}
          {runId && (
            <div style={{ fontSize: "12px", color: "var(--gray)", display: "flex", alignItems: "center", gap: "10px", padding: "8px 0", borderTop: "1px solid var(--border)", flexWrap: "wrap" }}>
              <span><span style={{ color: "var(--yellow)" }}>RUN:</span> <span style={{ color: "var(--white)" }}>{runId.slice(0, 8)}...</span></span>
              <StatusBadge status={status} />
              {loading && (
                <span style={{ color: "#ff6b9d", fontSize: "11px" }}>{t("generatingFal")}</span>
              )}
            </div>
          )}

          {/* Stats */}
          {stats && (
            <div style={{ display: "flex", gap: "20px", fontSize: "12px", padding: "8px 0", borderTop: "1px solid var(--border)", flexWrap: "wrap" }}>
              {stats.latencyMs && <span><span style={{ color: "var(--yellow)" }}>LATENCY:</span> <span style={{ color: "#ff6b9d" }}>{(stats.latencyMs / 1000).toFixed(1)}s</span></span>}
              {stats.width && stats.height && <span><span style={{ color: "var(--yellow)" }}>SIZE:</span> <span style={{ color: "#ff6b9d" }}>{stats.width}x{stats.height}</span></span>}
              {stats.fps && <span><span style={{ color: "var(--yellow)" }}>FPS:</span> <span style={{ color: "#ff6b9d" }}>{stats.fps}</span></span>}
              {stats.duration && <span><span style={{ color: "var(--yellow)" }}>DURATION:</span> <span style={{ color: "#ff6b9d" }}>{stats.duration.toFixed(1)}s</span></span>}
            </div>
          )}

          {/* Video output */}
          {videoUrl && (
            <div style={{ border: "1px solid #ff6b9d", backgroundColor: "var(--bg-panel)" }}>
              <div style={{ padding: "8px 12px", borderBottom: "1px solid var(--border)", fontSize: "11px", fontWeight: 700, color: "#ff6b9d", textTransform: "uppercase", letterSpacing: "0.1em", backgroundColor: "rgba(255, 107, 157, 0.05)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span>{t("generatedVideo")}</span>
              </div>
              <div style={{ padding: "16px", display: "flex", flexDirection: "column", alignItems: "center", gap: "12px" }}>
                <video
                  src={videoUrl}
                  controls
                  autoPlay
                  loop
                  style={{ maxWidth: "100%", maxHeight: "600px", border: "1px solid var(--border)" }}
                />
                <div style={{ display: "flex", gap: "6px" }}>
                  <a
                    href={videoUrl}
                    download={`morana-video-${runId?.slice(0, 8) || "output"}.mp4`}
                    style={{ color: "#ff6b9d", fontSize: "10px", textDecoration: "none", border: "1px solid rgba(255, 107, 157, 0.3)", padding: "3px 10px", textTransform: "uppercase" }}
                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "rgba(255, 107, 157, 0.1)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
                  >
                    {t("download")}
                  </a>
                  <button
                    onClick={useAsInput}
                    style={{ color: "var(--yellow)", fontSize: "10px", background: "transparent", border: "1px solid rgba(255, 204, 0, 0.3)", padding: "3px 10px", fontFamily: "inherit", cursor: "pointer", textTransform: "uppercase" }}
                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "rgba(255, 204, 0, 0.1)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
                  >
                    {t("editVideo")}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
