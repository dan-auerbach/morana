export type CandidateArticle = {
  title: string;
  url: string;
  publishedAt: Date | null;
  sourceName: string;
  sourceType: "rss" | "google_news" | "html" | "x";
};

export type DedupedCandidate = {
  title: string;
  url: string;
  publishedAt: Date | null;
  sourceName: string;
  sourceCount: number;
  sourceNames: string[];
};

export type RankedResult = { url: string; title: string; reason: string };
export type RunLog = { ts: string; phase: string; message: string };

export type AdapterResult = {
  articles: CandidateArticle[];
  errors: string[];
};
