import { prisma } from "./prisma";
import { getApprovedModels } from "./config";
import { runLLMChat } from "./providers/llm";
import { logUsage } from "./usage";

type StepConfig = {
  modelId?: string;
  systemPrompt?: string;
  userPromptTemplate?: string;
  language?: string;
  voiceId?: string;
  promptTemplate?: string;
  formats?: string[];
  knowledgeBaseIds?: string[];
  templateId?: string;
};

/**
 * Execute a recipe, processing steps sequentially.
 * Each step's output becomes the next step's input.
 */
export async function executeRecipe(executionId: string): Promise<void> {
  const execution = await prisma.recipeExecution.findUnique({
    where: { id: executionId },
    include: {
      recipe: {
        include: { steps: { orderBy: { stepIndex: "asc" } } },
      },
    },
  });

  if (!execution) throw new Error("Execution not found");

  // Mark as running
  await prisma.recipeExecution.update({
    where: { id: executionId },
    data: { status: "running" },
  });

  let previousOutput = "";

  // Get initial input from execution data
  const inputData = execution.inputData as { text?: string } | null;
  if (inputData?.text) {
    previousOutput = inputData.text;
  }

  const steps = execution.recipe.steps;

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const config = step.config as StepConfig;

    // Check if execution was cancelled
    const currentExec = await prisma.recipeExecution.findUnique({
      where: { id: executionId },
      select: { status: true },
    });
    if (currentExec?.status === "cancelled") return;

    // Create step result record
    const stepResult = await prisma.recipeStepResult.create({
      data: {
        executionId,
        stepIndex: step.stepIndex,
        status: "running",
        inputPreview: previousOutput.substring(0, 500),
        startedAt: new Date(),
      },
    });

    // Update execution progress
    await prisma.recipeExecution.update({
      where: { id: executionId },
      data: {
        currentStep: i,
        progress: Math.round((i / steps.length) * 100),
      },
    });

    try {
      let output = "";

      if (step.type === "llm") {
        output = await executeLLMStep(execution.userId, config, previousOutput);
      } else if (step.type === "output_format") {
        // Output format step: just structure the output
        output = formatOutput(previousOutput, config.formats || ["markdown"]);
      } else {
        // STT, TTS, Image — these are more complex and require file handling
        // For now, pass through with a note
        output = previousOutput || `[Step ${step.name}: ${step.type} processing would occur here]`;
      }

      // Update step result
      await prisma.recipeStepResult.update({
        where: { id: stepResult.id },
        data: {
          status: "done",
          outputPreview: output.substring(0, 500),
          outputFull: { text: output },
          finishedAt: new Date(),
        },
      });

      previousOutput = output;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Step failed";

      await prisma.recipeStepResult.update({
        where: { id: stepResult.id },
        data: {
          status: "error",
          errorMessage: msg,
          finishedAt: new Date(),
        },
      });

      // Mark execution as error
      await prisma.recipeExecution.update({
        where: { id: executionId },
        data: {
          status: "error",
          errorMessage: `Step ${i + 1} (${step.name}) failed: ${msg}`,
          finishedAt: new Date(),
        },
      });

      return;
    }
  }

  // All steps completed
  await prisma.recipeExecution.update({
    where: { id: executionId },
    data: {
      status: "done",
      progress: 100,
      currentStep: steps.length,
      finishedAt: new Date(),
    },
  });
}

/**
 * Execute a single LLM step.
 */
async function executeLLMStep(
  userId: string,
  config: StepConfig,
  input: string
): Promise<string> {
  const models = getApprovedModels();
  const modelEntry = models.find((m) => m.id === config.modelId) || models[0];

  if (!modelEntry) throw new Error("No LLM model available");

  // Build prompt
  let userContent = input;
  if (config.userPromptTemplate) {
    userContent = config.userPromptTemplate.replace(/\{\{input\}\}/g, input);
  }

  // Create a run for cost tracking
  const run = await prisma.run.create({
    data: {
      userId,
      type: "llm",
      status: "running",
      provider: modelEntry.provider,
      model: modelEntry.id,
    },
  });

  try {
    const result = await runLLMChat(
      modelEntry,
      [{ role: "user", content: userContent }],
      config.systemPrompt
    );

    await prisma.run.update({
      where: { id: run.id },
      data: { status: "done", finishedAt: new Date() },
    });

    await logUsage({
      runId: run.id,
      userId,
      provider: modelEntry.provider,
      model: modelEntry.id,
      units: { inputTokens: result.inputTokens, outputTokens: result.outputTokens },
      latencyMs: result.latencyMs,
    });

    return result.text;
  } catch (err) {
    await prisma.run.update({
      where: { id: run.id },
      data: { status: "error", errorMessage: err instanceof Error ? err.message : "LLM failed", finishedAt: new Date() },
    });
    throw err;
  }
}

