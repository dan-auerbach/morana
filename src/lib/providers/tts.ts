function getApiKey(): string {
  const val = process.env.ELEVENLABS_API_KEY || "";
  if (!val) throw new Error("ELEVENLABS_API_KEY is not configured");
  return val;
}

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type VoiceSettings = {
  stability?: number;       // 0.0–1.0 (default ~0.5)
  similarityBoost?: number; // 0.0–1.0 (default ~0.75)
  style?: number;           // 0.0–1.0 (default 0)
  speed?: number;           // 0.7–1.2  (default 1.0)
};

export type TTSOptions = {
  modelId?: string;         // eleven_v3 | eleven_flash_v2_5 | eleven_multilingual_v2
  outputFormat?: string;    // mp3_44100_128 | mp3_22050_32 | pcm_24000 | opus_48000_128
  languageCode?: string;    // ISO 639-1 e.g. "sl", "en", "de"
  voiceSettings?: VoiceSettings;
};

export type TTSResult = {
  audioBuffer: Buffer;
  mimeType: string;
  chars: number;
  latencyMs: number;
};

export type Voice = { id: string; name: string };

export type SFXResult = {
  audioBuffer: Buffer;
  mimeType: string;
  latencyMs: number;
};

/* ------------------------------------------------------------------ */
/*  Available models & output formats                                  */
/* ------------------------------------------------------------------ */

export const TTS_MODELS = [
  { id: "eleven_v3",              label: "Eleven v3",          langs: "70+", charLimit: 5000 },
  { id: "eleven_flash_v2_5",     label: "Flash v2.5 (fast)",  langs: "32",  charLimit: 40000 },
  { id: "eleven_multilingual_v2", label: "Multilingual v2",    langs: "29",  charLimit: 10000 },
  { id: "eleven_turbo_v2_5",     label: "Turbo v2.5",         langs: "32",  charLimit: 40000 },
] as const;

export const OUTPUT_FORMATS = [
  { id: "mp3_44100_128", label: "MP3 44.1kHz 128kbps", mime: "audio/mpeg" },
  { id: "mp3_22050_32",  label: "MP3 22kHz 32kbps",    mime: "audio/mpeg" },
  { id: "pcm_24000",     label: "PCM 24kHz (WAV)",      mime: "audio/wav" },
  { id: "opus_48000_128", label: "Opus 48kHz 128kbps",  mime: "audio/ogg" },
] as const;

function getMimeForFormat(fmt: string): string {
  const entry = OUTPUT_FORMATS.find((f) => f.id === fmt);
  return entry?.mime || "audio/mpeg";
}

/* ------------------------------------------------------------------ */
/*  Text-to-Speech                                                     */
/* ------------------------------------------------------------------ */

export async function runTTS(
  text: string,
  voiceId: string,
  options: TTSOptions = {}
): Promise<TTSResult> {
  const start = Date.now();
  const apiKey = getApiKey();
  const modelId = options.modelId || "eleven_v3";
  const outputFormat = options.outputFormat || "mp3_44100_128";

  // Build request body
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body: Record<string, any> = {
    text,
    model_id: modelId,
  };

  if (options.languageCode) {
    body.language_code = options.languageCode;
  }

  if (options.voiceSettings) {
    const vs = options.voiceSettings;
    body.voice_settings = {
      ...(vs.stability !== undefined && { stability: vs.stability }),
      ...(vs.similarityBoost !== undefined && { similarity_boost: vs.similarityBoost }),
      ...(vs.style !== undefined && { style: vs.style }),
      ...(vs.speed !== undefined && { speed: vs.speed }),
    };
  }

  const resp = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=${outputFormat}`,
    {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "audio/*",
      },
      body: JSON.stringify(body),
    }
  );

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`ElevenLabs API error ${resp.status}: ${errText}`);
  }

  // Verify response is actually audio (not JSON error wrapped in 200)
  const contentType = resp.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const errData = await resp.json();
    throw new Error(`ElevenLabs returned JSON instead of audio: ${JSON.stringify(errData).slice(0, 500)}`);
  }

  const arrayBuffer = await resp.arrayBuffer();
  if (arrayBuffer.byteLength === 0) {
    throw new Error("ElevenLabs returned empty audio response");
  }

  const mimeType = contentType.includes("audio/") ? contentType.split(";")[0].trim() : getMimeForFormat(outputFormat);
  return {
    audioBuffer: Buffer.from(arrayBuffer),
    mimeType,
    chars: text.length,
    latencyMs: Date.now() - start,
  };
}

/* ------------------------------------------------------------------ */
/*  Sound Effects Generation                                           */
/* ------------------------------------------------------------------ */

export async function runSoundEffect(
  prompt: string,
  options: { durationSeconds?: number; promptInfluence?: number } = {}
): Promise<SFXResult> {
  const start = Date.now();
  const apiKey = getApiKey();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body: Record<string, any> = {
    text: prompt,
    model_id: "eleven_text_to_sound_v2",
    output_format: "mp3_44100_128",
  };

  if (options.durationSeconds !== undefined) {
    body.duration_seconds = Math.max(0.5, Math.min(30, options.durationSeconds));
  }
  if (options.promptInfluence !== undefined) {
    body.prompt_influence = Math.max(0, Math.min(1, options.promptInfluence));
  }

  const resp = await fetch("https://api.elevenlabs.io/v1/sound-generation", {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
      Accept: "audio/*",
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`ElevenLabs SFX API error ${resp.status}: ${errText}`);
  }

  const contentType = resp.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const errData = await resp.json();
    throw new Error(`ElevenLabs SFX returned JSON instead of audio: ${JSON.stringify(errData).slice(0, 500)}`);
  }

  const arrayBuffer = await resp.arrayBuffer();
  if (arrayBuffer.byteLength === 0) {
    throw new Error("ElevenLabs SFX returned empty audio response");
  }

  const mimeType = contentType.includes("audio/") ? contentType.split(";")[0].trim() : "audio/mpeg";
  return {
    audioBuffer: Buffer.from(arrayBuffer),
    mimeType,
    latencyMs: Date.now() - start,
  };
}

/* ------------------------------------------------------------------ */
/*  Voices                                                             */
/* ------------------------------------------------------------------ */

export async function listVoices(): Promise<Voice[]> {
  const apiKey = getApiKey();
  const resp = await fetch("https://api.elevenlabs.io/v1/voices", {
    headers: { "xi-api-key": apiKey },
  });
  if (!resp.ok) return [];
  const data = await resp.json();
  return (data.voices || []).map((v: { voice_id: string; name: string }) => ({
    id: v.voice_id,
    name: v.name,
  }));
}
