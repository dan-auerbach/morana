import type { CandidateArticle } from "./types";

const PAYWALL_URL_PATTERNS = ["/premium/", "/paywall/", "/subscriber"];
const PAYWALL_TITLE_PATTERNS = [
  "subscribers only",
  "naročniki",
  "premium",
  "samo za naročnike",
];

/**
 * Sequential filter pipeline:
 * 1. Time: reject articles older than hoursBack (keep null publishedAt)
 * 2. Paywall: reject known paywall URL patterns and title patterns
 * 3. Negative keywords: reject titles matching topic negativeFilters
 */
export function applyFilters(
  articles: CandidateArticle[],
  negativeFilters: string[],
  hoursBack = 24
): { filtered: CandidateArticle[]; removed: number } {
  const cutoff = new Date(Date.now() - hoursBack * 60 * 60 * 1000);
  const originalCount = articles.length;

  const filtered = articles.filter((article) => {
    // 1. Time filter — reject old articles, keep articles with no date
    if (article.publishedAt && article.publishedAt < cutoff) return false;

    // 2. Paywall URL filter
    const urlLower = article.url.toLowerCase();
    if (PAYWALL_URL_PATTERNS.some((p) => urlLower.includes(p))) return false;

    // 3. Paywall title filter
    const titleLower = article.title.toLowerCase();
    if (PAYWALL_TITLE_PATTERNS.some((p) => titleLower.includes(p))) return false;

    // 4. Negative keyword filter
    if (negativeFilters.length > 0) {
      const negLower = negativeFilters.map((f) => f.toLowerCase());
      if (negLower.some((kw) => titleLower.includes(kw))) return false;
    }

    return true;
  });

  return { filtered, removed: originalCount - filtered.length };
}
