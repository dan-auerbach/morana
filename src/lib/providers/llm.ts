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

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export type LLMResult = {
  text: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
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
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
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
    };
  }

  if (modelEntry.provider === "openai") {
    const openai = getOpenAI();
    const openaiMessages: { role: "system" | "user" | "assistant"; content: string }[] = [];
    if (systemPrompt) {
      openaiMessages.push({ role: "system", content: systemPrompt });
    }
    openaiMessages.push(...messages.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })));
    const resp = await openai.chat.completions.create({
      model: modelEntry.id,
      max_tokens: 8192,
      messages: openaiMessages,
    });
    const choice = resp.choices[0];
    const text = choice?.message?.content || "";
    return {
      text,
      inputTokens: resp.usage?.prompt_tokens || 0,
      outputTokens: resp.usage?.completion_tokens || 0,
      latencyMs: Date.now() - start,
    };
  }

  // Gemini
  const genAI = getGenAI();
  const model = genAI.getGenerativeModel({
    model: modelEntry.id,
    ...(systemPrompt && { systemInstruction: systemPrompt }),
  });

  // Gemini uses "history" for multi-turn: all messages except the last
  if (messages.length === 1) {
    const resp = await model.generateContent(messages[0].content);
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
    parts: [{ text: m.content }],
  }));

  const chat = model.startChat({ history });
  const lastMessage = messages[messages.length - 1].content;
  const resp = await chat.sendMessage(lastMessage);
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
