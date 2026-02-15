/**
 * URL detection and content fetching for LLM context injection.
 *
 * Detects URLs in user messages, fetches them server-side,
 * extracts readable text using Mozilla Readability (same algorithm
 * as Firefox Reader View), and returns the content for injection
 * into the LLM prompt.
 */

import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";

const URL_REGEX = /https?:\/\/[^\s<>"')\]]+/gi;
const MAX_URLS = 3;
const FETCH_TIMEOUT_MS = 8000;
const MAX_CONTENT_CHARS = 12000; // per URL
const MAX_TOTAL_CHARS = 30000; // total across all URLs

type FetchedURL = {
  url: string;
  title: string;
  meta: string; // meta description / og:description
  content: string;
  error?: string;
};

/**
 * Extract URLs from text. Returns up to MAX_URLS unique URLs.
 */
export function extractURLs(text: string): string[] {
  const matches = text.match(URL_REGEX);
  if (!matches) return [];

  // Deduplicate, strip trailing punctuation, and limit
  const unique = [...new Set(matches.map((u) => u.replace(/[.,;:!?)]+$/, "")))];
  return unique.slice(0, MAX_URLS);
}

/**
 * Extract metadata from raw HTML before Readability processes it.
 * Returns title, description, and any JSON-LD structured data summary.
 */
function extractMeta(html: string): { title: string; description: string; jsonLd: string } {
  // Title
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1].replace(/\s+/g, " ").trim() : "";

  // Meta description
  const descMatch =
    html.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([\s\S]*?)["'][^>]*>/i) ||
    html.match(/<meta[^>]*content=["']([\s\S]*?)["'][^>]*property=["']og:description["'][^>]*>/i) ||
    html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([\s\S]*?)["'][^>]*>/i) ||
    html.match(/<meta[^>]*content=["']([\s\S]*?)["'][^>]*name=["']description["'][^>]*>/i);
  const description = descMatch ? descMatch[1].replace(/\s+/g, " ").trim() : "";

  // JSON-LD structured data (extract key facts)
  let jsonLd = "";
  const jsonLdMatches = html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  for (const match of jsonLdMatches) {
    try {
      const data = JSON.parse(match[1]);
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        // Extract the most useful fields from common schema types
        const parts: string[] = [];
        if (item["@type"]) parts.push(`Type: ${item["@type"]}`);
        if (item.headline) parts.push(`Headline: ${item.headline}`);
        if (item.description) parts.push(`Description: ${item.description}`);
        if (item.datePublished) parts.push(`Published: ${item.datePublished}`);
        if (item.author) {
          const authorName = typeof item.author === "string"
            ? item.author
            : item.author?.name || (Array.isArray(item.author) ? item.author.map((a: Record<string, string>) => a.name).join(", ") : "");
          if (authorName) parts.push(`Author: ${authorName}`);
        }
        if (item.about) parts.push(`About: ${typeof item.about === "string" ? item.about : JSON.stringify(item.about)}`);
        if (parts.length > 1) { // only include if we got more than just @type
          jsonLd += parts.join(" | ") + "\n";
        }
      }
    } catch {
      // Invalid JSON-LD — skip
    }
  }

  return { title, description, jsonLd: jsonLd.trim() };
}

/**
 * Use Mozilla Readability to extract article content from HTML.
 * Falls back to basic text extraction if Readability fails.
 */
function extractContent(html: string, url: string): { title: string; content: string } {
  try {
    const { document } = parseHTML(html);

    const reader = new Readability(document, {
      charThreshold: 100,
    });
    const article = reader.parse();

    if (article && article.textContent && article.textContent.trim().length > 100) {
      // Clean up the text content
      const text = article.textContent
        .split("\n")
        .map((line: string) => line.replace(/\s+/g, " ").trim())
        .filter((line: string) => line.length > 0)
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();

      return {
        title: article.title || "",
        content: text,
      };
    }
  } catch (err) {
    console.error("[URL Fetch] Readability failed for", url, err instanceof Error ? err.message : err);
  }

  // Fallback: basic regex extraction
  return fallbackExtract(html);
}

/**
 * Basic regex-based text extraction as fallback.
 */
function fallbackExtract(html: string): { title: string; content: string } {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1].replace(/\s+/g, " ").trim() : "";

  let cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<aside[\s\S]*?<\/aside>/gi, "");

  const articleMatch = cleaned.match(/<(?:article|main)[^>]*>([\s\S]*?)<\/(?:article|main)>/i);
  if (articleMatch) cleaned = articleMatch[1];

  cleaned = cleaned
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|h[1-6]|li|tr|blockquote|section)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");

  const content = cleaned
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { title, content };
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
      return { url, title: "", meta: "", content: "", error: `HTTP ${response.status}` };
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
          meta: "",
          content: formatted.slice(0, MAX_CONTENT_CHARS),
        };
      } catch {
        return { url, title: "JSON response", meta: "", content: rawBody.slice(0, MAX_CONTENT_CHARS) };
      }
    }

    // Plain text
    if (contentType.includes("text/plain")) {
      return {
        url,
        title: url.split("/").pop() || "Text",
        meta: "",
        content: rawBody.slice(0, MAX_CONTENT_CHARS),
      };
    }

    // HTML — extract with Readability + meta
    const meta = extractMeta(rawBody);
    const { title, content } = extractContent(rawBody, url);

    return {
      url,
      title: meta.title || title || url,
      meta: [meta.description, meta.jsonLd].filter(Boolean).join("\n"),
      content: content.slice(0, MAX_CONTENT_CHARS),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    if (msg.includes("abort")) {
      return { url, title: "", meta: "", content: "", error: "Timeout" };
    }
    return { url, title: "", meta: "", content: "", error: msg };
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

    // Build context block with meta + content
    const parts: string[] = [];
    parts.push(`[URL: ${r.url}]${r.title ? ` — ${r.title}` : ""}`);

    if (r.meta) {
      parts.push(`[META] ${r.meta}`);
    }

    const truncatedContent = r.content.slice(0, available);
    parts.push(truncatedContent);

    if (truncatedContent.length < r.content.length) {
      parts.push("[...truncated]");
    }

    const block = parts.join("\n") + "\n";
    totalChars += block.length;
    blocks.push(block);
  }

  if (blocks.length === 0) return "";

  return (
    "---\nThe user's message contains URLs. Here is the fetched content from those pages. " +
    "Use ONLY the information provided below — do not hallucinate or infer facts not present in the text.\n\n" +
    blocks.join("\n") +
    "---"
  );
}
