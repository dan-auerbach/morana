/**
 * fal.ai Image Provider
 *
 * Supports Flux models via fal.ai queue API:
 *   - fal-ai/flux/schnell                    (fast draft, 1–4 steps)
 *   - fal-ai/flux/dev                        (quality, 28 steps)
 *   - fal-ai/flux/dev/image-to-image         (single img2img)
 *   - fal-ai/flux-pro/kontext/max/multi      (multi-image composition)
 *
 * Queue flow: submit → poll status → get result
 * All requests go through https://queue.fal.run/{modelId}
 */

// ─── Types ─────────────────────────────────────────────────

export type FalImageSize =
  | "square_hd"
  | "square"
  | "portrait_4_3"
  | "portrait_16_9"
  | "landscape_4_3"
  | "landscape_16_9"
  | { width: number; height: number };

export type FalSubmitParams = {
  prompt: string;
  image_size?: FalImageSize;
  num_inference_steps?: number;
  guidance_scale?: number;
  seed?: number;
  num_images?: number;
  enable_safety_checker?: boolean;
  output_format?: "jpeg" | "png";
  // img2img-specific
  image_url?: string;
  strength?: number;
};

export type FalMultiImageParams = {
  prompt: string;
  image_urls: string[];
  aspect_ratio?: string;
  seed?: number;
  num_images?: number;
  output_format?: "jpeg" | "png";
  guidance_scale?: number;
  safety_tolerance?: string;
};

export type FalQueueResponse = {
  request_id: string;
  response_url: string;
  status_url: string;
  cancel_url: string;
};

export type FalStatusResponse = {
  status: "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED";
  queue_position?: number;
  logs?: Array<{ message: string; level: string; timestamp: string }>;
};

export type FalOutputImage = {
  url: string;
  width: number;
  height: number;
  content_type: string;
};

export type FalResultResponse = {
  images: FalOutputImage[];
  prompt: string;
  seed: number;
  timings?: Record<string, number>;
  has_nsfw_concepts?: boolean[];
};

// ─── Model registry ────────────────────────────────────────

export const FAL_MODELS = [
  {
    id: "fal-ai/flux/schnell",
    label: "Flux Schnell (fast)",
    defaultSteps: 4,
    maxSteps: 12,
    supportsImg2Img: false,
    supportsGuidance: true,
  },
  {
    id: "fal-ai/flux/dev",
    label: "Flux Dev (quality)",
    defaultSteps: 28,
    maxSteps: 50,
    supportsImg2Img: true,
    supportsGuidance: true,
  },
] as const;

export type FalModelId = (typeof FAL_MODELS)[number]["id"];

/** Aspect ratio presets → fal.ai image_size enum values */
export const ASPECT_RATIO_MAP: Record<string, FalImageSize> = {
  "1:1": "square_hd",
  "16:9": "landscape_16_9",
  "9:16": "portrait_16_9",
  "4:3": "landscape_4_3",
  "3:4": "portrait_4_3",
  "3:2": "landscape_4_3", // closest match
  "2:3": "portrait_4_3",  // closest match
};

// ─── API helpers ───────────────────────────────────────────

const QUEUE_BASE = "https://queue.fal.run";

function getApiKey(): string {
  const key = process.env.FAL_KEY || process.env.FALAI_API_KEY;
  if (!key) throw new Error("FAL_KEY (or FALAI_API_KEY) is not configured. Set it in your environment variables.");
  return key;
}

function falHeaders(): Record<string, string> {
  return {
    Authorization: `Key ${getApiKey()}`,
    "Content-Type": "application/json",
  };
}

// ─── Queue operations ──────────────────────────────────────

/**
 * Submit an image generation job to fal.ai queue.
 * Returns the queue request metadata (request_id, etc.)
 */
