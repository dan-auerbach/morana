/**
 * Recipe presets — ready-to-use multi-step pipeline definitions.
 * Each preset produces a Recipe + RecipeSteps when instantiated.
 */

export type PresetStep = {
  stepIndex: number;
  name: string;
  type: string;
  config: Record<string, unknown>;
};

export type RecipePreset = {
  key: string;
  name: string;
  description: string;
  inputKind: string;
  inputModes: string[];
  defaultLang: string;
  uiHints: Record<string, unknown>;
  steps: PresetStep[];
};

/**
 * NOVINAR preset: Audio → Članek → SEO → Drupal-ready
 *
 * Pipeline:
 * 1. STT — Soniox transcription (SL default)
 * 2. LLM — Transform transcript into structured article
 * 3. LLM SEO — Generate SEO metadata as strict JSON
 * 4. Output Format — Combine into Drupal-ready HTML + structured fields
 *
 * Input: audio file, audio URL, or pasted transcript.
 * If transcript is pasted, STT step is skipped automatically.
 */
export const NOVINAR_PRESET: RecipePreset = {
  key: "novinar",
  name: "NOVINAR",
  description: "Audio → Članek → SEO → Drupal-ready HTML. Pipeline za novinarske prispevke.",
  inputKind: "audio",
  inputModes: ["file", "url", "text"],
  defaultLang: "sl",
  uiHints: {
    acceptAudio: "audio/mpeg,audio/mp3,audio/wav,audio/ogg,audio/flac,audio/m4a,audio/aac,audio/webm",
    maxFileSizeMB: 100,
  },
  steps: [
    {
      stepIndex: 0,
      name: "Transkripcija",
      type: "stt",
      config: {
        provider: "soniox",
        language: "sl",
        description: "Transkribiraj audio posnetek v besedilo (slovenščina)",
      },
    },
    {
      stepIndex: 1,
      name: "Članek",
      type: "llm",
      config: {
        modelId: "gpt-5-mini",
        systemPrompt: `Si profesionalni novinar za slovensko medijsko hišo. Piši v slovenščini.

NALOGA:
Na podlagi transkripcije sestavi novinarski članek, ki sledi temu formatu:

1. NASLOV — jasen, informativen, največ 12 besed
2. PODNASLOV / LEAD — 1-2 povedi ki povzamejo bistvo
3. TELO ČLANKA:
   - Uporabi piramido obrnjenega trikotnika (najpomembnejše najprej)
   - Podnaslov za vsak tematski sklop
   - Citati v navednicah z navedbo govorca
   - Alineje (bullet points) za sezname ali ključne podatke
   - 3-6 odstavkov

PRAVILA:
- NE izmišljaj dejstev — uporabi SAMO informacije iz transkripcije
- Če je informacija negotova ali nejasna, jo označi z [?]
- Ohrani nevtralen novinarski ton
- Piši jedrnato in jasno`,
        userPromptTemplate: "Napiši novinarski članek na podlagi naslednje transkripcije:\n\n{{input}}",
      },
    },
    {
      stepIndex: 2,
      name: "SEO",
      type: "llm",
      config: {
        modelId: "gpt-5-mini",
        systemPrompt: `Si SEO strokovnjak za slovensko medijsko hišo. Na podlagi članka ustvari SEO metapodatke.

Odgovori STRIKTNO v JSON formatu (brez markdown blokov, samo čist JSON):
{
  "titles": [
    {"type": "exclamation", "text": "Naslov z vzklikom!"},
    {"type": "question", "text": "Naslov kot vprašanje?"},
    {"type": "prediction", "text": "Naslov z napovedjo/click-bait"}
  ],
  "metaDescription": "SEO meta opis, 150-160 znakov",
  "keywords": ["ključna1", "ključna2", "ključna3", "ključna4", "ključna5"],
  "tags": ["oznaka1", "oznaka2", "oznaka3"],
  "slug": "url-prijazni-slug-clanka"
}

PRAVILA:
- Naslovi morajo biti v slovenščini, max 70 znakov
- Meta opis mora privabiti bralca in vsebovati ključno besedo
- Ključne besede: 5-8, relevantne za iskalnike
- Tags: 3-5 tematskih oznak
- Slug: samo male črke, brez šumnikov, pomišljaji namesto presledkov`,
        userPromptTemplate: "Ustvari SEO metapodatke za naslednji članek:\n\n{{input}}",
      },
    },
    {
      stepIndex: 3,
      name: "Drupal Output",
      type: "output_format",
      config: {
        formats: ["drupal_json"],
        description: "Združi članek in SEO podatke v Drupal-ready format",
      },
    },
  ],
};

/** All available presets */
export const RECIPE_PRESETS: RecipePreset[] = [NOVINAR_PRESET];

/** Get preset by key */
export function getPreset(key: string): RecipePreset | undefined {
  return RECIPE_PRESETS.find((p) => p.key === key);
}
