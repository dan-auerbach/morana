/**
 * Image Operations — abstraction layer for image generation/editing.
 *
 * Defines supported operations, validates parameters per operation,
 * and enforces guardrails (size, steps, batch, megapixels).
 */

import type { FalImageSize } from "../providers/fal-image";
import { ASPECT_RATIO_MAP } from "../providers/fal-image";

// ─── Operation types ───────────────────────────────────────

export type ImageOperation = "generate" | "img2img";

// V2 placeholders (not implemented yet)
// | "inpaint" | "outpaint" | "upscale" | "remove_bg";

export type ImageProvider = "fal" | "gemini";

export type ImageGenerateParams = {
  operation: "generate";
  provider: ImageProvider;
  modelId: string;
  prompt: string;
  negativePrompt?: string;
  aspectRatio?: string;       // "1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"
  width?: number;             // custom, overrides aspectRatio
  height?: number;            // custom, overrides aspectRatio
  steps?: number;
  guidanceScale?: number;
  seed?: number;
  numImages?: number;         // batch count (max 4)
  outputFormat?: "jpeg" | "png";
};

export type ImageImg2ImgParams = {
  operation: "img2img";
  provider: ImageProvider;
  modelId: string;
  prompt: string;
  negativePrompt?: string;
  inputImageStorageKey: string; // R2 key — user uploads first
  strength?: number;           // 0.01–1.0
  aspectRatio?: string;
  width?: number;
  height?: number;
  steps?: number;
  guidanceScale?: number;
  seed?: number;
  numImages?: number;
  outputFormat?: "jpeg" | "png";
};

export type ImageParams = ImageGenerateParams | ImageImg2ImgParams;

// ─── Guardrails ────────────────────────────────────────────

const LIMITS = {
  minDimension: 256,
  maxDimension: 4096,
  dimensionStep: 64,
  maxMegapixels: 16,
  minSteps: 1,
  maxSteps: 50,
  minGuidance: 1,
  maxGuidance: 20,
  minStrength: 0.01,
  maxStrength: 1.0,
  maxBatch: 4,
  maxPromptChars: 10000,
} as const;

export { LIMITS as IMAGE_LIMITS };

// ─── Validation ────────────────────────────────────────────

export type ValidationResult =
  | { valid: true; sanitized: ImageParams }
  | { valid: false; error: string };

/**
 * Validate and sanitize image operation parameters.
 * Returns sanitized params or a descriptive error.
 */
export function validateImageParams(raw: Partial<ImageParams>): ValidationResult {
  // Required fields
  if (!raw.operation || !["generate", "img2img"].includes(raw.operation)) {
    return { valid: false, error: `Invalid operation: ${raw.operation}. Use "generate" or "img2img".` };
  }

  if (!raw.provider || !["fal", "gemini"].includes(raw.provider)) {
    return { valid: false, error: `Invalid provider: ${raw.provider}. Use "fal" or "gemini".` };
  }

  if (!raw.modelId || typeof raw.modelId !== "string") {
    return { valid: false, error: "modelId is required" };
  }

  if (!raw.prompt || typeof raw.prompt !== "string" || raw.prompt.trim().length === 0) {
    return { valid: false, error: "prompt is required" };
  }

  if (raw.prompt.length > LIMITS.maxPromptChars) {
    return { valid: false, error: `Prompt exceeds ${LIMITS.maxPromptChars} character limit` };
  }

  // img2img requires inputImageStorageKey
  if (raw.operation === "img2img") {
    const img2img = raw as Partial<ImageImg2ImgParams>;
    if (!img2img.inputImageStorageKey || typeof img2img.inputImageStorageKey !== "string") {
      return { valid: false, error: "img2img requires an uploaded input image" };
    }

    // Validate strength
    if (img2img.strength !== undefined) {
      if (typeof img2img.strength !== "number" || img2img.strength < LIMITS.minStrength || img2img.strength > LIMITS.maxStrength) {
        return { valid: false, error: `strength must be between ${LIMITS.minStrength} and ${LIMITS.maxStrength}` };
      }
    }
  }

  // Validate dimensions
  if (raw.width !== undefined || raw.height !== undefined) {
    const w = raw.width ?? 1024;
    const h = raw.height ?? 1024;

    if (typeof w !== "number" || typeof h !== "number") {
      return { valid: false, error: "width and height must be numbers" };
    }

    if (w < LIMITS.minDimension || w > LIMITS.maxDimension || h < LIMITS.minDimension || h > LIMITS.maxDimension) {
      return { valid: false, error: `Dimensions must be between ${LIMITS.minDimension} and ${LIMITS.maxDimension}` };
    }

    if (w % LIMITS.dimensionStep !== 0 || h % LIMITS.dimensionStep !== 0) {
      return { valid: false, error: `Dimensions must be multiples of ${LIMITS.dimensionStep}` };
    }

    const megapixels = (w * h) / 1_000_000;
    if (megapixels > LIMITS.maxMegapixels) {
      return { valid: false, error: `Image exceeds ${LIMITS.maxMegapixels} megapixel limit (${megapixels.toFixed(1)}MP)` };
    }
  }

  // Validate aspect ratio
  if (raw.aspectRatio && typeof raw.aspectRatio === "string") {
    if (!(raw.aspectRatio in ASPECT_RATIO_MAP) && raw.aspectRatio !== "custom") {
      return { valid: false, error: `Invalid aspect ratio: ${raw.aspectRatio}. Use: ${Object.keys(ASPECT_RATIO_MAP).join(", ")}` };
    }
  }

  // Validate steps
  if (raw.steps !== undefined) {
    if (typeof raw.steps !== "number" || raw.steps < LIMITS.minSteps || raw.steps > LIMITS.maxSteps) {
      return { valid: false, error: `Steps must be between ${LIMITS.minSteps} and ${LIMITS.maxSteps}` };
    }
  }

  // Validate guidance
  if (raw.guidanceScale !== undefined) {
    if (typeof raw.guidanceScale !== "number" || raw.guidanceScale < LIMITS.minGuidance || raw.guidanceScale > LIMITS.maxGuidance) {
      return { valid: false, error: `Guidance scale must be between ${LIMITS.minGuidance} and ${LIMITS.maxGuidance}` };
    }
  }

  // Validate batch count
  if (raw.numImages !== undefined) {
    if (typeof raw.numImages !== "number" || raw.numImages < 1 || raw.numImages > LIMITS.maxBatch) {
      return { valid: false, error: `Batch count must be between 1 and ${LIMITS.maxBatch}` };
    }
  }

  // Validate seed
  if (raw.seed !== undefined) {
    if (typeof raw.seed !== "number" || !Number.isInteger(raw.seed) || raw.seed < 0) {
      return { valid: false, error: "Seed must be a non-negative integer" };
    }
  }

  // Validate output format
  if (raw.outputFormat && !["jpeg", "png"].includes(raw.outputFormat)) {
    return { valid: false, error: `Output format must be "jpeg" or "png"` };
  }

  // All valid — return sanitized copy
  return { valid: true, sanitized: raw as ImageParams };
}

/**
 * Resolve image_size for fal.ai from params.
 * Priority: custom width/height → aspectRatio → default landscape_4_3
 */
export function resolveFalImageSize(params: ImageParams): FalImageSize {
  if (params.width && params.height) {
    return { width: params.width, height: params.height };
  }
  if (params.aspectRatio && params.aspectRatio in ASPECT_RATIO_MAP) {
    return ASPECT_RATIO_MAP[params.aspectRatio];
  }
  return "landscape_4_3";
}
