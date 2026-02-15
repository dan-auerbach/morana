/**
 * Extract text from uploaded documents.
 * Supports: PDF, TXT, Markdown, HTML
 */
export async function extractText(
  buffer: Buffer,
  mimeType: string
): Promise<string> {
  // Plain text / markdown
  if (
    mimeType === "text/plain" ||
    mimeType === "text/markdown" ||
    mimeType === "text/html" ||
    mimeType === "text/csv" ||
    mimeType.startsWith("text/")
  ) {
    let text = buffer.toString("utf-8");

    // Strip HTML tags if HTML
    if (mimeType === "text/html") {
      text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
      text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");
      text = text.replace(/<[^>]+>/g, " ");
      text = text.replace(/\s+/g, " ").trim();
    }

    return text;
  }

  // PDF
  if (mimeType === "application/pdf") {
    // Dynamic import to avoid bundling issues
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pdfParse = require("pdf-parse") as (buf: Buffer) => Promise<{ text: string }>;
    const data = await pdfParse(buffer);
    return data.text;
  }

  throw new Error(`Unsupported file type: ${mimeType}`);
}
