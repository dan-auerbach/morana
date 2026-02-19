/**
 * Lightweight HTML sanitizer for body content before sending to Drupal.
 * Regex-based (consistent with the codebase's markdown→HTML conversion approach).
 */

const ALLOWED_TAGS = new Set([
  "p", "h1", "h2", "h3", "h4", "h5", "h6",
  "strong", "em", "b", "i",
  "ul", "ol", "li",
  "a", "blockquote", "br", "img",
  "figure", "figcaption",
  "table", "thead", "tbody", "tr", "td", "th",
]);

const ALLOWED_ATTRS = new Set(["href", "src", "alt", "title", "class"]);

/**
 * Sanitize HTML: strip dangerous tags and attributes.
 *
 * - Removes <script>, <style>, <iframe>, <object>, <embed> and their content
 * - Removes all on* event handler attributes (onclick, onload, onerror, etc.)
 * - Keeps only allowlisted tags and attributes
 */
export function sanitizeHtml(html: string): string {
  let result = html;

  // 1. Strip dangerous tags WITH their content (these can contain executable code)
  result = result.replace(/<script[\s\S]*?<\/script\s*>/gi, "");
  result = result.replace(/<style[\s\S]*?<\/style\s*>/gi, "");
  result = result.replace(/<iframe[\s\S]*?<\/iframe\s*>/gi, "");
  result = result.replace(/<object[\s\S]*?<\/object\s*>/gi, "");
  result = result.replace(/<embed[\s\S]*?(?:\/>|<\/embed\s*>)/gi, "");

  // Also strip self-closing variants
  result = result.replace(/<(?:script|style|iframe|object|embed)\b[^>]*\/?>/gi, "");

  // 2. Remove all on* event handler attributes
  result = result.replace(/\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "");

  // 3. Remove javascript: URLs from href/src
  result = result.replace(/(href|src)\s*=\s*(?:"javascript:[^"]*"|'javascript:[^']*')/gi, "$1=\"\"");

  // 4. Strip non-allowlisted tags (keep their content)
  result = result.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*\/?>/g, (match, tagName) => {
    const tag = tagName.toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) {
      return ""; // Strip the tag, keep surrounding content
    }

    // For allowed tags, filter attributes
    if (match.startsWith("</")) {
      return `</${tag}>`; // Closing tags don't have attributes
    }

    // Extract and filter attributes
    const selfClosing = match.endsWith("/>");
    const attrString = match.replace(/^<[a-zA-Z][a-zA-Z0-9]*/, "").replace(/\/?>$/, "");
    const attrs: string[] = [];

    const attrRegex = /\s+([a-zA-Z][\w-]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|(\S+)))?/g;
    let attrMatch;
    while ((attrMatch = attrRegex.exec(attrString)) !== null) {
      const attrName = attrMatch[1].toLowerCase();
      if (ALLOWED_ATTRS.has(attrName)) {
        const value = attrMatch[2] ?? attrMatch[3] ?? attrMatch[4] ?? "";
        attrs.push(`${attrName}="${value}"`);
      }
    }

    const attrStr = attrs.length > 0 ? " " + attrs.join(" ") : "";
    return selfClosing ? `<${tag}${attrStr} />` : `<${tag}${attrStr}>`;
  });

  return result.trim();
}
