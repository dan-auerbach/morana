import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenerativeAI, Content } from "@google/generative-ai";
import OpenAI from "openai";
import { ModelEntry } from "../config";

function getApiKey(name: string): string {
  const val = process.env[name] || "";
  if (!val) {
    throw new Error(`${name} is not configured`);
  }
  return val;
}

function getAnthropic() {
  return new Anthropic({ apiKey: getApiKey("ANTHROPIC_API_KEY") });
}

function getGenAI() {
  return new GoogleGenerativeAI(getApiKey("GEMINI_API_KEY"));
}

function getOpenAI() {
  return new OpenAI({ apiKey: getApiKey("OPENAI_API_KEY") });
}

export type ImageAttachment = {
  /** Base64-encoded image data (no data URI prefix) */
  base64: string;
  /** MIME type: "image/jpeg" | "image/png" | "image/webp" | "image/gif" */
  mimeType: string;
};

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  /** Optional image attachments for multimodal (vision) messages */
  images?: ImageAttachment[];
};

export type LLMResult = {
  text: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  responseId?: string; // Provider response ID for audit trail
};

export type WebSearchCitation = {
  url: string;
  title: string;
};

export type WebSearchResult = {
  text: string;
  citations: WebSearchCitation[];
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  responseId?: string;
};

/**
 * Single-shot LLM call (backward compatible).
 */
export async function runLLM(
  modelEntry: ModelEntry,
  prompt: string,
  sourceText?: string
): Promise<LLMResult> {
  const fullPrompt = sourceText ? `${prompt}\n\n---\nSource text:\n${sourceText}` : prompt;
  return runLLMChat(modelEntry, [{ role: "user", content: fullPrompt }]);
}

/**
 * Multi-turn chat LLM call with optional system prompt.
 */
export async function runLLMChat(
  modelEntry: ModelEntry,
  messages: ChatMessage[],
  systemPrompt?: string
): Promise<LLMResult> {
  const start = Date.now();

  if (modelEntry.provider === "anthropic") {
    const anthropic = getAnthropic();
    const resp = await anthropic.messages.create({
      model: modelEntry.id,
      max_tokens: 8192,
      ...(systemPrompt && { system: systemPrompt }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      messages: messages.map((m): any => {
        if (m.images && m.images.length > 0) {
          // Multimodal: images first, then text
          const parts: Array<{ type: "image"; source: { type: "base64"; media_type: string; data: string } } | { type: "text"; text: string }> = [];
          for (const img of m.images) {
            parts.push({ type: "image", source: { type: "base64", media_type: img.mimeType, data: img.base64 } });
          }
          parts.push({ type: "text", text: m.content });
          return { role: m.role, content: parts };
        }
        return { role: m.role, content: m.content };
      }),
    });
    const text = resp.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");
    return {
      text,
      inputTokens: resp.usage.input_tokens,
      outputTokens: resp.usage.output_tokens,
      latencyMs: Date.now() - start,
      responseId: resp.id,
    };
  }

  if (modelEntry.provider === "openai") {
    const openai = getOpenAI();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const openaiMessages: Array<{ role: "system" | "user" | "assistant"; content: any }> = [];
    if (systemPrompt) {
      openaiMessages.push({ role: "system", content: systemPrompt });
    }
    openaiMessages.push(...messages.map((m) => {
      if (m.images && m.images.length > 0) {
        // Multimodal: images as data URIs + text
        const parts: Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string; detail: string } }> = [];
        for (const img of m.images) {
          parts.push({ type: "image_url", image_url: { url: `data:${img.mimeType};base64,${img.base64}`, detail: "auto" } });
        }
        parts.push({ type: "text", text: m.content });
        return { role: m.role as "user" | "assistant", content: parts };
      }
      return { role: m.role as "user" | "assistant", content: m.content };
    }));
    // GPT-5 series requires max_completion_tokens (max_tokens is deprecated)
    // GPT-5 mini supports max 4096 completion tokens
    const isGpt5Mini = modelEntry.id.includes("gpt-5-mini");
    const maxTokens = isGpt5Mini ? 4096 : 8192;
    const resp = await openai.chat.completions.create({
      model: modelEntry.id,
      max_completion_tokens: maxTokens,
      messages: openaiMessages,
    });
    const choice = resp.choices[0];
    const text = choice?.message?.content || "";
    return {
      text,
      inputTokens: resp.usage?.prompt_tokens || 0,
      outputTokens: resp.usage?.completion_tokens || 0,
      latencyMs: Date.now() - start,
      responseId: resp.id,
    };
  }

  // Gemini
  const genAI = getGenAI();
  const model = genAI.getGenerativeModel({
    model: modelEntry.id,
    ...(systemPrompt && { systemInstruction: systemPrompt }),
  });

  // Helper: build Gemini parts for a message (text + optional images)
  function geminiParts(m: ChatMessage) {
    if (m.images && m.images.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const parts: any[] = [];
      for (const img of m.images) {
        parts.push({ inlineData: { mimeType: img.mimeType, data: img.base64 } });
      }
      parts.push({ text: m.content });
      return parts;
    }
    return [{ text: m.content }];
  }

  // Gemini uses "history" for multi-turn: all messages except the last
  if (messages.length === 1) {
    const resp = await model.generateContent({ contents: [{ role: "user", parts: geminiParts(messages[0]) }] });
    const result = resp.response;
    const text = result.text();
    const usage = result.usageMetadata;
    return {
      text,
      inputTokens: usage?.promptTokenCount || 0,
      outputTokens: usage?.candidatesTokenCount || 0,
      latencyMs: Date.now() - start,
    };
  }

  // Multi-turn: use startChat with history
  const history: Content[] = messages.slice(0, -1).map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: geminiParts(m),
  }));

  const chat = model.startChat({ history });
  const lastMsg = messages[messages.length - 1];
  const resp = await chat.sendMessage(geminiParts(lastMsg));
  const result = resp.response;
  const text = result.text();
  const usage = result.usageMetadata;
  return {
    text,
    inputTokens: usage?.promptTokenCount || 0,
    outputTokens: usage?.candidatesTokenCount || 0,
    latencyMs: Date.now() - start,
  };
}

