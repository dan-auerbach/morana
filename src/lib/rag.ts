import { prisma } from "./prisma";
import { generateEmbedding } from "./providers/embeddings";

/**
 * Split text into overlapping chunks.
 */
export function chunkText(
  text: string,
  chunkSize = 500,
  overlap = 50
): string[] {
  const words = text.split(/\s+/);
  if (words.length <= chunkSize) return [text];

  const chunks: string[] = [];
  let start = 0;

  while (start < words.length) {
    const end = Math.min(start + chunkSize, words.length);
    chunks.push(words.slice(start, end).join(" "));
    if (end === words.length) break;
    start += chunkSize - overlap;
  }

  return chunks;
}

/**
 * Search for similar document chunks using pgvector cosine similarity.
 */
export async function searchSimilar(
  query: string,
  knowledgeBaseIds: string[],
  topK = 5
): Promise<{ content: string; score: number; documentId: string }[]> {
  if (knowledgeBaseIds.length === 0) return [];

  const queryEmbedding = await generateEmbedding(query);
  const embeddingStr = `[${queryEmbedding.join(",")}]`;

  // Use raw SQL for pgvector similarity search
  const results = await prisma.$queryRawUnsafe<
    { content: string; score: number; document_id: string }[]
  >(
    `SELECT dc."content", dc."documentId" as document_id,
            1 - (dc."embedding" <=> $1::vector) as score
     FROM "DocumentChunk" dc
     JOIN "Document" d ON d."id" = dc."documentId"
     WHERE d."knowledgeBaseId" = ANY($2::text[])
       AND d."status" = 'ready'
       AND dc."embedding" IS NOT NULL
     ORDER BY dc."embedding" <=> $1::vector
     LIMIT $3`,
    embeddingStr,
    knowledgeBaseIds,
    topK
  );

  return results.map((r) => ({
    content: r.content,
    score: Number(r.score),
    documentId: r.document_id,
  }));
}

/**
 * Build RAG context string from retrieved chunks.
 */
export async function buildRAGContext(
  query: string,
  knowledgeBaseIds: string[],
  topK = 5
): Promise<string> {
  const results = await searchSimilar(query, knowledgeBaseIds, topK);
  if (results.length === 0) return "";

  const contextParts = results.map(
    (r, i) => `[Source ${i + 1} (relevance: ${(r.score * 100).toFixed(0)}%)]\n${r.content}`
  );

  return "---\nRelevant context from knowledge base:\n\n" + contextParts.join("\n\n") + "\n---";
}
