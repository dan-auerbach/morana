import type { CandidateArticle, DedupedCandidate } from "./types";

const TRACKING_PARAMS = new Set([
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
  "ref", "source", "fbclid", "gclid", "mc_cid", "mc_eid",
]);

/**
 * Canonicalize a URL for deduplication:
 * - Strip tracking params
 * - Lowercase host
 * - Strip www.
 * - Strip trailing slash and fragment
 */
function canonicalizeUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    url.hash = "";

    // Remove tracking params
    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING_PARAMS.has(key)) url.searchParams.delete(key);
    }

    // Sort remaining params for consistency
    url.searchParams.sort();

    let result = url.toString();
    // Strip trailing slash (but not for root path)
    if (result.endsWith("/") && url.pathname !== "/") {
      result = result.slice(0, -1);
    }
    return result;
  } catch {
    return rawUrl;
  }
}

/**
 * Compute trigrams from a string for similarity comparison.
 */
function trigrams(text: string): Set<string> {
  const normalized = text.toLowerCase().replace(/[^a-zščžćđ0-9 ]/gi, "").trim();
  const t = new Set<string>();
  for (let i = 0; i <= normalized.length - 3; i++) {
    t.add(normalized.slice(i, i + 3));
  }
  return t;
}

/**
 * Jaccard similarity between two trigram sets.
 */
function trigramSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const t of a) {
    if (b.has(t)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

const SIMILARITY_THRESHOLD = 0.85;

/**
 * Deduplicate articles:
 * 1. Group by canonical URL
 * 2. Cross-URL title similarity > 0.85 = same story → merge
 * 3. Pick representative with earliest publishedAt
 */
export function deduplicateArticles(articles: CandidateArticle[]): DedupedCandidate[] {
  // Step 1: Group by canonical URL
  const urlGroups = new Map<string, CandidateArticle[]>();
  for (const article of articles) {
    const canonical = canonicalizeUrl(article.url);
    const group = urlGroups.get(canonical) || [];
    group.push(article);
    urlGroups.set(canonical, group);
  }

  // Step 2: Build initial deduped list from URL groups
  const candidates: DedupedCandidate[] = [];
  for (const [, group] of urlGroups) {
    // Pick earliest published article as representative
    const sorted = [...group].sort((a, b) => {
      if (!a.publishedAt && !b.publishedAt) return 0;
      if (!a.publishedAt) return 1;
      if (!b.publishedAt) return -1;
      return a.publishedAt.getTime() - b.publishedAt.getTime();
    });
    const rep = sorted[0];
    const sourceNames = [...new Set(group.map((a) => a.sourceName))];
    candidates.push({
      title: rep.title,
      url: rep.url,
      publishedAt: rep.publishedAt,
      sourceName: rep.sourceName,
      sourceCount: sourceNames.length,
      sourceNames,
    });
  }

  // Step 3: Cross-URL title similarity merge
  const trigramCache = candidates.map((c) => trigrams(c.title));
  const merged = new Set<number>(); // indices that were merged into another

  for (let i = 0; i < candidates.length; i++) {
    if (merged.has(i)) continue;
    for (let j = i + 1; j < candidates.length; j++) {
      if (merged.has(j)) continue;
      const sim = trigramSimilarity(trigramCache[i], trigramCache[j]);
      if (sim >= SIMILARITY_THRESHOLD) {
        // Merge j into i
        const namesSet = new Set([...candidates[i].sourceNames, ...candidates[j].sourceNames]);
        candidates[i].sourceNames = [...namesSet];
        candidates[i].sourceCount = namesSet.size;
        // Keep earliest publishedAt
        const jDate = candidates[j].publishedAt;
        const iDate = candidates[i].publishedAt;
        if (jDate && (!iDate || jDate < iDate)) {
          candidates[i].publishedAt = jDate;
        }
        merged.add(j);
      }
    }
  }

  return candidates.filter((_, i) => !merged.has(i));
}
