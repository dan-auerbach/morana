"use client";

import { PricingInfo, previewLLMCost, previewSTTCost, previewTTSCost, formatCostCents } from "@/lib/cost-preview";

type CostPreviewProps = {
  type: "llm" | "stt" | "tts" | "image";
  modelId?: string;
  pricing?: PricingInfo;
  inputChars?: number;       // for LLM — total conversation chars
  durationSeconds?: number;  // for STT — audio duration
  charCount?: number;        // for TTS — text chars
};

export default function CostPreview({
  type,
  modelId,
  pricing,
  inputChars = 0,
  durationSeconds = 0,
  charCount = 0,
}: CostPreviewProps) {
  if (!pricing) return null;

  let display: string | null = null;

  if (type === "llm") {
    const preview = previewLLMCost(pricing, inputChars);
    if (!preview || inputChars === 0) return null;
    display = `~${formatCostCents(preview.estimatedCostCents)} | ~${preview.inputTokens.toLocaleString()} tok in | ~${preview.outputTokens.toLocaleString()} tok out`;
  } else if (type === "stt") {
    const preview = previewSTTCost(pricing, durationSeconds);
    if (!preview || durationSeconds === 0) return null;
    display = `~${formatCostCents(preview.estimatedCostCents)} | ~${preview.minutes} min`;
  } else if (type === "tts") {
    const preview = previewTTSCost(pricing, charCount);
    if (!preview || charCount === 0) return null;
    display = `~${formatCostCents(preview.estimatedCostCents)} | ${charCount.toLocaleString()} chars`;
  } else if (type === "image") {
    // Flat estimate for image generation
    if (!modelId) return null;
    display = `~$0.04 per image`;
  }

  if (!display) return null;

  return (
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
      }}
    >
      <span style={{ color: "#00ff88", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>
        COST
      </span>
      <span>{display}</span>
    </div>
  );
}
