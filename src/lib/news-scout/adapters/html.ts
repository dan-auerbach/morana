import { parseHTML } from "linkedom";
import { validateFetchUrl } from "@/lib/url-validate";
import type { AdapterResult, CandidateArticle } from "../types";

const FETCH_TIMEOUT_MS = 5000;
const USER_AGENT = "Morana/1.0 NewsScout";
const MAX_ARTICLES = 20;

export type HtmlSelectors = {
  listSelector: string;   // e.g. "article" or ".news-item"
  titleSelector: string;  // e.g. "h2" or ".title"
  linkSelector: string;   // e.g. "a" or "h2 a"
  dateSelector?: string;  // e.g. "time" or ".date"
};

export async function fetchHTML(
  baseUrl: string,
  sourceName: string,
  selectors: HtmlSelectors
): Promise<AdapterResult> {
  const articles: CandidateArticle[] = [];
  const errors: string[] = [];

  // SSRF protection
  const validation = await validateFetchUrl(baseUrl);
  if (!validation.valid) {
    return { articles, errors: [`SSRF blocked: ${validation.reason}`] };
  }

  let html: string;
  try {
    const resp = await fetch(validation.url, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!resp.ok) {
      return { articles, errors: [`HTTP ${resp.status} from ${baseUrl}`] };
    }
    html = await resp.text();
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown fetch error";
    return { articles, errors: [`Fetch failed for ${baseUrl}: ${msg}`] };
  }

  try {
    const { document } = parseHTML(html);
    const items = document.querySelectorAll(selectors.listSelector);

    let count = 0;
    for (const item of items) {
      if (count >= MAX_ARTICLES) break;

      const titleEl = item.querySelector(selectors.titleSelector);
      const linkEl = item.querySelector(selectors.linkSelector);
      const title = titleEl?.textContent?.trim();
      const href = linkEl?.getAttribute("href");

      if (!title || !href) continue;

      // Resolve relative URLs
      let absoluteUrl: string;
      try {
        absoluteUrl = new URL(href, baseUrl).toString();
      } catch {
        continue;
      }

      let publishedAt: Date | null = null;
      if (selectors.dateSelector) {
        const dateEl = item.querySelector(selectors.dateSelector);
        const dateStr = dateEl?.getAttribute("datetime") || dateEl?.textContent?.trim();
        if (dateStr) {
          const parsed = new Date(dateStr);
          if (!isNaN(parsed.getTime())) publishedAt = parsed;
        }
      }

      articles.push({
        title,
        url: absoluteUrl,
        publishedAt,
        sourceName,
        sourceType: "html",
      });
      count++;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown parse error";
    errors.push(`Parse failed for ${baseUrl}: ${msg}`);
  }

  return { articles, errors };
}
