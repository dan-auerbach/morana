/**
 * fal.ai Video Provider — Grok Imagine Video
 *
 * Supports three operations via fal.ai queue API:
 *   - Text-to-Video:   xai/grok-imagine-video/text-to-video
 *   - Image-to-Video:  xai/grok-imagine-video/image-to-video
 *   - Video-to-Video:  xai/grok-imagine-video/edit-video
 *
 * Queue flow: submit → poll status → get result
 * All requests go through https://queue.fal.run/{endpoint}
 */

// ─── Types ─────────────────────────────────────────────────

export type VideoOperation = "text2video" | "img2video" | "video2video";

export type VideoResolution = "480p" | "720p";

export type VideoAspectRatio = "16:9" | "4:3" | "3:2" | "1:1" | "2:3" | "3:4" | "9:16";

export type VideoSubmitParams = {
  prompt: string;
  duration?: number;          // 1-15 seconds, default 6
  aspect_ratio?: string;      // default "16:9" for t2v, "auto" for i2v
  resolution?: VideoResolution; // "480p" | "720p", default "720p"
  // img2video
  image_url?: string;
  // video2video
  video_url?: string;
};

export type VideoQueueResponse = {
  request_id: string;
  response_url: string;
  status_url: string;
  cancel_url: string;
};

export type VideoStatusResponse = {
  status: "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED";
  queue_position?: number;
  logs?: Array<{ message: string; level: string; timestamp: string }>;
};

export type VideoOutput = {
  url: string;
  width: number;
  height: number;
  fps: number;
  duration: number;
  num_frames: number;
  file_name: string;
  content_type: string;
  file_size?: number;
};

export type VideoResultResponse = {
  video: VideoOutput;
};

// ─── Model / operation registry ─────────────────────────────

export const VIDEO_OPERATIONS: Array<{
  id: VideoOperation;
  label: string;
  endpoint: string;
  requiresImage: boolean;
  requiresVideo: boolean;
}> = [
  {
    id: "text2video",
    label: "Text → Video",
    endpoint: "xai/grok-imagine-video/text-to-video",
    requiresImage: false,
    requiresVideo: false,
  },
  {
    id: "img2video",
    label: "Image → Video",
    endpoint: "xai/grok-imagine-video/image-to-video",
    requiresImage: true,
    requiresVideo: false,
  },
  {
    id: "video2video",
    label: "Video → Video",
    endpoint: "xai/grok-imagine-video/edit-video",
    requiresImage: false,
    requiresVideo: true,
  },
];

export const ASPECT_RATIOS: VideoAspectRatio[] = [
  "16:9", "4:3", "3:2", "1:1", "2:3", "3:4", "9:16",
];

// ─── API helpers ───────────────────────────────────────────

const QUEUE_BASE = "https://queue.fal.run";

function getApiKey(): string {
  const key = process.env.FAL_KEY || process.env.FALAI_API_KEY;
  if (!key) throw new Error("FAL_KEY is not configured. Set it in your environment variables.");
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
 * Submit a video generation job to fal.ai queue.
 */
export async function submitVideoJob(
  operation: VideoOperation,
  params: VideoSubmitParams
): Promise<VideoQueueResponse> {
  const op = VIDEO_OPERATIONS.find((o) => o.id === operation);
  if (!op) throw new Error(`Unknown video operation: ${operation}`);

  const endpoint = `${QUEUE_BASE}/${op.endpoint}`;

  const resp = await fetch(endpoint, {
    method: "POST",
    headers: falHeaders(),
    body: JSON.stringify(params),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`fal.ai video submit failed (${resp.status}): ${text.slice(0, 500)}`);
  }

  const data = await resp.json();
  if (!data.request_id) {
    throw new Error("fal.ai video submit: missing request_id in response");
  }

  return data as VideoQueueResponse;
}

/**
 * Poll the status of a fal.ai video queue job.
 * Uses the status_url from submit response.
 */
export async function getVideoJobStatus(
  statusUrl: string
): Promise<VideoStatusResponse> {
  const endpoint = `${statusUrl}?logs=1`;

  const resp = await fetch(endpoint, {
    method: "GET",
    headers: { Authorization: `Key ${getApiKey()}` },
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`fal.ai video status failed (${resp.status}): ${text.slice(0, 500)}`);
  }

  return (await resp.json()) as VideoStatusResponse;
}

/**
 * Get the result of a completed fal.ai video queue job.
 * Uses the response_url from submit response.
 */
export async function getVideoJobResult(
  responseUrl: string
): Promise<VideoResultResponse> {
  const resp = await fetch(responseUrl, {
    method: "GET",
    headers: { Authorization: `Key ${getApiKey()}` },
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`fal.ai video result failed (${resp.status}): ${text.slice(0, 500)}`);
  }

  return (await resp.json()) as VideoResultResponse;
}

/**
 * Cancel a queued fal.ai video job.
 */
export async function cancelVideoJob(cancelUrl: string): Promise<boolean> {
  const resp = await fetch(cancelUrl, {
    method: "PUT",
    headers: { Authorization: `Key ${getApiKey()}` },
  });
  return resp.status === 202;
}

/**
 * Download a video from a fal.ai output URL.
 */
export async function downloadFalVideo(
  url: string
): Promise<{ buffer: Buffer; contentType: string }> {
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`Failed to download fal.ai video (${resp.status})`);
  }

  const contentType = resp.headers.get("content-type") || "video/mp4";
  const arrayBuffer = await resp.arrayBuffer();
  return {
    buffer: Buffer.from(arrayBuffer),
    contentType,
  };
}

// ─── Pricing helpers ───────────────────────────────────────

/** Estimate cost for a video generation in dollars */
export function estimateVideoCostDollars(
  resolution: VideoResolution,
  durationSec: number,
  operation: VideoOperation
): number {
  const outputRate = resolution === "720p" ? 0.07 : 0.05;
  let cost = durationSec * outputRate;

  // img2video adds $0.002 flat fee for image input
  if (operation === "img2video") {
    cost += 0.002;
  }

  // video2video adds $0.01/sec input cost
  if (operation === "video2video") {
    cost += durationSec * 0.01;
  }

  return cost;
}
