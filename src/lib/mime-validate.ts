/**
 * Validate file contents match the claimed MIME type using magic bytes.
 * Prevents content-type spoofing where user uploads a .exe as audio/mpeg etc.
 */

type MagicSignature = {
  offset: number;
  bytes: number[];
  mime: string;
};

const SIGNATURES: MagicSignature[] = [
  // Images
  { offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47], mime: "image/png" },
  { offset: 0, bytes: [0xff, 0xd8, 0xff], mime: "image/jpeg" },
  { offset: 0, bytes: [0x47, 0x49, 0x46, 0x38], mime: "image/gif" },
  { offset: 0, bytes: [0x52, 0x49, 0x46, 0x46], mime: "image/webp" }, // RIFF header (also WAV)
  // Audio
  { offset: 0, bytes: [0xff, 0xfb], mime: "audio/mpeg" },       // MP3 frame sync
  { offset: 0, bytes: [0xff, 0xf3], mime: "audio/mpeg" },       // MP3 frame sync
  { offset: 0, bytes: [0xff, 0xf2], mime: "audio/mpeg" },       // MP3 frame sync
  { offset: 0, bytes: [0x49, 0x44, 0x33], mime: "audio/mpeg" }, // ID3 tag (MP3)
  { offset: 0, bytes: [0x52, 0x49, 0x46, 0x46], mime: "audio/wav" },  // RIFF
  { offset: 0, bytes: [0x4f, 0x67, 0x67, 0x53], mime: "audio/ogg" },  // OggS
  { offset: 0, bytes: [0x66, 0x4c, 0x61, 0x43], mime: "audio/flac" }, // fLaC
  { offset: 4, bytes: [0x66, 0x74, 0x79, 0x70], mime: "audio/mp4" },  // ftyp (M4A/MP4)
  { offset: 0, bytes: [0x1a, 0x45, 0xdf, 0xa3], mime: "audio/webm" }, // EBML (WebM/MKV)
];

/**
 * Map of claimed MIME types to which detected MIME families are acceptable.
 * e.g. "image/jpeg" is OK if magic says "image/jpeg"
 * "audio/mp3" is OK if magic says "audio/mpeg"
 */
const MIME_FAMILY: Record<string, string[]> = {
  // Image types
  "image/png": ["image/png"],
  "image/jpeg": ["image/jpeg"],
  "image/jpg": ["image/jpeg"],
  "image/gif": ["image/gif"],
  "image/webp": ["image/webp"],
  // Audio types — many variants map to same magic bytes
  "audio/mpeg": ["audio/mpeg"],
  "audio/mp3": ["audio/mpeg"],
  "audio/wav": ["audio/wav"],
  "audio/wave": ["audio/wav"],
  "audio/x-wav": ["audio/wav"],
  "audio/ogg": ["audio/ogg"],
  "audio/flac": ["audio/flac"],
  "audio/x-flac": ["audio/flac"],
  "audio/mp4": ["audio/mp4"],
  "audio/m4a": ["audio/mp4"],
  "audio/x-m4a": ["audio/mp4"],
  "audio/aac": ["audio/mpeg", "audio/mp4"], // AAC can be in MPEG or MP4 container
  "audio/webm": ["audio/webm"],
};

/**
 * Detect MIME type from magic bytes in the buffer.
 * Returns the first matching MIME type, or null if unknown.
 */
export function detectMimeFromBytes(buffer: Buffer | Uint8Array): string | null {
  for (const sig of SIGNATURES) {
    if (buffer.length < sig.offset + sig.bytes.length) continue;
    let match = true;
    for (let i = 0; i < sig.bytes.length; i++) {
      if (buffer[sig.offset + i] !== sig.bytes[i]) {
        match = false;
        break;
      }
    }
    if (match) return sig.mime;
  }
  return null;
}

/**
 * Validate that a file's actual content matches its claimed MIME type.
 * Returns { valid: true } or { valid: false, detectedMime, message }.
 */
export function validateMime(
  buffer: Buffer | Uint8Array,
  claimedMime: string
): { valid: boolean; detectedMime: string | null; message?: string } {
  const detected = detectMimeFromBytes(buffer);

  // If we can't detect → allow (some formats like AAC have no reliable magic)
  if (!detected) {
    return { valid: true, detectedMime: null };
  }

  const normalizedClaim = claimedMime.toLowerCase();
  const allowedFamily = MIME_FAMILY[normalizedClaim];

  // If claimed type is unknown to us → allow
  if (!allowedFamily) {
    return { valid: true, detectedMime: detected };
  }

  // Check if detected matches any allowed family
  if (allowedFamily.includes(detected)) {
    return { valid: true, detectedMime: detected };
  }

  // Special case: RIFF header is shared between WAV and WebP
  if (detected === "image/webp" && allowedFamily.includes("audio/wav")) {
    // Need to check further: WebP has "WEBP" at offset 8, WAV has "WAVE"
    if (buffer.length >= 12) {
      const fourcc = String.fromCharCode(buffer[8], buffer[9], buffer[10], buffer[11]);
      if (fourcc === "WAVE") return { valid: true, detectedMime: "audio/wav" };
    }
  }
  if (detected === "audio/wav" && allowedFamily.includes("image/webp")) {
    if (buffer.length >= 12) {
      const fourcc = String.fromCharCode(buffer[8], buffer[9], buffer[10], buffer[11]);
      if (fourcc === "WEBP") return { valid: true, detectedMime: "image/webp" };
    }
  }

  return {
    valid: false,
    detectedMime: detected,
    message: `Content-type mismatch: claimed ${claimedMime} but file signature is ${detected}`,
  };
}