/**
 * Format output in requested formats.
 */
function formatOutput(text: string, formats: string[]): string {
  const sections: string[] = [];

  for (const fmt of formats) {
    if (fmt === "markdown") {
      sections.push(`## Markdown\n\n${text}`);
    } else if (fmt === "html") {
      const html = text
        .split("\n\n")
        .map((p) => `<p>${p}</p>`)
        .join("\n");
      sections.push(`## HTML\n\n${html}`);
    } else if (fmt === "json") {
      sections.push(
        `## JSON\n\n\`\`\`json\n${JSON.stringify({ content: text, generatedAt: new Date().toISOString() }, null, 2)}\n\`\`\``
      );
    } else if (fmt === "drupal_json") {
      sections.push(formatDrupalOutput(text));
    }
  }

  return sections.join("\n\n---\n\n");
}

/**
 * NOVINAR Drupal-ready output format.
 * Expects the input to contain an article (from LLM step) followed by
 * SEO JSON (from the SEO step). Combines them into a structured Drupal payload.
 */
function formatDrupalOutput(text: string): string {
  // The input contains the article text followed by SEO JSON from the previous step
  // Try to parse SEO JSON from the input
  let seo: {
    titles?: { type: string; text: string }[];
    metaDescription?: string;
    keywords?: string[];
    tags?: string[];
    slug?: string;
  } = {};
  let articleText = text;

  // Try to extract JSON from the text (SEO step output)
  const jsonMatch = text.match(/\{[\s\S]*"titles"[\s\S]*\}/);
  if (jsonMatch) {
    try {
      seo = JSON.parse(jsonMatch[0]);
      // The article was in the previous step; SEO step got the full article as input
      // So the current text IS the SEO JSON output
      // We need to reconstruct: use the article from before SEO
    } catch {
      // Not valid JSON — treat whole text as article
    }
  }

  // Build article HTML from the non-JSON part
  const articlePart = text.replace(/```json[\s\S]*?```/g, "").replace(/\{[\s\S]*"titles"[\s\S]*\}/, "").trim();

  // Convert markdown-ish article to HTML
  const bodyHtml = articlePart
    ? articlePart
        .split("\n\n")
        .map((block) => {
          const trimmed = block.trim();
          if (!trimmed) return "";
          if (trimmed.startsWith("# ")) return `<h1>${trimmed.slice(2)}</h1>`;
          if (trimmed.startsWith("## ")) return `<h2>${trimmed.slice(3)}</h2>`;
          if (trimmed.startsWith("### ")) return `<h3>${trimmed.slice(4)}</h3>`;
          if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
            const items = trimmed.split("\n").map((l) => `<li>${l.replace(/^[-*]\s*/, "")}</li>`);
            return `<ul>${items.join("")}</ul>`;
          }
          return `<p>${trimmed}</p>`;
        })
        .filter(Boolean)
        .join("\n")
    : `<p>${articleText}</p>`;

  // Extract title from article (first h1 or first line)
  const titleMatch = articlePart.match(/^#\s+(.+)/m);
  const mainTitle = titleMatch?.[1] || seo.titles?.[0]?.text || "Untitled";

  // Extract lead/subtitle (first paragraph after title)
  const leadMatch = articlePart.match(/^#\s+.+\n\n(.+)/m);
  const lead = leadMatch?.[1] || seo.metaDescription || "";

  const drupalPayload = {
    title: mainTitle,
    subtitle: lead,
    body: bodyHtml,
    seo: {
      titleVariants: seo.titles || [],
      metaDescription: seo.metaDescription || "",
      keywords: seo.keywords || [],
      tags: seo.tags || [],
      slug: seo.slug || "",
    },
    format: "drupal_article",
    generatedAt: new Date().toISOString(),
  };

  return JSON.stringify(drupalPayload, null, 2);
}
