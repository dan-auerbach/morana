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
    }
  }

  return sections.join("\n\n---\n\n");
}
