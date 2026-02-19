import { runLLMChat } from "@/lib/providers/llm";
import { getApprovedModelsAsync, type ModelEntry } from "@/lib/config";
import type { DedupedCandidate, RankedResult } from "./types";

const SYSTEM_PROMPT = `You are a news editor AI. Select exactly 3 articles from the candidate list.

CRITERIA (order of importance):
1. IMPORTANCE — significance for the topic
2. READING POTENTIAL — will people read the full article?
3. SHAREABILITY — social media potential
4. DIVERSITY — 3 articles MUST cover 3 different angles

EXCLUDE: sponsored content, product announcements, listicles, clickbait.
Prefer articles with higher source count (more sources = more important).

RESPOND with valid JSON only:
{"results":[{"url":"...","title":"...","reason":"..."},{"url":"...","title":"...","reason":"..."},{"url":"...","title":"...","reason":"..."}]}`;

function formatTimeAgo(date: Date | null): string {
  if (!date) return "unknown";
  const ms = Date.now() - date.getTime();
  const hours = Math.floor(ms / (1000 * 60 * 60));
  if (hours < 1) return "< 1h ago";
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function buildUserMessage(
  candidates: DedupedCandidate[],
  topicDescription: string
): string {
  const lines = [`Topic: ${topicDescription}\n\nCandidates:\n`];
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    lines.push(
      `${i + 1}. ${c.title}\n   URL: ${c.url}\n   Sources: ${c.sourceCount} (${c.sourceNames.join(", ")})\n   Published: ${formatTimeAgo(c.publishedAt)}\n`
    );
  }
  return lines.join("\n");
}

/**
 * Resolve a model name to a ModelEntry.
 * If found in approved models, use that. Otherwise construct a default OpenAI entry.
 */
async function resolveModel(modelName: string): Promise<ModelEntry> {
  const approved = await getApprovedModelsAsync();
  const found = approved.find((m) => m.id === modelName);
  if (found) return found;

  // Fallback: assume OpenAI provider
  return { id: modelName, label: modelName, provider: "openai" };
}

export type RankerResult = {
  results: RankedResult[];
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
};

/**
 * Rank candidates using LLM and return top 3.
 */
export async function rankCandidates(
  candidates: DedupedCandidate[],
  topicDescription: string,
  modelName: string
): Promise<RankerResult> {
  const modelEntry = await resolveModel(modelName);
  const userMessage = buildUserMessage(candidates, topicDescription);

  const llmResult = await runLLMChat(
    modelEntry,
    [{ role: "user", content: userMessage }],
    SYSTEM_PROMPT
  );

  // Parse JSON response
  let results: RankedResult[];
  try {
    const parsed = JSON.parse(llmResult.text);
    results = parsed.results;
    if (!Array.isArray(results) || results.length === 0) {
      throw new Error("No results array in response");
    }
  } catch {
    // Fallback: try to extract URLs from response text
    results = extractUrlsFallback(llmResult.text, candidates);
  }

  // Validate URLs — only include URLs that exist in candidates
  const candidateUrls = new Set(candidates.map((c) => c.url));
  results = results.filter((r) => candidateUrls.has(r.url)).slice(0, 3);

  return {
    results,
    inputTokens: llmResult.inputTokens,
    outputTokens: llmResult.outputTokens,
    latencyMs: llmResult.latencyMs,
  };
}

/**
 * Fallback: extract URLs from text when JSON parsing fails.
 */
function extractUrlsFallback(
  text: string,
  candidates: DedupedCandidate[]
): RankedResult[] {
  const results: RankedResult[] = [];
  const candidateMap = new Map(candidates.map((c) => [c.url, c]));

  const urlRegex = /https?:\/\/[^\s"'<>\])+,]+/g;
  const matches = text.match(urlRegex) || [];
  const seen = new Set<string>();

  for (const url of matches) {
    const cleaned = url.replace(/[.,;:!?)]+$/, "");
    if (seen.has(cleaned)) continue;
    seen.add(cleaned);

    const candidate = candidateMap.get(cleaned);
    if (candidate) {
      results.push({
        url: cleaned,
        title: candidate.title,
        reason: "Selected by LLM (parsed from text)",
      });
    }
    if (results.length >= 3) break;
  }

  return results;
}
