import { fetchRSS } from "./rss";
import type { AdapterResult } from "../types";

/**
 * Google News RSS adapter.
 * Builds a Google News RSS search URL for the topic description and delegates to RSS adapter.
 */
export async function fetchGoogleNews(
  topicDescription: string,
  sourceName: string
): Promise<AdapterResult> {
  const query = encodeURIComponent(topicDescription);
  const feedUrl = `https://news.google.com/rss/search?q=${query}&hl=sl&gl=SI&ceid=SI:sl`;

  const result = await fetchRSS(feedUrl, sourceName, "google_news");

  // Extract actual URL from Google redirect links where possible
  for (const article of result.articles) {
    const actual = extractGoogleNewsUrl(article.url);
    if (actual) article.url = actual;
  }

  return result;
}

/**
 * Google News wraps article URLs in redirect links like:
 * https://news.google.com/rss/articles/... or
 * https://news.google.com/__i/rss/rd/articles/...
 *
 * Some redirect URLs contain the actual URL as a base64 or query param.
 * For most, we try to extract from common patterns.
 */
function extractGoogleNewsUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    // Some Google News URLs have the actual URL in query params
    const articleUrl = parsed.searchParams.get("url");
    if (articleUrl) return articleUrl;
  } catch {
    // Not a valid URL, return null
  }
  return null;
}
