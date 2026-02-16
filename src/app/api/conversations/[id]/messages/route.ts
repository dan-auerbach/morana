import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/session";
import { checkRateLimit, isModelAllowed } from "@/lib/rate-limit";
import { prisma } from "@/lib/prisma";
import { getApprovedModels, config } from "@/lib/config";
import { runLLMChat, runLLMWebSearch, ChatMessage, WebSearchCitation } from "@/lib/providers/llm";
import { logUsage } from "@/lib/usage";
import { buildRAGContext } from "@/lib/rag";
import { fetchURLsFromMessage } from "@/lib/url-fetcher";

// Vercel serverless: LLM chat can take 30-60s for complex prompts
export const maxDuration = 60;

// POST /api/conversations/:id/messages — send a user message, get AI response
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuth(async (user) => {
    const { id: conversationId } = await params;
    const { content, webSearch } = await req.json();

    if (!content || typeof content !== "string") {
      return NextResponse.json({ error: "content is required" }, { status: 400 });
    }

    // Verify conversation exists and belongs to user
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        messages: {
          orderBy: { createdAt: "asc" },
          select: { role: true, content: true },
        },
      },
    });

    if (!conversation) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }
    if (conversation.userId !== user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Check rate limit
    const rl = await checkRateLimit(user.id);
    if (!rl.allowed) {
      return NextResponse.json({ error: rl.reason || "Rate limit reached" }, { status: 429 });
    }

    // Validate model
    const models = getApprovedModels();
    const modelEntry = models.find((m) => m.id === conversation.modelId);
    if (!modelEntry) {
      return NextResponse.json({ error: "Model not approved" }, { status: 400 });
    }

    // Check per-user model restriction
    if (!(await isModelAllowed(user.id, conversation.modelId))) {
      return NextResponse.json({ error: "You do not have access to this model" }, { status: 403 });
    }

    // Build system prompt from template + RAG knowledge base
    let systemPrompt: string | undefined;

    // Template system prompt
    if (conversation.templateId) {
      const template = await prisma.promptTemplate.findUnique({
        where: { id: conversation.templateId },
        select: { systemPrompt: true, knowledgeText: true },
      });
      if (template) {
        const parts: string[] = [template.systemPrompt];
        if (template.knowledgeText) {
          parts.push("\n\n---\nReference material:\n" + template.knowledgeText);
        }
        systemPrompt = parts.join("");
      }
    }

    // RAG knowledge base retrieval
    const kbIds = conversation.knowledgeBaseIds as string[] | null;
    if (kbIds && kbIds.length > 0) {
      try {
        const ragContext = await buildRAGContext(content, kbIds, 5);
        if (ragContext) {
          systemPrompt = (systemPrompt || "") + "\n\n" + ragContext;
        }
      } catch (err) {
        // RAG retrieval failed — continue without it
        console.error("[RAG] Retrieval error:", err instanceof Error ? err.message : err);
      }
    }

    // URL content fetching — detect URLs in user message and fetch their content
    try {
      const urlContext = await fetchURLsFromMessage(content);
      if (urlContext) {
        systemPrompt = (systemPrompt || "") + "\n\n" + urlContext;
      }
    } catch (err) {
      console.error("[URL Fetch] Error:", err instanceof Error ? err.message : err);
    }

    // Build message history
    const history: ChatMessage[] = conversation.messages.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));
    history.push({ role: "user", content });

    // Check total prompt size (rough estimate)
    const totalChars = history.reduce((sum, m) => sum + m.content.length, 0);
    if (totalChars > config.maxLlmPromptChars) {
      return NextResponse.json(
        { error: `Conversation exceeds ${config.maxLlmPromptChars} character limit. Start a new conversation.` },
        { status: 400 }
      );
    }

    // Save user message
    const userMessage = await prisma.message.create({
      data: {
        conversationId,
        role: "user",
        content,
      },
    });

    // Create run record
    const run = await prisma.run.create({
      data: {
        userId: user.id,
        workspaceId: conversation.workspaceId || undefined,
        type: "llm",
        status: "running",
        provider: modelEntry.provider,
        model: modelEntry.id,
      },
    });

    try {
      // Determine if web search should be used
      const useWebSearch =
        (webSearch === true || conversation.webSearchEnabled) &&
        modelEntry.provider === "openai";

      let resultText: string;
      let resultInputTokens: number;
      let resultOutputTokens: number;
      let resultLatencyMs: number;
      let resultResponseId: string | undefined;
      let citations: WebSearchCitation[] = [];
      let actualProvider = modelEntry.provider;
      let actualModel = modelEntry.id;

      if (useWebSearch) {
        // Web search mode — uses OpenAI Responses API with GPT-4o
        const wsResult = await runLLMWebSearch(history, systemPrompt);
        resultText = wsResult.text;
        resultInputTokens = wsResult.inputTokens;
        resultOutputTokens = wsResult.outputTokens;
        resultLatencyMs = wsResult.latencyMs;
        resultResponseId = wsResult.responseId;
        citations = wsResult.citations;
        actualProvider = "openai";
        actualModel = "gpt-4o";
      } else {
        // Standard chat mode
        const chatResult = await runLLMChat(modelEntry, history, systemPrompt);
        resultText = chatResult.text;
        resultInputTokens = chatResult.inputTokens;
        resultOutputTokens = chatResult.outputTokens;
        resultLatencyMs = chatResult.latencyMs;
        resultResponseId = chatResult.responseId;
      }

      // Save assistant message (with citations if web search was used)
      const assistantMessage = await prisma.message.create({
        data: {
          conversationId,
          role: "assistant",
          content: resultText,
          inputTokens: resultInputTokens,
          outputTokens: resultOutputTokens,
          latencyMs: resultLatencyMs,
          runId: run.id,
          ...(citations.length > 0 && { citationsJson: citations }),
        },
      });

      // Update conversation timestamp
      await prisma.conversation.update({
        where: { id: conversationId },
        data: { updatedAt: new Date() },
      });

      // Auto-generate title from first user message
      if (conversation.messages.length === 0) {
        const autoTitle = content.length > 50 ? content.substring(0, 50) + "..." : content;
        await prisma.conversation.update({
          where: { id: conversationId },
          data: { title: autoTitle },
        });
      }

      // Mark run as done
      await prisma.run.update({
        where: { id: run.id },
        data: { status: "done", finishedAt: new Date() },
      });

      await prisma.runInput.create({
        data: {
          runId: run.id,
          payloadJson: { conversationId, messageCount: history.length, webSearch: useWebSearch },
        },
      });

      await prisma.runOutput.create({
        data: {
          runId: run.id,
          payloadJson: {
            text: resultText,
            inputTokens: resultInputTokens,
            outputTokens: resultOutputTokens,
            latencyMs: resultLatencyMs,
            ...(resultResponseId && { responseId: resultResponseId }),
            ...(citations.length > 0 && { citations }),
          },
        },
      });

      await logUsage({
        runId: run.id,
        userId: user.id,
        workspaceId: conversation.workspaceId,
        provider: actualProvider,
        model: actualModel,
        units: { inputTokens: resultInputTokens, outputTokens: resultOutputTokens },
        latencyMs: resultLatencyMs,
      });

      return NextResponse.json({
        userMessage: {
          id: userMessage.id,
          role: "user",
          content: userMessage.content,
          createdAt: userMessage.createdAt,
        },
        assistantMessage: {
          id: assistantMessage.id,
          role: "assistant",
          content: resultText,
          inputTokens: resultInputTokens,
          outputTokens: resultOutputTokens,
          latencyMs: resultLatencyMs,
          createdAt: assistantMessage.createdAt,
          ...(citations.length > 0 && { citations }),
        },
      });
    } catch (err: unknown) {
      const internalMsg = err instanceof Error ? err.message : "Unknown error";
      console.error("[Chat] Processing error:", internalMsg);
      await prisma.run.update({
        where: { id: run.id },
        data: { status: "error", errorMessage: internalMsg, finishedAt: new Date() },
      });
      return NextResponse.json({ error: "Chat request failed. Please try again." }, { status: 500 });
    }
  }, req);
}