/**
 * Web search-enabled LLM call using OpenAI Responses API.
 * Always uses GPT-4o with web_search_preview tool.
 * Falls back to standard runLLMChat() on error.
 */
export async function runLLMWebSearch(
  messages: ChatMessage[],
  systemPrompt?: string
): Promise<WebSearchResult> {
  const start = Date.now();

  try {
    const openai = getOpenAI();

    // Build input array for Responses API
    // System prompt goes as first message in the input array
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const input: Array<{ role: "system" | "user" | "assistant"; content: any }> = [];
    if (systemPrompt) {
      input.push({ role: "system", content: systemPrompt });
    }
    input.push(
      ...messages.map((m) => {
        if (m.images && m.images.length > 0) {
          // Responses API multimodal: input_image + input_text
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const parts: any[] = [];
          for (const img of m.images) {
            parts.push({ type: "input_image", image_url: `data:${img.mimeType};base64,${img.base64}` });
          }
          parts.push({ type: "input_text", text: m.content });
          return { role: m.role as "user" | "assistant", content: parts };
        }
        return { role: m.role as "user" | "assistant", content: m.content };
      })
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resp = await (openai.responses as any).create({
      model: "gpt-5.2",
      input,
      tools: [{ type: "web_search_preview", search_context_size: "low" }],
      max_output_tokens: 8192,
    });

    // Extract text from output items
    let text = "";
    const citations: WebSearchCitation[] = [];
    const seenUrls = new Set<string>();

    if (resp.output) {
      for (const item of resp.output) {
        if (item.type === "message" && item.content) {
          for (const block of item.content) {
            if (block.type === "output_text") {
              text += block.text || "";
              // Extract citations from annotations
              if (block.annotations) {
                for (const ann of block.annotations) {
                  if (ann.type === "url_citation" && ann.url && !seenUrls.has(ann.url)) {
                    seenUrls.add(ann.url);
                    citations.push({
                      url: ann.url,
                      title: ann.title || ann.url,
                    });
                  }
                }
              }
            }
          }
        }
      }
    }

    // Fallback: if output_text is empty, try resp.output_text
    if (!text && resp.output_text) {
      text = resp.output_text;
    }

    const inputTokens = resp.usage?.input_tokens || 0;
    const outputTokens = resp.usage?.output_tokens || 0;

    return {
      text,
      citations,
      inputTokens,
      outputTokens,
      latencyMs: Date.now() - start,
      responseId: resp.id,
    };
  } catch (err) {
    // Fallback: use standard Chat Completions API without web search
    console.warn(
      "[WebSearch] Responses API failed, falling back to standard chat:",
      err instanceof Error ? err.message : err
    );

    const fallbackModel: ModelEntry = {
      id: "gpt-5.2",
      label: "GPT-5.2",
      provider: "openai",
    };

    const result = await runLLMChat(fallbackModel, messages, systemPrompt);
    return {
      text: result.text,
      citations: [], // No citations in fallback mode
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      latencyMs: result.latencyMs,
      responseId: result.responseId,
    };
  }
}
