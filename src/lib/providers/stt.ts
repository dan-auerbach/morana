const SONIOX_BASE = "https://api.soniox.com/v1";

function getApiKey(): string {
  const val = process.env.SONIOX_API_KEY || "";
  if (!val) throw new Error("SONIOX_API_KEY is not configured");
  return val;
}

function authHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
  };
}

export type STTOptions = {
  language: string;           // ISO code or "auto"
  diarize?: boolean;
  translateTo?: string;       // target lang ISO, e.g. "en"
};

export type STTToken = {
  text: string;
  start_ms: number;
  end_ms: number;
  speaker?: string;
};

export type STTResult = {
  text: string;
  durationSeconds: number;
  latencyMs: number;
  tokens?: STTToken[];
  translatedText?: string;
};

/**
 * Upload audio file to Soniox, create a transcription, poll until done,
 * then fetch the transcript text.
 *
 * On timeout: cancels the Soniox transcription job AND deletes the uploaded file.
 */
export async function runSTT(
  audioBuffer: Buffer | Uint8Array,
  mimeType: string,
  options: STTOptions
): Promise<STTResult> {
  const start = Date.now();
  const apiKey = getApiKey();

  // --- Step 1: Upload audio file ---
  const uploadForm = new FormData();
  const blob = new Blob([new Uint8Array(audioBuffer)], { type: mimeType });
  const ext = mimeExtension(mimeType);
  uploadForm.append("file", blob, `audio${ext}`);

  const uploadResp = await fetch(`${SONIOX_BASE}/files`, {
    method: "POST",
    headers: authHeaders(apiKey),
    body: uploadForm,
  });

  if (!uploadResp.ok) {
    const errText = await uploadResp.text();
    throw new Error(`Soniox file upload error ${uploadResp.status}: ${errText}`);
  }

  const uploadData = await uploadResp.json();
  const fileId: string = uploadData.id;
  if (!fileId) {
    throw new Error(`Soniox file upload returned no id: ${JSON.stringify(uploadData)}`);
  }

  // --- Step 2: Create transcription ---
  const createBody: Record<string, unknown> = {
    file_id: fileId,
    model: "stt-async-v4",
  };

  if (options.language === "auto") {
    createBody.enable_language_identification = true;
  } else {
    createBody.language_hints = [options.language];
    createBody.language_hints_strict = true;
  }

  if (options.diarize) {
    createBody.enable_speaker_diarization = true;
  }

  if (options.translateTo) {
    createBody.translation = { type: "one_way", target_language: options.translateTo };
  }

  const createResp = await fetch(`${SONIOX_BASE}/transcriptions`, {
    method: "POST",
    headers: {
      ...authHeaders(apiKey),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(createBody),
  });

  if (!createResp.ok) {
    cleanupFile(apiKey, fileId);
    const errText = await createResp.text();
    throw new Error(`Soniox create transcription error ${createResp.status}: ${errText}`);
  }

  const createData = await createResp.json();
  const transcriptionId: string = createData.id;
  if (!transcriptionId) {
    cleanupFile(apiKey, fileId);
    throw new Error(`Soniox create transcription returned no id: ${JSON.stringify(createData)}`);
  }

  // --- Step 3: Poll until transcription is complete ---
  const maxWaitMs = 180_000; // 3 minutes max
  const pollIntervalMs = 1500;
  const deadline = Date.now() + maxWaitMs;

  let status = createData.status || "processing";
  let transcriptionMeta = createData;

  while (status === "processing" || status === "queued") {
    if (Date.now() > deadline) {
      // TIMEOUT KILL: cancel transcription + cleanup file
      await killTranscription(apiKey, transcriptionId, fileId);
      throw new Error("Soniox transcription timed out after 180 seconds (job cancelled)");
    }

    await sleep(pollIntervalMs);

    const pollResp = await fetch(`${SONIOX_BASE}/transcriptions/${transcriptionId}`, {
      headers: authHeaders(apiKey),
    });

    if (!pollResp.ok) {
      const errText = await pollResp.text();
      throw new Error(`Soniox poll error ${pollResp.status}: ${errText}`);
    }

    transcriptionMeta = await pollResp.json();
    status = transcriptionMeta.status;
  }

  if (status === "error" || status === "failed") {
    cleanupFile(apiKey, fileId);
    throw new Error(
      `Soniox transcription failed: ${transcriptionMeta.error_message || transcriptionMeta.error || "unknown error"}`
    );
  }

  // --- Step 4: Get transcript text ---
  const transcriptResp = await fetch(
    `${SONIOX_BASE}/transcriptions/${transcriptionId}/transcript`,
    { headers: authHeaders(apiKey) }
  );

  if (!transcriptResp.ok) {
    const errText = await transcriptResp.text();
    throw new Error(`Soniox get transcript error ${transcriptResp.status}: ${errText}`);
  }

  const transcriptData = await transcriptResp.json();
  const durationSeconds: number =
    transcriptionMeta.duration ||
    transcriptionMeta.audio_duration ||
    transcriptData.duration ||
    0;

  // Parse tokens from the response
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawTokens: any[] = transcriptData.tokens || [];

  // Separate original tokens from translated tokens
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const originalTokens = rawTokens.filter((t: any) => t.translation_status !== "translation");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const translatedTokens = rawTokens.filter((t: any) => t.translation_status === "translation");

  // Build STTToken array from original tokens
  const tokens: STTToken[] = originalTokens.map((t: { text: string; start_ms?: number; end_ms?: number; speaker?: string }) => ({
    text: t.text,
    start_ms: t.start_ms ?? 0,
    end_ms: t.end_ms ?? 0,
    speaker: t.speaker,
  }));

  // Build text output
  let text: string;
  if (options.diarize && tokens.some((t) => t.speaker)) {
    text = buildDiarizedText(tokens);
  } else {
    text = transcriptData.text || tokens.map((t) => t.text).join("") || "";
  }

  // Build translated text if present
  let translatedText: string | undefined;
  if (options.translateTo && translatedTokens.length > 0) {
    translatedText = translatedTokens.map((t: { text: string }) => t.text).join("");
  }

  // --- Step 5: Clean up uploaded file (best effort) ---
  cleanupFile(apiKey, fileId);

  return {
    text,
    durationSeconds,
    latencyMs: Date.now() - start,
    tokens: tokens.length > 0 ? tokens : undefined,
    translatedText,
  };
}

/**
 * Build diarized text with speaker labels from tokens.
 * Groups consecutive tokens by the same speaker.
 */
function buildDiarizedText(tokens: STTToken[]): string {
  if (tokens.length === 0) return "";

  const parts: string[] = [];
  let currentSpeaker = tokens[0].speaker || "Unknown";
  let currentText = "";

  for (const token of tokens) {
    const speaker = token.speaker || "Unknown";
    if (speaker !== currentSpeaker) {
      parts.push(`[${currentSpeaker}] ${currentText.trim()}`);
      currentSpeaker = speaker;
      currentText = token.text;
    } else {
      currentText += token.text;
    }
  }
  // Push last segment
  if (currentText.trim()) {
    parts.push(`[${currentSpeaker}] ${currentText.trim()}`);
  }

  return parts.join("\n\n");
}

/**
 * Kill a Soniox transcription job and clean up the associated file.
 * Called on timeout to free Soniox resources.
 */
async function killTranscription(apiKey: string, transcriptionId: string, fileId: string): Promise<void> {
  try {
    await fetch(`${SONIOX_BASE}/transcriptions/${transcriptionId}`, {
      method: "DELETE",
      headers: authHeaders(apiKey),
    });
  } catch {
    /* best effort */
  }
  cleanupFile(apiKey, fileId);
}

/** Best-effort delete of uploaded file on Soniox */
function cleanupFile(apiKey: string, fileId: string): void {
  fetch(`${SONIOX_BASE}/files/${fileId}`, {
    method: "DELETE",
    headers: authHeaders(apiKey),
  }).catch(() => {
    /* ignore cleanup errors */
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mimeExtension(mimeType: string): string {
  const map: Record<string, string> = {
    "audio/mpeg": ".mp3",
    "audio/mp3": ".mp3",
    "audio/wav": ".wav",
    "audio/wave": ".wav",
    "audio/x-wav": ".wav",
    "audio/ogg": ".ogg",
    "audio/flac": ".flac",
    "audio/x-flac": ".flac",
    "audio/mp4": ".m4a",
    "audio/m4a": ".m4a",
    "audio/x-m4a": ".m4a",
    "audio/aac": ".aac",
    "audio/webm": ".webm",
  };
  return map[mimeType.toLowerCase()] || ".mp3";
}