export async function submitImageJob(
  modelId: string,
  params: FalSubmitParams
): Promise<FalQueueResponse> {
  // Determine endpoint path
  let endpoint: string;
  if (params.image_url && modelId === "fal-ai/flux/dev") {
    // img2img endpoint
    endpoint = `${QUEUE_BASE}/fal-ai/flux/dev/image-to-image`;
  } else {
    endpoint = `${QUEUE_BASE}/${modelId}`;
  }

  const resp = await fetch(endpoint, {
    method: "POST",
    headers: falHeaders(),
    body: JSON.stringify(params),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`fal.ai submit failed (${resp.status}): ${text.slice(0, 500)}`);
  }

  const data = await resp.json();
  if (!data.request_id) {
    throw new Error("fal.ai submit: missing request_id in response");
  }

  return data as FalQueueResponse;
}

/**
 * Poll the status of a fal.ai queue job.
 * Uses the status_url returned by the submit response for reliability.
 * Falls back to constructed URL if statusUrl not provided.
 */
export async function getImageJobStatus(
  modelId: string,
  requestId: string,
  statusUrl?: string
): Promise<FalStatusResponse> {
  const endpoint = statusUrl
    ? `${statusUrl}?logs=1`
    : `${QUEUE_BASE}/${modelId}/requests/${requestId}/status?logs=1`;

  const resp = await fetch(endpoint, {
    method: "GET",
    headers: { Authorization: `Key ${getApiKey()}` },
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`fal.ai status failed (${resp.status}): ${text.slice(0, 500)}`);
  }

  return (await resp.json()) as FalStatusResponse;
}

/**
 * Get the result of a completed fal.ai queue job.
 * Uses the response_url returned by the submit response for reliability.
 * Falls back to constructed URL if responseUrl not provided.
 */
export async function getImageJobResult(
  modelId: string,
  requestId: string,
  responseUrl?: string
): Promise<FalResultResponse> {
  const endpoint = responseUrl
    || `${QUEUE_BASE}/${modelId}/requests/${requestId}`;

  const resp = await fetch(endpoint, {
    method: "GET",
    headers: { Authorization: `Key ${getApiKey()}` },
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`fal.ai result failed (${resp.status}): ${text.slice(0, 500)}`);
  }

  return (await resp.json()) as FalResultResponse;
}

/**
 * Cancel a queued fal.ai job. Only works for IN_QUEUE status.
 */
export async function cancelImageJob(
  modelId: string,
  requestId: string
): Promise<boolean> {
  const endpoint = `${QUEUE_BASE}/${modelId}/requests/${requestId}/cancel`;

  const resp = await fetch(endpoint, {
    method: "PUT",
    headers: { Authorization: `Key ${getApiKey()}` },
  });

  // 202 = cancelled, 400 = already processing
  return resp.status === 202;
}

/**
 * Download an image from a fal.ai output URL.
 * Returns the raw buffer + content type.
 */
export async function downloadFalImage(
  url: string
): Promise<{ buffer: Buffer; contentType: string }> {
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`Failed to download fal.ai image (${resp.status})`);
  }

  const contentType = resp.headers.get("content-type") || "image/jpeg";
  const arrayBuffer = await resp.arrayBuffer();
  return {
    buffer: Buffer.from(arrayBuffer),
    contentType,
  };
}

// ─── Multi-image (Kontext Max Multi) ───────────────────────

const KONTEXT_MULTI_ENDPOINT = "fal-ai/flux-pro/kontext/max/multi";

/**
 * Submit a multi-image composition job to FLUX.1 Kontext Max Multi.
 * Accepts multiple image_urls and a prompt referencing them by number.
 */
export async function submitMultiImageJob(
  params: FalMultiImageParams
): Promise<FalQueueResponse> {
  const endpoint = `${QUEUE_BASE}/${KONTEXT_MULTI_ENDPOINT}`;

  const resp = await fetch(endpoint, {
    method: "POST",
    headers: falHeaders(),
    body: JSON.stringify(params),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`fal.ai multi-image submit failed (${resp.status}): ${text.slice(0, 500)}`);
  }

  const data = await resp.json();
  if (!data.request_id) {
    throw new Error("fal.ai multi-image submit: missing request_id");
  }

  return data as FalQueueResponse;
}
