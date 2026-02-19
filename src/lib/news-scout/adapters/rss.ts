import { parseHTML } from "linkedom";
import type { AdapterResult, CandidateArticle } from "../types";

const FETCH_TIMEOUT_MS = 5000;
const USER_AGENT = "Morana/1.0 NewsScout";

export async function fetchRSS(
  feedUrl: string,
  sourceName: string,
  sourceType: "rss" | "google_news" = "rss"
): Promise<AdapterResult> {
  const articles: CandidateArticle[] = [];
  const errors: string[] = [];

  let xml: string;
  try {
    const resp = await fetch(feedUrl, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!resp.ok) {
      return { articles, errors: [`HTTP ${resp.status} from ${feedUrl}`] };
    }
    xml = await resp.text();
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown fetch error";
    return { articles, errors: [`Fetch failed for ${feedUrl}: ${msg}`] };
  }

  try {
    const { document } = parseHTML(xml);

    // Try RSS <item> elements first
    const items = document.querySelectorAll("item");
    if (items.length > 0) {
      for (const item of items) {
        const title = item.querySelector("title")?.textContent?.trim();
        const link = item.querySelector("link")?.textContent?.trim();
        const pubDate = item.querySelector("pubDate")?.textContent?.trim();
        if (!title || !link) continue;

        articles.push({
          title,
          url: link,
          publishedAt: pubDate ? new Date(pubDate) : null,
          sourceName,
          sourceType,
        });
      }
    } else {
      // Try Atom <entry> elements
      const entries = document.querySelectorAll("entry");
      for (const entry of entries) {
        const title = entry.querySelector("title")?.textContent?.trim();
        const linkEl = entry.querySelector("link");
        const link = linkEl?.getAttribute("href") || linkEl?.textContent?.trim();
        const updated = entry.querySelector("updated")?.textContent?.trim()
          || entry.querySelector("published")?.textContent?.trim();
        if (!title || !link) continue;

        articles.push({
          title,
          url: link,
          publishedAt: updated ? new Date(updated) : null,
          sourceName,
          sourceType,
        });
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown parse error";
    errors.push(`Parse failed for ${feedUrl}: ${msg}`);
  }

  return { articles, errors };
}
