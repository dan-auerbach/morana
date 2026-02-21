import { prisma } from "./prisma";

// Guardrails — all configurable via ENV
export const config = {
  maxFileSizeMb: parseInt(process.env.MAX_FILE_SIZE_MB || "500", 10),
  maxUrlFetchSeconds: parseInt(process.env.MAX_URL_FETCH_SECONDS || "60", 10),
  maxTtsChars: parseInt(process.env.MAX_TTS_CHARS || "10000", 10),
  maxLlmPromptChars: parseInt(process.env.MAX_LLM_PROMPT_CHARS || "200000", 10),
  maxRunsPerDayPerUser: parseInt(process.env.MAX_RUNS_PER_DAY_PER_USER || "200", 10),
  /** Global monthly cost cap in CENTS. Default 30000 = $300 / ~€300 */
  globalMaxMonthlyCostCents: parseInt(process.env.GLOBAL_MAX_MONTHLY_COST_CENTS || "30000", 10),
  /**
   * ALLOWED_EMAILS is BOOTSTRAP ONLY.
   * On first sign-in these emails get auto-created in the DB.
   * After that the DB User table is the single source of truth.
   */
  bootstrapEmails: (process.env.ALLOWED_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
};

// Approved models — DB-driven with ENV fallback
export type ModelEntry = { id: string; label: string; provider: "anthropic" | "gemini" | "openai" };

// ─── ENV-based fallback models (used when DB has no AIModel records) ───
const defaultModels: ModelEntry[] = [
  {
    id: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5-20250929",
    label: "Anthropic Sonnet",
    provider: "anthropic",
  },
  // Only include Gemini if GEMINI_API_KEY is configured
  ...(process.env.GEMINI_API_KEY
    ? [
        {
          id: process.env.GEMINI_MODEL || "gemini-2.0-flash",
          label: "Gemini Flash",
          provider: "gemini" as const,
        },
      ]
    : []),
  // Only include OpenAI if OPENAI_API_KEY is configured
  ...(process.env.OPENAI_API_KEY
    ? [
        {
          id: process.env.OPENAI_MODEL || "gpt-5-mini",
          label: "OpenAI GPT-5 Mini",
          provider: "openai" as const,
        },
        {
          id: "gpt-5.2",
          label: "OpenAI GPT-5.2",
          provider: "openai" as const,
        },
        {
          id: "gpt-4o",
          label: "OpenAI GPT-4o",
          provider: "openai" as const,
        },
      ]
    : []),
];

// ─── In-memory cache for DB-driven models (60s TTL) ───
let cachedModels: ModelEntry[] | null = null;
let cachedPricing: Record<string, { input: number; output: number; unit: string }> | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 60_000; // 60 seconds

function isCacheValid(): boolean {
  return cachedModels !== null && Date.now() - cacheTimestamp < CACHE_TTL_MS;
}

/**
 * Load models from AIModel DB table. If table is empty, fall back to ENV config.
 * Results are cached in-memory for 60s to avoid per-request DB queries.
 */
export async function getApprovedModelsAsync(): Promise<ModelEntry[]> {
  if (isCacheValid() && cachedModels) return cachedModels;

  try {
    const dbModels = await prisma.aIModel.findMany({
      where: { isEnabled: true },
      orderBy: { sortOrder: "asc" },
    });

    if (dbModels.length === 0) {
      // No DB records yet — use ENV fallback
      cachedModels = defaultModels;
      cacheTimestamp = Date.now();
      return defaultModels;
    }

    cachedModels = dbModels.map((m) => ({
      id: m.modelId,
      label: m.label,
      provider: m.provider as "anthropic" | "gemini" | "openai",
    }));

    // Also cache pricing from DB
    cachedPricing = {};
    for (const m of dbModels) {
      cachedPricing[m.modelId] = {
        input: m.pricingInput,
        output: m.pricingOutput,
        unit: m.pricingUnit,
      };
    }

    cacheTimestamp = Date.now();
    return cachedModels;
  } catch {
    // DB error — fall back to ENV config
    return defaultModels;
  }
}

/**
 * Synchronous model getter — returns cached DB models if available, else ENV fallback.
 * Use getApprovedModelsAsync() for guaranteed fresh data.
 */
export function getApprovedModels(): ModelEntry[] {
  if (cachedModels) return cachedModels;
  return defaultModels;
}

/** Invalidate the model cache (call after admin changes) */
export function invalidateModelCache(): void {
  cachedModels = null;
  cachedPricing = null;
  cacheTimestamp = 0;
}

// ─── Pricing ───
// Hardcoded pricing fallback (used when DB has no AIModel records)
const defaultPricing: Record<string, { input: number; output: number; unit: string }> = {
  "claude-sonnet-4-5-20250929": { input: 3.0, output: 15.0, unit: "1M_tokens" },
  "gemini-2.0-flash": { input: 0.1, output: 0.4, unit: "1M_tokens" },
  "gemini-2.5-flash-image": { input: 0.15, output: 30.0, unit: "1M_tokens" },
  "gpt-5-mini": { input: 0.25, output: 2.0, unit: "1M_tokens" },
  "gpt-5.2": { input: 1.75, output: 14.0, unit: "1M_tokens" },
  "gpt-4o": { input: 2.5, output: 10.0, unit: "1M_tokens" },
  soniox: { input: 0.0017, output: 0, unit: "per_minute" },
  elevenlabs: { input: 0.30, output: 0, unit: "1k_chars" },
  "fal-ai/flux/schnell": { input: 0.025, output: 0, unit: "per_image" },
  "fal-ai/flux/dev": { input: 0.055, output: 0, unit: "per_image" },
  "fal-ai/flux-pro/kontext/max/multi": { input: 0.08, output: 0, unit: "per_image" },
  "fal-ai/face-swap": { input: 0.10, output: 0, unit: "per_image" },
  "fal-ai/flux-2/edit": { input: 0.025, output: 0, unit: "per_image" },
  // Video: Grok Imagine — cost per second of output video
  "grok-imagine-video-480p": { input: 0.05, output: 0, unit: "per_second" },
  "grok-imagine-video-720p": { input: 0.07, output: 0, unit: "per_second" },
};

/** Combined pricing: DB-cached pricing merged with hardcoded defaults */
export const pricing: Record<string, { input: number; output: number; unit: string }> = new Proxy(
  defaultPricing,
  {
    get(target, prop: string) {
      // Check DB cache first, then hardcoded default
      if (cachedPricing && cachedPricing[prop]) return cachedPricing[prop];
      return target[prop];
    },
    has(target, prop: string) {
      if (cachedPricing && prop in cachedPricing) return true;
      return prop in target;
    },
  }
);

/**
 * Estimate cost in CENTS (integer).
 * All DB cost fields store cents to avoid float rounding errors.
 */
export function estimateCostCents(
  model: string,
  units: { inputTokens?: number; outputTokens?: number; chars?: number; seconds?: number; images?: number; videoSeconds?: number }
): number {
  const p = pricing[model];
  if (!p) return 0;
  let dollars = 0;
  if (p.unit === "1M_tokens") {
    dollars = ((units.inputTokens || 0) * p.input + (units.outputTokens || 0) * p.output) / 1_000_000;
  } else if (p.unit === "1k_chars") {
    dollars = ((units.chars || 0) * p.input) / 1000;
  } else if (p.unit === "per_minute") {
    dollars = ((units.seconds || 0) / 60) * p.input;
  } else if (p.unit === "per_image") {
    dollars = (units.images || 0) * p.input;
  } else if (p.unit === "per_second") {
    dollars = (units.videoSeconds || 0) * p.input;
  }
  return Math.round(dollars * 100);
}

/** Format cents as dollar string for display */
export function centsToUsd(cents: number): string {
  return `$${(cents / 100).toFixed(4)}`;
}
