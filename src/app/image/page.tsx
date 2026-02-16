"use client";

import { useSession } from "next-auth/react";
import { useState, useRef, useEffect, useCallback } from "react";
import StatusBadge from "../components/StatusBadge";
import CostPreview from "../components/CostPreview";

// ─── Types ─────────────────────────────────────────────────

type HistoryRun = {
  id: string;
  status: string;
  createdAt: string;
  model: string;
  provider: string;
  preview?: string;
};

type OutputImage = {
  id: string;
  url: string;
  width?: number;
  height?: number;
};

const FAL_MODELS = [
  { id: "fal-ai/flux/schnell", label: "Flux Schnell (fast)", defaultSteps: 4 },
  { id: "fal-ai/flux/dev", label: "Flux Dev (quality)", defaultSteps: 28 },
];

const ASPECT_RATIOS = [
  { id: "1:1", label: "1:1" },
  { id: "16:9", label: "16:9" },
  { id: "9:16", label: "9:16" },
  { id: "4:3", label: "4:3" },
  { id: "3:4", label: "3:4" },
  { id: "3:2", label: "3:2" },
  { id: "2:3", label: "2:3" },
];

// ─── Component ─────────────────────────────────────────────

export default function ImagePage() {
  const { data: session } = useSession();

  // Provider & mode
  const [provider, setProvider] = useState<"fal" | "gemini">("fal");
  const [operation, setOperation] = useState<"generate" | "img2img" | "multi">("generate");

  // Model
  const [modelId, setModelId] = useState("fal-ai/flux/dev");

  // Prompt
  const [prompt, setPrompt] = useState("");

  // Image params
  const [aspectRatio, setAspectRatio] = useState("1:1");
  const [numImages, setNumImages] = useState(1);
  const [outputFormat, setOutputFormat] = useState<"jpeg" | "png">("jpeg");

  // Advanced params
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [steps, setSteps] = useState<number | undefined>(undefined);
  const [guidanceScale, setGuidanceScale] = useState<number | undefined>(undefined);
  const [seed, setSeed] = useState<string>("");
  const [strength, setStrength] = useState(0.7);

  // Image upload (for img2img)
  const [uploadedImage, setUploadedImage] = useState<string | null>(null);
  const [uploadedImageName, setUploadedImageName] = useState("");
  const [uploadedImageMime, setUploadedImageMime] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  // Multi-image upload (for multi operation)
  const [multiImages, setMultiImages] = useState<Array<{ dataUri: string; name: string; mime: string }>>([]);
  const multiFileRef = useRef<HTMLInputElement>(null);

  // Results
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [runId, setRunId] = useState("");
  const [status, setStatus] = useState("");
  const [outputImages, setOutputImages] = useState<OutputImage[]>([]);
  const [responseText, setResponseText] = useState("");
  const [stats, setStats] = useState<{ latencyMs?: number; seed?: number; model?: string } | null>(null);

  // History sidebar
  const [history, setHistory] = useState<HistoryRun[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Polling for fal.ai async runs
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Modal
  const [modalImage, setModalImage] = useState<string | null>(null);

  const loadHistory = useCallback(() => {
    fetch("/api/history?type=image&limit=50")
      .then((r) => r.json())
      .then((d) => setHistory(d.runs || []));
  }, []);

  useEffect(() => {
    if (session) loadHistory();
  }, [session, loadHistory]);

  // Cleanup poll on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  if (!session) {
    return (
      <div style={{ color: "#5a6a7a" }}>
        <span style={{ color: "#ff4444" }}>[ERROR]</span> Authentication required.
      </div>
    );
  }

  // ─── File handling ───────────────────────────────────────

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

  // ─── Multi-image handling ─────────────────────────────

  function handleMultiFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    const allowedTypes = ["image/png", "image/jpeg", "image/jpg", "image/webp"];
    const remaining = 4 - multiImages.length;
    const toAdd = files.slice(0, remaining);

    for (const file of toAdd) {
      if (!allowedTypes.includes(file.type)) {
        setError(`Unsupported format: ${file.type}. Use PNG, JPEG, or WebP.`);
        continue;
      }
      if (file.size > 20 * 1024 * 1024) {
        setError(`"${file.name}" exceeds 20MB limit`);
        continue;
      }
      const reader = new FileReader();
      reader.onload = () => {
        setMultiImages((prev) => {
          if (prev.length >= 4) return prev;
          return [...prev, { dataUri: reader.result as string, name: file.name, mime: file.type }];
        });
      };
      reader.readAsDataURL(file);
    }
    if (multiFileRef.current) multiFileRef.current.value = "";
  }

  function removeMultiImage(idx: number) {
    setMultiImages((prev) => prev.filter((_, i) => i !== idx));
  }

  // ─── Polling for async runs ──────────────────────────────

  function startPolling(id: string) {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const resp = await fetch(`/api/runs/${id}`);
        const data = await resp.json();
        setStatus(data.status);

        if (data.status === "done") {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          setLoading(false);

          // Load output images from files
          if (data.files?.length > 0) {
            setOutputImages(
              data.files.map((f: { id: string; mime: string }) => ({
                id: f.id,
                url: `/api/files/${f.id}`,
              }))
            );
          }

          if (data.output?.seed) setStats((s) => ({ ...s, seed: data.output.seed }));
          if (data.output?.latencyMs) setStats((s) => ({ ...s, latencyMs: data.output.latencyMs }));
          loadHistory();
        } else if (data.status === "error") {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          setLoading(false);
          setError(data.errorMessage || "Generation failed");
        }
      } catch {
        // retry
      }
    }, 2000);
  }

  // ─── Submit ──────────────────────────────────────────────

  async function handleSubmit() {
    if (!prompt.trim() || loading) return;
    if (operation === "multi" && multiImages.length === 0) return;
    setLoading(true);
    setError("");
    setOutputImages([]);
    setResponseText("");
    setStatus("queued");
    setStats(null);

    try {
      const formData = new FormData();
      formData.append("provider", provider);
      formData.append("operation", operation);
      formData.append("prompt", prompt);

      if (provider === "fal") {
        formData.append("modelId", operation === "multi" ? "fal-ai/flux-pro/kontext/max/multi" : modelId);
        formData.append("aspectRatio", aspectRatio);
        formData.append("numImages", String(numImages));
        formData.append("outputFormat", outputFormat);
        if (steps !== undefined) formData.append("steps", String(steps));
        if (guidanceScale !== undefined) formData.append("guidanceScale", String(guidanceScale));
        if (seed) formData.append("seed", seed);
        if (operation === "img2img") formData.append("strength", String(strength));
      }

      // Attach multi images
      if (operation === "multi" && multiImages.length > 0) {
        for (const img of multiImages) {
          const base64Data = img.dataUri.split(",")[1];
          const binaryStr = atob(base64Data);
          const bytes = new Uint8Array(binaryStr.length);
          for (let i = 0; i < binaryStr.length; i++) {
            bytes[i] = binaryStr.charCodeAt(i);
          }
          const blob = new Blob([bytes], { type: img.mime });
          formData.append("images", blob, img.name || "image.png");
        }
      }

      // Attach single image file if present (img2img / gemini)
      if (operation !== "multi" && uploadedImage && uploadedImageMime) {
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
      setStats({ model: provider === "fal" ? modelId : "gemini-2.5-flash-image" });

      if (data.status === "done") {
        setLoading(false);

        // Fal.ai returns files array (batch support)
        if (data.files?.length > 0) {
          setOutputImages(
            data.files.map((f: { id: string; url: string }, idx: number) => ({
              id: f.id || `fal-${idx}`,
              url: f.url,
            }))
          );
        } else if (data.imageUrl) {
          // Gemini returns single imageUrl
          setOutputImages([{ id: "gemini", url: data.imageUrl }]);
        }

        if (data.text) setResponseText(data.text);
        if (data.seed !== undefined) setStats((s) => ({ ...s, seed: data.seed }));
        if (data.latencyMs) setStats((s) => ({ ...s, latencyMs: data.latencyMs }));
        loadHistory();
      } else if (data.status === "running") {
        // Fallback: async polling if needed
        startPolling(data.runId);
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
      await fetch(`/api/runs/image?runId=${runId}`, { method: "DELETE" });
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
      setLoading(false);
      setStatus("error");
      setError("Cancelled");
    } catch {
      // ignore
    }
  }

  // ─── Use as input ────────────────────────────────────────

  function useAsInput(imageUrl: string) {
    setOperation("img2img");
    setProvider("fal");
    setModelId("fal-ai/flux/dev"); // only dev supports img2img
    // Load the image as data URI for upload
    fetch(imageUrl)
      .then((r) => r.blob())
      .then((blob) => {
        const reader = new FileReader();
        reader.onload = () => {
          setUploadedImage(reader.result as string);
          setUploadedImageName("input-image.jpg");
          setUploadedImageMime(blob.type || "image/jpeg");
        };
        reader.readAsDataURL(blob);
      });
  }

  // ─── Load history item ──────────────────────────────────

  async function loadHistoryItem(id: string) {
    try {
      const resp = await fetch(`/api/runs/${id}`);
      const data = await resp.json();
      setRunId(data.id);
      setStatus(data.status);
      setError("");
      setOutputImages([]);
      setResponseText("");
      setStats(null);

      // Restore input params
      if (data.input?.prompt) setPrompt(data.input.prompt);
      if (data.input?.provider) setProvider(data.input.provider);
      if (data.input?.operation) setOperation(data.input.operation);
      if (data.input?.modelId) setModelId(data.input.modelId);
      if (data.input?.aspectRatio) setAspectRatio(data.input.aspectRatio);
      if (data.input?.numImages) setNumImages(data.input.numImages);
      if (data.input?.steps) setSteps(data.input.steps);
      if (data.input?.guidanceScale) setGuidanceScale(data.input.guidanceScale);
      if (data.input?.seed) setSeed(String(data.input.seed));
      if (data.input?.strength) setStrength(data.input.strength);
      if (data.input?.outputFormat) setOutputFormat(data.input.outputFormat);

      if (data.output?.text) setResponseText(data.output.text);
      if (data.output?.latencyMs) setStats({ latencyMs: data.output.latencyMs, model: data.model });
      if (data.output?.seed) setStats((s) => ({ ...s, seed: data.output.seed }));

      // Load images
      if (data.files?.length > 0) {
        setOutputImages(
          data.files
            .filter((f: { id: string; kind?: string }) => !f.kind || f.kind === "output")
            .map((f: { id: string }) => ({
              id: f.id,
              url: `/api/files/${f.id}`,
            }))
        );
      }

      if (data.errorMessage) setError(data.errorMessage);
    } catch {
      // ignore
    }
  }

  // ─── Derived ─────────────────────────────────────────────

  const charPercent = Math.min((prompt.length / 10000) * 100, 100);
  const charColor = charPercent > 90 ? "#ff4444" : charPercent > 70 ? "#ffcc00" : "#5a6a7a";
  const selectedModel = FAL_MODELS.find((m) => m.id === modelId);

  // ─── Render ──────────────────────────────────────────────

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
        <div style={{ padding: "8px", borderBottom: "1px solid #1e2a3a" }}>
          <button
            onClick={() => {
              setRunId("");
              setStatus("");
              setError("");
              setOutputImages([]);
              setResponseText("");
              setStats(null);
              setPrompt("");
              removeUploadedImage();
              setMultiImages([]);
            }}
            style={{
              width: "100%",
              padding: "7px 12px",
              background: "transparent",
              border: "1px solid #00ff88",
              color: "#00ff88",
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
            + New Image
          </button>
        </div>
        <div style={{ padding: "8px 12px 4px", fontSize: "11px", fontWeight: 700, color: "#ffcc00", textTransform: "uppercase", letterSpacing: "0.1em" }}>
          History
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
              <div style={{ color: r.id === runId ? "#e0e0e0" : "#8b949e", fontSize: "11px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginBottom: "3px" }}>
                {r.preview || r.id.slice(0, 16) + "..."}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <span style={{ color: "#444", fontSize: "9px" }}>
                  {new Date(r.createdAt).toLocaleString("sl-SI", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                </span>
                <span style={{ color: r.model?.includes("flux") ? "#00e5ff" : "#ffcc00", fontSize: "9px" }}>
                  {r.model?.includes("schnell") ? "SCH" : r.model?.includes("dev") ? "DEV" : "GEM"}
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
        <div style={{ padding: "10px 16px", borderBottom: "1px solid #1e2a3a", backgroundColor: "#0d1117", display: "flex", alignItems: "center", gap: "12px", flexShrink: 0, flexWrap: "wrap" }}>
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            style={{ background: "transparent", border: "1px solid #1e2a3a", color: "#5a6a7a", cursor: "pointer", padding: "4px 8px", fontFamily: "inherit", fontSize: "12px" }}
          >
            {sidebarOpen ? "<<" : ">>"}
          </button>
          <span style={{ color: "#00ff88", fontSize: "14px", fontWeight: 700 }}>[IMAGE]</span>
          <span style={{ color: "#5a6a7a", fontSize: "12px" }}>$ image --provider {provider} --{operation}</span>
        </div>

        {/* Content */}
        <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "14px" }}>

          {/* Provider & Operation toggle */}
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            {/* Provider toggle */}
            <div style={{ display: "flex", border: "1px solid #1e2a3a", overflow: "hidden" }}>
              {(["fal", "gemini"] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => {
                    setProvider(p);
                    if (p === "gemini") {
                      setModelId("gemini-2.5-flash-image");
                      setOperation("generate");
                    } else {
                      setModelId("fal-ai/flux/dev");
                    }
                  }}
                  style={{
                    padding: "6px 14px",
                    background: provider === p ? (p === "fal" ? "rgba(0, 229, 255, 0.15)" : "rgba(255, 204, 0, 0.15)") : "transparent",
                    border: "none",
                    borderRight: p === "fal" ? "1px solid #1e2a3a" : "none",
                    color: provider === p ? (p === "fal" ? "#00e5ff" : "#ffcc00") : "#5a6a7a",
                    fontFamily: "inherit",
                    fontSize: "12px",
                    fontWeight: provider === p ? 700 : 400,
                    cursor: "pointer",
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                  }}
                >
                  {p === "fal" ? "fal.ai (Flux)" : "Gemini"}
                </button>
              ))}
            </div>

            {/* Operation toggle (only for fal) */}
            {provider === "fal" && (
              <div style={{ display: "flex", border: "1px solid #1e2a3a", overflow: "hidden" }}>
                {([
                  { id: "generate" as const, label: "Generate" },
                  { id: "img2img" as const, label: "Img2Img" },
                  { id: "multi" as const, label: "Multi-Image" },
                ]).map((op, idx) => (
                  <button
                    key={op.id}
                    onClick={() => {
                      setOperation(op.id);
                      if (op.id === "img2img") setModelId("fal-ai/flux/dev");
                      if (op.id === "multi") {
                        setModelId("fal-ai/flux-pro/kontext/max/multi");
                        removeUploadedImage();
                      }
                      if (op.id === "generate") setMultiImages([]);
                    }}
                    disabled={op.id === "img2img" && modelId === "fal-ai/flux/schnell"}
                    style={{
                      padding: "6px 14px",
                      background: operation === op.id ? "rgba(0, 255, 136, 0.12)" : "transparent",
                      border: "none",
                      borderRight: idx < 2 ? "1px solid #1e2a3a" : "none",
                      color: operation === op.id ? "#00ff88" : "#5a6a7a",
                      fontFamily: "inherit",
                      fontSize: "12px",
                      fontWeight: operation === op.id ? 700 : 400,
                      cursor: op.id === "img2img" && modelId === "fal-ai/flux/schnell" ? "not-allowed" : "pointer",
                      opacity: op.id === "img2img" && modelId === "fal-ai/flux/schnell" ? 0.3 : 1,
                      textTransform: "uppercase",
                    }}
                  >
                    {op.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Model selector (fal only, not for multi) */}
          {provider === "fal" && operation !== "multi" && (
            <div>
              <label style={{ display: "block", marginBottom: "4px", fontSize: "11px", fontWeight: 700, color: "#00e5ff", textTransform: "uppercase", letterSpacing: "0.1em" }}>--model</label>
              <select
                value={modelId}
                onChange={(e) => {
                  setModelId(e.target.value);
                  // Schnell doesn't support img2img
                  if (e.target.value === "fal-ai/flux/schnell" && operation === "img2img") {
                    setOperation("generate");
                  }
                }}
                style={{ padding: "6px 10px", backgroundColor: "#111820", border: "1px solid #1e2a3a", color: "#e0e0e0", fontFamily: "inherit", fontSize: "13px", width: "100%", maxWidth: "400px" }}
              >
                {FAL_MODELS.map((m) => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </select>
            </div>
          )}

          {/* Prompt input */}
          <div>
            <label style={{ display: "block", marginBottom: "4px", fontSize: "11px", fontWeight: 700, color: "#00ff88", textTransform: "uppercase", letterSpacing: "0.1em" }}>--prompt</label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={4}
              placeholder={operation === "img2img" ? "Describe the edit to apply to the uploaded image..." : "Describe the image to generate..."}
              style={{ width: "100%", padding: "8px 12px", backgroundColor: "#111820", border: "1px solid #1e2a3a", color: "#e0e0e0", fontFamily: "inherit", fontSize: "13px", resize: "vertical" }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
            />
            <div style={{ marginTop: "4px", fontSize: "11px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ color: charColor }}>
                <span style={{ color: "#ffcc00" }}>CHARS:</span> {prompt.length.toLocaleString()} / 10,000
              </span>
              <div style={{ width: "120px", height: "4px", backgroundColor: "#1e2a3a", overflow: "hidden" }}>
                <div style={{ width: `${charPercent}%`, height: "100%", backgroundColor: charColor === "#ff4444" ? "#ff4444" : charColor === "#ffcc00" ? "#ffcc00" : "#00ff88", transition: "width 0.2s" }} />
              </div>
            </div>
          </div>

          {/* Aspect ratio (fal only) */}
          {provider === "fal" && (
            <div>
              <label style={{ display: "block", marginBottom: "4px", fontSize: "11px", fontWeight: 700, color: "#00e5ff", textTransform: "uppercase", letterSpacing: "0.1em" }}>--aspect-ratio</label>
              <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
                {ASPECT_RATIOS.map((ar) => (
                  <button
                    key={ar.id}
                    onClick={() => setAspectRatio(ar.id)}
                    style={{
                      padding: "5px 12px",
                      background: aspectRatio === ar.id ? "rgba(0, 229, 255, 0.15)" : "transparent",
                      border: `1px solid ${aspectRatio === ar.id ? "#00e5ff" : "#1e2a3a"}`,
                      color: aspectRatio === ar.id ? "#00e5ff" : "#5a6a7a",
                      fontFamily: "inherit",
                      fontSize: "12px",
                      cursor: "pointer",
                      fontWeight: aspectRatio === ar.id ? 700 : 400,
                    }}
                  >
                    {ar.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Batch count + output format (fal only, not multi) */}
          {provider === "fal" && operation !== "multi" && (
            <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
              <div>
                <label style={{ display: "block", marginBottom: "4px", fontSize: "11px", fontWeight: 700, color: "#00e5ff", textTransform: "uppercase", letterSpacing: "0.1em" }}>--count</label>
                <div style={{ display: "flex", gap: "4px" }}>
                  {[1, 2, 3, 4].map((n) => (
                    <button
                      key={n}
                      onClick={() => setNumImages(n)}
                      style={{
                        padding: "5px 12px",
                        background: numImages === n ? "rgba(0, 229, 255, 0.15)" : "transparent",
                        border: `1px solid ${numImages === n ? "#00e5ff" : "#1e2a3a"}`,
                        color: numImages === n ? "#00e5ff" : "#5a6a7a",
                        fontFamily: "inherit",
                        fontSize: "12px",
                        cursor: "pointer",
                        fontWeight: numImages === n ? 700 : 400,
                      }}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label style={{ display: "block", marginBottom: "4px", fontSize: "11px", fontWeight: 700, color: "#00e5ff", textTransform: "uppercase", letterSpacing: "0.1em" }}>--format</label>
                <div style={{ display: "flex", gap: "4px" }}>
                  {(["jpeg", "png"] as const).map((fmt) => (
                    <button
                      key={fmt}
                      onClick={() => setOutputFormat(fmt)}
                      style={{
                        padding: "5px 12px",
                        background: outputFormat === fmt ? "rgba(0, 229, 255, 0.15)" : "transparent",
                        border: `1px solid ${outputFormat === fmt ? "#00e5ff" : "#1e2a3a"}`,
                        color: outputFormat === fmt ? "#00e5ff" : "#5a6a7a",
                        fontFamily: "inherit",
                        fontSize: "12px",
                        cursor: "pointer",
                        fontWeight: outputFormat === fmt ? 700 : 400,
                        textTransform: "uppercase",
                      }}
                    >
                      {fmt}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Image upload (img2img or Gemini edit) */}
          {(operation === "img2img" || provider === "gemini") && (
            <div>
              <label style={{ display: "block", marginBottom: "4px", fontSize: "11px", fontWeight: 700, color: "#00ff88", textTransform: "uppercase", letterSpacing: "0.1em" }}>
                --input-image {provider === "gemini" && <span style={{ color: "#5a6a7a", fontWeight: 400, textTransform: "none" }}>(optional, for editing)</span>}
              </label>
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
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = "rgba(0, 255, 136, 0.4)"; e.currentTarget.style.color = "#00ff88"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#1e2a3a"; e.currentTarget.style.color = "#5a6a7a"; }}
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
          )}

          {/* Multi-image upload */}
          {operation === "multi" && provider === "fal" && (
            <div>
              <label style={{ display: "block", marginBottom: "4px", fontSize: "11px", fontWeight: 700, color: "#00ff88", textTransform: "uppercase", letterSpacing: "0.1em" }}>
                --input-images <span style={{ color: "#e0e0e0", fontWeight: 400, textTransform: "none" }}>({multiImages.length}/4)</span>
              </label>
              <input
                ref={multiFileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                multiple
                onChange={handleMultiFileSelect}
                style={{ display: "none" }}
              />

              {/* Image grid */}
              {multiImages.length > 0 && (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: "8px", marginBottom: "8px" }}>
                  {multiImages.map((img, idx) => (
                    <div key={idx} style={{ border: "1px solid #1e2a3a", backgroundColor: "#111820", padding: "8px", position: "relative" }}>
                      <div style={{ color: "#00e5ff", fontSize: "10px", fontWeight: 700, marginBottom: "4px", textTransform: "uppercase" }}>Image {idx + 1}</div>
                      <img src={img.dataUri} alt={`Input ${idx + 1}`} style={{ width: "100%", height: "100px", objectFit: "cover", border: "1px solid #1e2a3a" }} />
                      <div style={{ color: "#5a6a7a", fontSize: "10px", marginTop: "4px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{img.name}</div>
                      <button
                        onClick={() => removeMultiImage(idx)}
                        style={{ position: "absolute", top: "4px", right: "4px", background: "rgba(0,0,0,0.7)", border: "1px solid #ff4444", color: "#ff4444", padding: "1px 5px", fontFamily: "inherit", fontSize: "10px", cursor: "pointer" }}
                      >
                        x
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {multiImages.length < 4 && (
                <button
                  onClick={() => multiFileRef.current?.click()}
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
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = "rgba(0, 255, 136, 0.4)"; e.currentTarget.style.color = "#00ff88"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#1e2a3a"; e.currentTarget.style.color = "#5a6a7a"; }}
                >
                  [  + ADD IMAGE{multiImages.length > 0 ? "S" : ""}  ] — PNG, JPEG, WebP (max 20MB each, up to 4)
                </button>
              )}

              <div style={{ fontSize: "10px", color: "#5a6a7a", marginTop: "6px", fontStyle: "italic" }}>
                Reference images by number in your prompt: &quot;person from image 1 in scene from image 2&quot;
              </div>
            </div>
          )}

          {/* Strength slider (img2img only) */}
          {operation === "img2img" && provider === "fal" && (
            <div>
              <label style={{ display: "block", marginBottom: "4px", fontSize: "11px", fontWeight: 700, color: "#00e5ff", textTransform: "uppercase", letterSpacing: "0.1em" }}>
                --strength <span style={{ color: "#e0e0e0", fontWeight: 400 }}>{strength.toFixed(2)}</span>
              </label>
              <input
                type="range"
                min="0.01"
                max="1"
                step="0.01"
                value={strength}
                onChange={(e) => setStrength(parseFloat(e.target.value))}
                style={{ width: "100%", maxWidth: "400px", accentColor: "#00e5ff" }}
              />
              <div style={{ fontSize: "10px", color: "#5a6a7a", display: "flex", justifyContent: "space-between", maxWidth: "400px" }}>
                <span>Subtle (preserve input)</span>
                <span>Strong (new generation)</span>
              </div>
            </div>
          )}

          {/* Advanced settings (fal only, not multi) */}
          {provider === "fal" && operation !== "multi" && (
            <div>
              <button
                onClick={() => setShowAdvanced(!showAdvanced)}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "#5a6a7a",
                  fontFamily: "inherit",
                  fontSize: "11px",
                  cursor: "pointer",
                  padding: "4px 0",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                {showAdvanced ? "▼" : "▶"} Advanced Settings
              </button>

              {showAdvanced && (
                <div style={{ padding: "12px", border: "1px solid #1e2a3a", backgroundColor: "#0a0e14", display: "flex", flexDirection: "column", gap: "12px", marginTop: "4px" }}>
                  {/* Steps */}
                  <div>
                    <label style={{ display: "block", marginBottom: "4px", fontSize: "11px", fontWeight: 700, color: "#5a6a7a", textTransform: "uppercase" }}>
                      --steps <span style={{ color: "#e0e0e0", fontWeight: 400 }}>{steps ?? selectedModel?.defaultSteps ?? "default"}</span>
                    </label>
                    <input
                      type="range"
                      min="1"
                      max="50"
                      value={steps ?? selectedModel?.defaultSteps ?? 28}
                      onChange={(e) => setSteps(parseInt(e.target.value, 10))}
                      style={{ width: "100%", maxWidth: "400px", accentColor: "#5a6a7a" }}
                    />
                  </div>

                  {/* Guidance scale */}
                  <div>
                    <label style={{ display: "block", marginBottom: "4px", fontSize: "11px", fontWeight: 700, color: "#5a6a7a", textTransform: "uppercase" }}>
                      --guidance <span style={{ color: "#e0e0e0", fontWeight: 400 }}>{guidanceScale ?? "3.5"}</span>
                    </label>
                    <input
                      type="range"
                      min="1"
                      max="20"
                      step="0.5"
                      value={guidanceScale ?? 3.5}
                      onChange={(e) => setGuidanceScale(parseFloat(e.target.value))}
                      style={{ width: "100%", maxWidth: "400px", accentColor: "#5a6a7a" }}
                    />
                  </div>

                  {/* Seed */}
                  <div>
                    <label style={{ display: "block", marginBottom: "4px", fontSize: "11px", fontWeight: 700, color: "#5a6a7a", textTransform: "uppercase" }}>--seed</label>
                    <input
                      type="text"
                      value={seed}
                      onChange={(e) => setSeed(e.target.value.replace(/[^0-9]/g, ""))}
                      placeholder="Random"
                      style={{ padding: "6px 10px", backgroundColor: "#111820", border: "1px solid #1e2a3a", color: "#e0e0e0", fontFamily: "inherit", fontSize: "13px", width: "200px" }}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Cost preview */}
          {prompt.trim() && operation === "multi" && (
            <div
              style={{
                fontSize: "10px",
                fontFamily: "inherit",
                color: "#ffcc00",
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
              <span style={{ color: "#00ff88", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>COST</span>
              <span>~$0.08 per image | Kontext Max Multi ({multiImages.length} input{multiImages.length !== 1 ? "s" : ""})</span>
            </div>
          )}
          {prompt.trim() && operation !== "multi" && (
            <div style={{ alignSelf: "flex-start" }}>
              <CostPreview
                type="image"
                modelId={provider === "fal" ? modelId : "gemini-2.5-flash-image"}
              />
            </div>
          )}

          {/* Action buttons */}
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <button
              onClick={handleSubmit}
              disabled={loading || !prompt.trim() || (operation === "img2img" && !uploadedImage) || (operation === "multi" && multiImages.length === 0)}
              style={{
                padding: "8px 24px",
                background: "transparent",
                border: `1px solid ${loading ? "#5a6a7a" : "#00ff88"}`,
                color: loading ? "#5a6a7a" : "#00ff88",
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
              {loading
                ? "[  GENERATING...  ]"
                : operation === "img2img"
                  ? "[  EDIT IMAGE  ]"
                  : `[  GENERATE ${numImages > 1 ? `(${numImages})` : ""}  ]`}
            </button>

            {loading && (
              <button
                onClick={handleCancel}
                style={{
                  padding: "8px 16px",
                  background: "transparent",
                  border: "1px solid #ff4444",
                  color: "#ff4444",
                  fontFamily: "inherit",
                  fontSize: "12px",
                  cursor: "pointer",
                  textTransform: "uppercase",
                }}
              >
                Cancel
              </button>
            )}
          </div>

          {/* Error */}
          {error && (
            <div style={{ padding: "12px", backgroundColor: "rgba(255, 68, 68, 0.08)", border: "1px solid #ff4444", color: "#ff4444", fontSize: "13px" }}>
              <span style={{ fontWeight: 700 }}>[ERROR]</span> {error}
            </div>
          )}

          {/* Run status */}
          {runId && (
            <div style={{ fontSize: "12px", color: "#5a6a7a", display: "flex", alignItems: "center", gap: "10px", padding: "8px 0", borderTop: "1px solid #1e2a3a", flexWrap: "wrap" }}>
              <span><span style={{ color: "#ffcc00" }}>RUN:</span> <span style={{ color: "#e0e0e0" }}>{runId.slice(0, 8)}...</span></span>
              <StatusBadge status={status} />
              {status === "running" && (
                <span style={{ color: "#00e5ff", fontSize: "11px" }}>Generating on fal.ai...</span>
              )}
            </div>
          )}

          {/* Stats */}
          {stats && (
            <div style={{ display: "flex", gap: "20px", fontSize: "12px", padding: "8px 0", borderTop: "1px solid #1e2a3a", flexWrap: "wrap" }}>
              {stats.latencyMs && <span><span style={{ color: "#ffcc00" }}>LATENCY:</span> <span style={{ color: "#00e5ff" }}>{(stats.latencyMs / 1000).toFixed(1)}s</span></span>}
              {stats.model && <span><span style={{ color: "#ffcc00" }}>MODEL:</span> <span style={{ color: "#00e5ff" }}>{stats.model}</span></span>}
              {stats.seed !== undefined && <span><span style={{ color: "#ffcc00" }}>SEED:</span> <span style={{ color: "#00e5ff" }}>{stats.seed}</span></span>}
            </div>
          )}

          {/* Response text (Gemini) */}
          {responseText && (
            <div style={{ padding: "12px", backgroundColor: "rgba(0, 255, 136, 0.04)", border: "1px solid rgba(0, 255, 136, 0.15)", fontSize: "13px", color: "#e0e0e0", whiteSpace: "pre-wrap", lineHeight: "1.6" }}>
              <div style={{ fontSize: "11px", fontWeight: 700, color: "#00ff88", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "8px" }}>
                MODEL RESPONSE:
              </div>
              {responseText}
            </div>
          )}

          {/* Output gallery */}
          {outputImages.length > 0 && (
            <div style={{ border: "1px solid #00ff88", backgroundColor: "#0d1117" }}>
              <div style={{ padding: "8px 12px", borderBottom: "1px solid #1e2a3a", fontSize: "11px", fontWeight: 700, color: "#00ff88", textTransform: "uppercase", letterSpacing: "0.1em", backgroundColor: "rgba(0, 255, 136, 0.05)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span>GENERATED {outputImages.length > 1 ? `(${outputImages.length} IMAGES)` : "IMAGE"}:</span>
              </div>
              <div style={{
                padding: "16px",
                display: "grid",
                gridTemplateColumns: outputImages.length === 1 ? "1fr" : "repeat(auto-fill, minmax(280px, 1fr))",
                gap: "12px",
                justifyItems: "center",
              }}>
                {outputImages.map((img, idx) => (
                  <div key={img.id} style={{ position: "relative", width: "100%" }}>
                    <img
                      src={img.url}
                      alt={`Generated image ${idx + 1}`}
                      style={{ maxWidth: "100%", maxHeight: outputImages.length === 1 ? "600px" : "400px", border: "1px solid #1e2a3a", cursor: "pointer", display: "block", margin: "0 auto" }}
                      onClick={() => setModalImage(img.url)}
                    />
                    <div style={{ display: "flex", gap: "6px", marginTop: "8px", justifyContent: "center" }}>
                      <a
                        href={img.url}
                        download={`morana-image-${runId?.slice(0, 8) || "output"}-${idx + 1}.${outputFormat}`}
                        style={{ color: "#00e5ff", fontSize: "10px", textDecoration: "none", border: "1px solid rgba(0, 229, 255, 0.3)", padding: "3px 10px", textTransform: "uppercase" }}
                        onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "rgba(0, 229, 255, 0.1)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
                      >
                        Download
                      </a>
                      {provider === "fal" && (
                        <button
                          onClick={() => useAsInput(img.url)}
                          style={{ color: "#ffcc00", fontSize: "10px", background: "transparent", border: "1px solid rgba(255, 204, 0, 0.3)", padding: "3px 10px", fontFamily: "inherit", cursor: "pointer", textTransform: "uppercase" }}
                          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "rgba(255, 204, 0, 0.1)"; }}
                          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
                        >
                          Use as Input
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Lightbox modal */}
      {modalImage && (
        <div
          onClick={() => setModalImage(null)}
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0,0,0,0.9)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            cursor: "pointer",
          }}
        >
          <img
            src={modalImage}
            alt="Full size"
            style={{ maxWidth: "95vw", maxHeight: "95vh", border: "1px solid #1e2a3a" }}
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
