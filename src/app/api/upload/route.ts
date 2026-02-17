import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/session";
import { getSignedUploadUrl } from "@/lib/storage";
import { v4 as uuid } from "uuid";

const ALLOWED_AUDIO_TYPES = [
  "audio/mpeg", "audio/mp3", "audio/wav", "audio/wave", "audio/x-wav",
  "audio/ogg", "audio/flac", "audio/x-flac", "audio/mp4", "audio/m4a",
  "audio/x-m4a", "audio/aac", "audio/webm",
];

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB

/**
 * POST /api/upload — get a presigned URL for direct browser-to-R2 upload.
 *
 * Body: { fileName, fileSize, fileType, recipeId }
 * Returns: { uploadUrl, storageKey }
 *
 * The client uploads the file directly to R2 using the presigned URL,
 * then passes the storageKey to the execute endpoint.
 * This bypasses Next.js body size limits entirely.
 */
export async function POST(req: NextRequest) {
  return withAuth(async () => {
    const body = await req.json();
    const { fileName, fileSize, fileType, recipeId } = body;

    if (!fileName || !fileType) {
      return NextResponse.json({ error: "fileName and fileType are required" }, { status: 400 });
    }

    // Validate audio type
    const normalizedType = (fileType || "").toLowerCase();
    const isAudio = ALLOWED_AUDIO_TYPES.includes(normalizedType) || normalizedType.startsWith("audio/");
    if (!isAudio) {
      return NextResponse.json({ error: `Unsupported audio type: ${fileType}` }, { status: 400 });
    }

    // Validate file size
    if (fileSize && fileSize > MAX_FILE_SIZE) {
      return NextResponse.json({ error: "File too large (max 100MB)" }, { status: 400 });
    }

    // Generate storage key
    const storageKey = `recipes/${recipeId || "upload"}/${uuid()}/${fileName}`;

    // Get presigned upload URL (valid for 10 minutes)
    const uploadUrl = await getSignedUploadUrl(storageKey, normalizedType, 600);

    return NextResponse.json({ uploadUrl, storageKey });
  }, req);
}
