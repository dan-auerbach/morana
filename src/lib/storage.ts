import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const s3 = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT!,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

const BUCKET = process.env.R2_BUCKET || "morana";

export async function uploadToR2(
  key: string,
  body: Buffer | ReadableStream<Uint8Array> | Uint8Array,
  contentType: string,
  size?: number
): Promise<void> {
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: body instanceof Buffer || body instanceof Uint8Array ? body : undefined,
      ContentType: contentType,
      ContentLength: size,
    })
  );
}

export async function uploadStreamToR2(
  key: string,
  stream: ReadableStream<Uint8Array>,
  contentType: string
): Promise<number> {
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  let totalSize = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    totalSize += value.length;
  }

  const merged = new Uint8Array(totalSize);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }

  await uploadToR2(key, merged, contentType, totalSize);
  return totalSize;
}

export async function getSignedUploadUrl(
  key: string,
  contentType: string,
  expiresIn = 600
): Promise<string> {
  return getSignedUrl(
    s3,
    new PutObjectCommand({ Bucket: BUCKET, Key: key, ContentType: contentType }),
    { expiresIn }
  );
}

export async function getSignedDownloadUrl(key: string, expiresIn = 3600): Promise<string> {
  return getSignedUrl(
    s3,
    new GetObjectCommand({ Bucket: BUCKET, Key: key }),
    { expiresIn }
  );
}

export async function getObjectFromR2(key: string) {
  const resp = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  return resp;
}

/**
 * Download an object from R2 and return it as a base64-encoded string.
 * Used for passing images to multimodal LLM APIs.
 */
export async function getObjectAsBase64(key: string): Promise<{ base64: string; contentType: string }> {
  const resp = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  if (!resp.Body) throw new Error(`Object not found in storage: ${key}`);
  const bytes = await resp.Body.transformToByteArray();
  const base64 = Buffer.from(bytes).toString("base64");
  return { base64, contentType: resp.ContentType || "application/octet-stream" };
}
