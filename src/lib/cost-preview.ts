/**
 * Client-side cost estimation utilities.
 * Runs in the browser — no API call needed.
 */

export type PricingInfo = {
  input: number;
  output: number;
  unit: string; // "1M_tokens" | "1k_chars" | "per_minute"
};

/**
 * Rough token count estimate.
 * ~4 characters per token for English, ~3 for Slovenian.
 * Conservative: use 3.5 chars/token.
 */
export function estimateTokenCount(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 3.5);
}

/**
 * Estimate cost in cents (integer) for LLM usage.
 */
export function previewLLMCost(
  pricing: PricingInfo | undefined,
  inputChars: number,
  expectedOutputTokens?: number
): { inputTokens: number; outputTokens: number; estimatedCostCents: number } | null {
  if (!pricing || pricing.unit !== "1M_tokens") return null;

  const inputTokens = Math.ceil(inputChars / 3.5);
  const outputTokens = expectedOutputTokens ?? Math.min(inputTokens, 2000); // default: expect up to 2000 output tokens

  const dollars =
    (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
  const estimatedCostCents = Math.round(dollars * 100 * 100) / 100; // 2 decimal cent precision

  return { inputTokens, outputTokens, estimatedCostCents };
}

/**
 * Estimate cost for STT (speech-to-text) based on audio duration.
 */
export function previewSTTCost(
  pricing: PricingInfo | undefined,
  durationSeconds: number
): { minutes: number; estimatedCostCents: number } | null {
  if (!pricing || pricing.unit !== "per_minute") return null;
  const minutes = durationSeconds / 60;
  const dollars = minutes * pricing.input;
  return {
    minutes: Math.round(minutes * 10) / 10,
    estimatedCostCents: Math.round(dollars * 100 * 100) / 100,
  };
}

/**
 * Estimate cost for TTS (text-to-speech) based on character count.
 */
export function previewTTSCost(
  pricing: PricingInfo | undefined,
  charCount: number
): { chars: number; estimatedCostCents: number } | null {
  if (!pricing || pricing.unit !== "1k_chars") return null;
  const dollars = (charCount / 1000) * pricing.input;
  return {
    chars: charCount,
    estimatedCostCents: Math.round(dollars * 100 * 100) / 100,
  };
}

/**
 * Format cents as a display string.
 */
export function formatCostCents(cents: number): string {
  if (cents < 1) return `$${(cents / 100).toFixed(6)}`;
  if (cents < 100) return `$${(cents / 100).toFixed(4)}`;
  return `$${(cents / 100).toFixed(2)}`;
}
