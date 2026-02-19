import type { AdapterResult, CandidateArticle } from "../types";

const FETCH_TIMEOUT_MS = 10_000;
const USER_AGENT = "Morana/1.0 NewsScout";

/**
 * Extract text content between XML tags.
 * Handles CDATA sections: <![CDATA[...]]>
 */
function tagContent(xml: string, tag: string): string | null {
  // Match <tag>...</tag> or <tag ...>...</tag> (non-greedy)
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i");
  const match = xml.match(re);
  if (!match) return null;
  let content = match[1].trim();
  // Strip CDATA wrapper
  const cdata = content.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  if (cdata) content = cdata[1].trim();
  return content || null;
}

/**
 * Extract href attribute from Atom <link> element.
 */
function atomLinkHref(xml: string): string | null {
  const match = xml.match(/<link[^>]*href=["']([^"']+)["'][^>]*\/?>/i);
  return match ? match[1] : null;
}

/**
 * Split XML into items/entries by tag.
 */
function splitByTag(xml: string, tag: string): string[] {
  const items: string[] = [];
  const re = new RegExp(`<${tag}[\\s>][\\s\\S]*?</${tag}>`, "gi");
  let match;
  while ((match = re.exec(xml)) !== null) {
    items.push(match[0]);
  }
  return items;
}

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
    // Try RSS <item> elements first
    const items = splitByTag(xml, "item");
    if (items.length > 0) {
      for (const itemXml of items) {
        const title = tagContent(itemXml, "title");
        const link = tagContent(itemXml, "link");
        const pubDate = tagContent(itemXml, "pubDate")
          || tagContent(itemXml, "dc:date");
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
      const entries = splitByTag(xml, "entry");
      for (const entryXml of entries) {
        const title = tagContent(entryXml, "title");
        const link = atomLinkHref(entryXml) || tagContent(entryXml, "link");
        const updated = tagContent(entryXml, "updated")
          || tagContent(entryXml, "published");
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
