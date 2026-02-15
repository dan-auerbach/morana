-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Add embedding column to DocumentChunk
ALTER TABLE "DocumentChunk" ADD COLUMN "embedding" vector(1536);

-- Create IVFFlat index for cosine similarity search
CREATE INDEX "DocumentChunk_embedding_idx" ON "DocumentChunk" USING ivfflat ("embedding" vector_cosine_ops) WITH (lists = 100);
