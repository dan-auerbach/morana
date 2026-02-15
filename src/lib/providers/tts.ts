function getApiKey(): string {
  const val = process.env.ELEVENLABS_API_KEY || "";
  if (!val) throw new Error("ELEVENLABS_API_KEY is not configured");
  return val;
}

export type TTSResult = {
  audioBuffer: Buffer;
  mimeType: string;
  chars: number;
  latencyMs: number;
};

export async function runTTS(
  text: string,
  voiceId: string
): Promise<TTSResult> {
  const start = Date.now();
  const apiKey = getApiKey();

  const resp = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
    {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_v3",
      }),
    }
  );

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`ElevenLabs API error ${resp.status}: ${errText}`);
  }

  const arrayBuffer = await resp.arrayBuffer();
  return {
    audioBuffer: Buffer.from(arrayBuffer),
    mimeType: "audio/mpeg",
    chars: text.length,
    latencyMs: Date.now() - start,
  };
}

export type Voice = { id: string; name: string };

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
