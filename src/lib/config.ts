// Guardrails — all configurable via ENV
export const config = {
  maxFileSizeMb: parseInt(process.env.MAX_FILE_SIZE_MB || "50", 10),
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

// Approved models — change via ENV or here
export type ModelEntry = { id: string; label: string; provider: "anthropic" | "gemini" | "openai" };

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
          id: process.env.OPENAI_MODEL || "gpt-4o",
          label: "OpenAI GPT-4o",
          provider: "openai" as const,
        },
        {
          id: "gpt-4o-mini",
          label: "OpenAI GPT-4o Mini",
          provider: "openai" as const,
        },
      ]
    : []),
];

export function getApprovedModels(): ModelEntry[] {
  return defaultModels;
}

// Pricing map — costs expressed per unit (tokens/chars/minutes)
export const pricing: Record<string, { input: number; output: number; unit: string }> = {
  "claude-sonnet-4-5-20250929": { input: 3.0, output: 15.0, unit: "1M_tokens" },
  "gemini-2.0-flash": { input: 0.1, output: 0.4, unit: "1M_tokens" },
  "gemini-2.5-flash-image": { input: 0.15, output: 30.0, unit: "1M_tokens" },
  "gpt-4o": { input: 2.5, output: 10.0, unit: "1M_tokens" },
  "gpt-4o-mini": { input: 0.15, output: 0.6, unit: "1M_tokens" },
  soniox: { input: 0.35, output: 0, unit: "per_minute" },
  elevenlabs: { input: 0.30, output: 0, unit: "1k_chars" },
};

/**
 * Estimate cost in CENTS (integer).
 * All DB cost fields store cents to avoid float rounding errors.
 */
export function estimateCostCents(
  model: string,
  units: { inputTokens?: number; outputTokens?: number; chars?: number; seconds?: number }
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
  }
  return Math.round(dollars * 100);
}

/** Format cents as dollar string for display */
export function centsToUsd(cents: number): string {
  return `$${(cents / 100).toFixed(4)}`;
}
