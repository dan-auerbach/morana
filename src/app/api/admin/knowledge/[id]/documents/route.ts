import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { extractText } from "@/lib/document-processor";
import { chunkText } from "@/lib/rag";
import { generateEmbeddings } from "@/lib/providers/embeddings";

// Vercel serverless: document processing can take time
export const maxDuration = 120;

function requireAdmin(role: string) {
  if (role !== "admin") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }
  return null;
}

function getS3() {
  return new S3Client({
    region: "auto",
    endpoint: process.env.R2_ENDPOINT!,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  });
}

// POST /api/admin/knowledge/:id/documents — upload a document
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuth(async (user) => {
    const denied = requireAdmin(user.role);
    if (denied) return denied;

    const { id: kbId } = await params;

    // Verify KB exists
    const kb = await prisma.knowledgeBase.findUnique({ where: { id: kbId } });
    if (!kb) {
      return NextResponse.json({ error: "Knowledge base not found" }, { status: 404 });
    }

    // Parse multipart form data
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    // Validate file type
    const allowedTypes = [
      "application/pdf",
      "text/plain",
      "text/markdown",
      "text/html",
      "text/csv",
    ];
    if (!allowedTypes.includes(file.type) && !file.name.endsWith(".md") && !file.name.endsWith(".txt")) {
      return NextResponse.json({ error: "Unsupported file type. Use PDF, TXT, MD, HTML, or CSV." }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const mimeType = file.type || "text/plain";
    const storageKey = `knowledge/${kbId}/${Date.now()}-${file.name}`;

    // Upload to R2
    if (process.env.R2_ENDPOINT) {
      const s3 = getS3();
      await s3.send(new PutObjectCommand({
        Bucket: process.env.R2_BUCKET || "morana",
        Key: storageKey,
        Body: buffer,
        ContentType: mimeType,
      }));
    }

    // Create document record
    const doc = await prisma.document.create({
      data: {
        knowledgeBaseId: kbId,
        fileName: file.name,
        mimeType,
        sizeBytes: buffer.length,
        storageKey,
        status: "processing",
      },
    });

    // Process document inline (extract text → chunk → embed → store)
    // For large files, this should be moved to an Inngest background job
    try {
      const text = await extractText(buffer, mimeType);
      if (!text.trim()) {
        await prisma.document.update({
          where: { id: doc.id },
          data: { status: "error", errorMessage: "No text extracted from document" },
        });
        return NextResponse.json({ document: { ...doc, status: "error" } }, { status: 201 });
      }

      const chunks = chunkText(text, 500, 50);

      // Generate embeddings
      const embeddings = await generateEmbeddings(chunks);

      // Store chunks with embeddings using raw SQL for vector type
      for (let i = 0; i < chunks.length; i++) {
        const chunkId = `chunk_${doc.id}_${i}`;
        const embeddingStr = `[${embeddings[i].join(",")}]`;

        await prisma.$executeRawUnsafe(
          `INSERT INTO "DocumentChunk" ("id", "documentId", "content", "chunkIndex", "embedding")
           VALUES ($1, $2, $3, $4, $5::vector)`,
          chunkId,
          doc.id,
          chunks[i],
          i,
          embeddingStr
        );
      }

      // Update document status
      await prisma.document.update({
        where: { id: doc.id },
        data: { status: "ready", chunkCount: chunks.length },
      });

      return NextResponse.json({
        document: { ...doc, status: "ready", chunkCount: chunks.length },
      }, { status: 201 });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Processing failed";
      console.error("[Document Processing]", msg);
      await prisma.document.update({
        where: { id: doc.id },
        data: { status: "error", errorMessage: msg },
      });
      return NextResponse.json({
        document: { ...doc, status: "error", errorMessage: msg },
      }, { status: 201 });
    }
  }, req);
}

// GET /api/admin/knowledge/:id/documents — list documents
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuth(async (user) => {
    const denied = requireAdmin(user.role);
    if (denied) return denied;

    const { id: kbId } = await params;
    const documents = await prisma.document.findMany({
      where: { knowledgeBaseId: kbId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true, fileName: true, mimeType: true, sizeBytes: true,
        status: true, chunkCount: true, errorMessage: true, createdAt: true,
      },
    });

    return NextResponse.json({ documents });
  });
}
