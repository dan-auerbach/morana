import { GoogleGenerativeAI } from "@google/generative-ai";

function getApiKey(name: string): string {
  const val = process.env[name] || "";
  if (!val) {
    throw new Error(`${name} is not configured`);
  }
  return val;
}

function getGenAI() {
  return new GoogleGenerativeAI(getApiKey("GEMINI_API_KEY"));
}

export type ImageResult = {
  /** Generated/edited image as base64 */
  imageBase64: string | null;
  /** MIME type of the generated image */
  mimeType: string;
  /** Text response from the model (if any) */
  text: string;
  /** Latency in milliseconds */
  latencyMs: number;
};

/**
 * Generate or edit an image using Gemini 2.5 Flash Image.
 *
 * @param prompt - Text instructions for generation/editing
 * @param inputImageBase64 - Optional base64-encoded input image for editing
 * @param inputImageMime - MIME type of the input image
 * @param aspectRatio - Aspect ratio for generated images
 */
export async function runImageGeneration(
  prompt: string,
  inputImageBase64?: string,
  inputImageMime?: string,
  aspectRatio?: string
): Promise<ImageResult> {
  const start = Date.now();

  const genAI = getGenAI();
  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash-image",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    generationConfig: {
      responseModalities: ["Text", "Image"],
    } as any,
  });

  // Build contents: text prompt + optional input image
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parts: any[] = [];

  if (inputImageBase64 && inputImageMime) {
    parts.push({
      inlineData: {
        data: inputImageBase64,
        mimeType: inputImageMime,
      },
    });
  }

  parts.push({ text: prompt });

  const response = await model.generateContent({
    contents: [{ role: "user", parts }],
  });

  const result = response.response;
  const candidates = result.candidates;

  let imageBase64: string | null = null;
  let mimeType = "image/png";
  let text = "";

  if (candidates && candidates[0]?.content?.parts) {
    for (const part of candidates[0].content.parts) {
      if (part.text) {
        text += part.text;
      }
      if (part.inlineData) {
        imageBase64 = part.inlineData.data;
        mimeType = part.inlineData.mimeType || "image/png";
      }
    }
  }

  return {
    imageBase64,
    mimeType,
    text,
    latencyMs: Date.now() - start,
  };
}
