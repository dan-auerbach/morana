/**
 * URL detection and content fetching for LLM context injection.
 *
 * Detects URLs in user messages, fetches them server-side,
 * extracts readable text from HTML, and returns the content
 * for injection into the LLM prompt.
 */

const URL_REGEX = /https?:\/\/[^\s<>"')\]]+/gi;
const MAX_URLS = 3;
const FETCH_TIMEOUT_MS = 8000;
const MAX_CONTENT_CHARS = 12000; // per URL
const MAX_TOTAL_CHARS = 30000; // total across all URLs

type FetchedURL = {
  url: string;
  title: string;
  content: string;
  error?: string;
};

/**
 * Extract URLs from text. Returns up to MAX_URLS unique URLs.
 */
export function extractURLs(text: string): string[] {
  const matches = text.match(URL_REGEX);
  if (!matches) return [];

  // Deduplicate and limit
  const unique = [...new Set(matches.map((u) => u.replace(/[.,;:!?)]+$/, "")))];
  return unique.slice(0, MAX_URLS);
}

/**
 * Strip HTML tags and extract readable text content.
 */
function htmlToText(html: string): { title: string; text: string } {
  // Extract title
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1].replace(/\s+/g, " ").trim() : "";

  // Remove script, style, nav, header, footer tags and their content
  let cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<header[\s\S]*?<\/header>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<aside[\s\S]*?<\/aside>/gi, "");

  // Try to extract main/article content first
  const articleMatch = cleaned.match(/<(?:article|main)[^>]*>([\s\S]*?)<\/(?:article|main)>/i);
  if (articleMatch) {
    cleaned = articleMatch[1];
  }

  // Replace block-level elements with newlines
  cleaned = cleaned
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|h[1-6]|li|tr|blockquote|section)>/gi, "\n")
    .replace(/<(?:hr)\s*\/?>/gi, "\n---\n");

  // Remove remaining HTML tags
  cleaned = cleaned.replace(/<[^>]+>/g, " ");

  // Decode common HTML entities
  cleaned = cleaned
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&mdash;/gi, "—")
    .replace(/&ndash;/gi, "–")
    .replace(/&#\d+;/gi, "");

  // Collapse whitespace
  const text = cleaned
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { title, text };
}

/**
 * Fetch a single URL and extract text content.
 */
async function fetchURL(url: string): Promise<FetchedURL> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; Morana/1.0; +https://morana.mojimediji.si)",
        Accept: "text/html,application/xhtml+xml,text/plain,application/json",
      },
      redirect: "follow",
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return { url, title: "", content: "", error: `HTTP ${response.status}` };
    }

    const contentType = response.headers.get("content-type") || "";
    const rawBody = await response.text();

    // JSON response — pretty print
    if (contentType.includes("application/json")) {
      try {
        const json = JSON.parse(rawBody);
        const formatted = JSON.stringify(json, null, 2);
        return {
          url,
          title: "JSON response",
          content: formatted.slice(0, MAX_CONTENT_CHARS),
        };
      } catch {
        return { url, title: "JSON response", content: rawBody.slice(0, MAX_CONTENT_CHARS) };
      }
    }

    // Plain text
    if (contentType.includes("text/plain")) {
      return {
        url,
        title: url.split("/").pop() || "Text",
        content: rawBody.slice(0, MAX_CONTENT_CHARS),
      };
    }

    // HTML — extract readable text
    const { title, text } = htmlToText(rawBody);
    return {
      url,
      title: title || url,
      content: text.slice(0, MAX_CONTENT_CHARS),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    if (msg.includes("abort")) {
      return { url, title: "", content: "", error: "Timeout" };
    }
    return { url, title: "", content: "", error: msg };
  }
}

/**
 * Detect URLs in a message, fetch their content, and return
 * formatted context blocks for LLM injection.
 *
 * Returns empty string if no URLs found or all fetches failed.
 */
export async function fetchURLsFromMessage(message: string): Promise<string> {
  const urls = extractURLs(message);
  if (urls.length === 0) return "";

  // Fetch all URLs in parallel
  const results = await Promise.all(urls.map(fetchURL));

  // Build context blocks
  const blocks: string[] = [];
  let totalChars = 0;

  for (const r of results) {
    if (r.error || !r.content) {
      blocks.push(`[URL: ${r.url}]\n(Failed to fetch: ${r.error || "empty content"})\n`);
      continue;
    }

    // Respect total char budget
    const available = MAX_TOTAL_CHARS - totalChars;
    if (available <= 200) break;

    const truncated = r.content.slice(0, available);
    totalChars += truncated.length;

    blocks.push(
      `[URL: ${r.url}]${r.title ? ` — ${r.title}` : ""}\n${truncated}${truncated.length < r.content.length ? "\n[...truncated]" : ""}\n`
    );
  }

  if (blocks.length === 0) return "";

  return (
    "---\nThe user's message contains URLs. Here is the fetched content from those pages:\n\n" +
    blocks.join("\n") +
    "---"
  );
}
