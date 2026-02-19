import type { AdapterResult } from "../types";

/**
 * X/Twitter stub adapter.
 * Returns empty results with a warning if no API key is configured.
 */
export async function fetchX(sourceName: string): Promise<AdapterResult> {
  if (!process.env.X_API_KEY) {
    return {
      articles: [],
      errors: [`X adapter: no X_API_KEY configured, skipping ${sourceName}`],
    };
  }

  // TODO: Implement X/Twitter API integration when API key is available
  return {
    articles: [],
    errors: [`X adapter: not yet implemented for ${sourceName}`],
  };
}
