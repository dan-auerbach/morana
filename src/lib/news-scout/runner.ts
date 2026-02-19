import { prisma } from "@/lib/prisma";
import { logUsage } from "@/lib/usage";
import { estimateCostCents } from "@/lib/config";
import { sendMessage } from "@/lib/telegram";
import { fetchRSS } from "./adapters/rss";
import { fetchGoogleNews } from "./adapters/google-news";
import { fetchHTML, type HtmlSelectors } from "./adapters/html";
import { fetchX } from "./adapters/x";
import { applyFilters } from "./filter";
import { deduplicateArticles } from "./dedup";
import { rankCandidates } from "./ranker";
import type { CandidateArticle, RankedResult, RunLog } from "./types";

function log(logs: RunLog[], phase: string, message: string) {
  logs.push({ ts: new Date().toISOString(), phase, message });
}

export async function executeNewsScoutRun(runId: string): Promise<void> {
  const logs: RunLog[] = [];

  // 1. Load run + topic + all active sources
  const run = await prisma.newsScoutRun.findUnique({
    where: { id: runId },
    include: { topic: true },
  });
  if (!run) throw new Error(`Run ${runId} not found`);
  if (run.status !== "running") return; // idempotency

  const topic = run.topic;
  log(logs, "init", `Topic: ${topic.name} | Model: ${topic.model}`);

  const sources = await prisma.newsScoutSource.findMany({
    where: { workspaceId: run.workspaceId, isActive: true },
  });
  log(logs, "init", `Active sources: ${sources.length}`);

  try {
    // 2. Fetch all sources in parallel
    const fetchResults = await Promise.allSettled(
      sources.map(async (source) => {
        switch (source.type) {
          case "rss":
            return fetchRSS(source.rssUrl || source.baseUrl, source.name);
          case "google_news":
            return fetchGoogleNews(topic.description, source.name);
          case "html": {
            const selectors = source.selectors as HtmlSelectors | null;
            if (!selectors) {
              return { articles: [], errors: [`HTML source ${source.name}: no selectors configured`] };
            }
            return fetchHTML(source.baseUrl, source.name, selectors);
          }
          case "x":
            return fetchX(source.name);
          default:
            return { articles: [], errors: [`Unknown source type: ${source.type}`] };
        }
      })
    );

    // 3. Aggregate results
    let allArticles: CandidateArticle[] = [];
    for (let i = 0; i < fetchResults.length; i++) {
      const result = fetchResults[i];
      if (result.status === "fulfilled") {
        allArticles.push(...result.value.articles);
        for (const err of result.value.errors) {
          log(logs, "fetch", `[${sources[i].name}] ${err}`);
        }
        log(logs, "fetch", `[${sources[i].name}] ${result.value.articles.length} articles`);
      } else {
        log(logs, "fetch", `[${sources[i].name}] ERROR: ${result.reason}`);
      }
    }
    log(logs, "fetch", `Total candidates: ${allArticles.length}`);

    // 4. Enforce maxSourcesPerRun cap
    if (allArticles.length > topic.maxSourcesPerRun) {
      allArticles = allArticles.slice(0, topic.maxSourcesPerRun);
      log(logs, "cap", `Capped to ${topic.maxSourcesPerRun} candidates`);
    }

    // 5. Filter
    const negativeFilters = (topic.negativeFilters as string[]) || [];
    const { filtered, removed } = applyFilters(allArticles, negativeFilters);
    log(logs, "filter", `Passed: ${filtered.length} | Removed: ${removed}`);

    // 6. Dedup
    const deduped = deduplicateArticles(filtered);
    log(logs, "dedup", `After dedup: ${deduped.length} unique stories`);

    // 7. Rank
    let results: RankedResult[];
    let costCents = 0;

    if (deduped.length <= 3) {
      // Use all candidates, skip LLM
      results = deduped.map((c) => ({
        url: c.url,
        title: c.title,
        reason: "Auto-selected (≤3 candidates)",
      }));
      log(logs, "rank", `≤3 candidates, skipping LLM`);
    } else {
      // LLM ranking
      log(logs, "rank", `Ranking ${deduped.length} candidates via ${topic.model}`);
      const rankResult = await rankCandidates(deduped, topic.description, topic.model);
      results = rankResult.results;

      // Log usage
      costCents = estimateCostCents(topic.model, {
        inputTokens: rankResult.inputTokens,
        outputTokens: rankResult.outputTokens,
      });
      log(logs, "rank", `LLM done: ${rankResult.inputTokens} in / ${rankResult.outputTokens} out | ${rankResult.latencyMs}ms | ${costCents}¢`);

      await logUsage({
        runId: null, // NewsScoutRun is not a Run — no FK relation
        userId: run.userId || "system",
        provider: "openai",
        model: topic.model,
        units: {
          inputTokens: rankResult.inputTokens,
          outputTokens: rankResult.outputTokens,
        },
        latencyMs: rankResult.latencyMs,
        workspaceId: run.workspaceId,
      });
    }

    // 8. Update run with results
    const resultUrls = results.map((r) => r.url);
    await prisma.newsScoutRun.update({
      where: { id: runId },
      data: {
        status: "done",
        resultUrls,
        resultMeta: results,
        logs,
        costCents,
        candidateCount: allArticles.length,
        finishedAt: new Date(),
      },
    });

    // 9. Telegram notification
    await notifyTelegram(run.workspaceId, topic.name, results);
    log(logs, "notify", "Telegram notifications sent");
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    log(logs, "error", message);
    await prisma.newsScoutRun.update({
      where: { id: runId },
      data: {
        status: "error",
        errorMessage: message,
        logs,
        finishedAt: new Date(),
      },
    });
    throw err;
  }
}

async function notifyTelegram(
  workspaceId: string,
  topicName: string,
  results: RankedResult[]
): Promise<void> {
  if (results.length === 0) return;

  // Find workspace members with Telegram links
  const members = await prisma.workspaceMember.findMany({
    where: { workspaceId },
    select: { userId: true },
  });

  const telegramLinks = await prisma.telegramLink.findMany({
    where: { userId: { in: members.map((m) => m.userId) } },
  });

  if (telegramLinks.length === 0) return;

  // Build HTML message
  const lines = [`<b>News Scout: ${escapeHtml(topicName)}</b>\n`];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    lines.push(`${i + 1}. <a href="${escapeHtml(r.url)}">${escapeHtml(r.title)}</a>`);
    lines.push(`<i>${escapeHtml(r.reason)}</i>\n`);
  }
  const text = lines.join("\n");

  // Send to each linked user
  for (const link of telegramLinks) {
    try {
      await sendMessage(link.telegramChatId, text, "HTML");
    } catch (err) {
      console.error(
        `[NewsScout] Telegram notify failed for chat ${link.telegramChatId}:`,
        err instanceof Error ? err.message : err
      );
    }
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
