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

/**
 * NOVINAR AUTO 1 preset: Text topic → Classifier → Research → Article → SEO → Fact-check → Drupal JSON
 *
 * Engine v2 features used:
 * - Conditional step execution (research, outline, fact-check)
 * - Dynamic model selection (modelStrategy: auto)
 * - Web search (OpenAI Responses API)
 * - Cross-step context references ({{step.N.text}}, {{step.N.json}})
 *
 * Input: short text topic (e.g. "mestni proračun 2026")
 * Output: structured Drupal JSON + SEO + confidence score + public preview
 */
export const NOVINAR_AUTO_1_PRESET: RecipePreset = {
  key: "novinar-auto-1",
  name: "NOVINAR AUTO 1",
  description: "AI Novinar: tema → research → članek → SEO → fact-check → Drupal JSON + preview.",
  inputKind: "text",
  inputModes: ["text"],
  defaultLang: "sl",
  uiHints: {
    label: "AI Novinar (Auto)",
    description: "Samodejno raziskovanje, pisanje, SEO in fact-check z dinamično izbiro modela.",
  },
  steps: [
    // ── Step 0: CLASSIFIER ──
    {
      stepIndex: 0,
      name: "Klasifikator",
      type: "llm",
      config: {
        modelId: "gemini-2.0-flash",
        systemPrompt: `You are a newsroom classifier for a Slovenian media organization.
Analyze the given topic and return STRICT JSON only — no explanations, no markdown.

Return this exact structure:
{
  "complexity": "low" | "medium" | "high",
  "needs_web": true | false,
  "topic_type": "politics" | "economy" | "local" | "breaking" | "analysis" | "culture" | "sports" | "technology" | "other",
  "recommended_length": <number of words>,
  "risk_level": "low" | "medium" | "high"
}

Guidelines:
- complexity: "low" for simple factual topics, "medium" for multi-faceted topics, "high" for investigative/analysis topics
- needs_web: true if the topic requires recent facts, statistics, or verification from web sources
- topic_type: classify the topic into the most appropriate category
- recommended_length: 300-500 for low, 500-800 for medium, 800-1200 for high
- risk_level: "high" for politics, legal, health claims; "medium" for economy, breaking; "low" for culture, sports, local events`,
        userPromptTemplate: "Classify this news topic:\n\n{{original_input}}",
      },
    },

    // ── Step 1: WEB RESEARCH (conditional: needs_web == true) ──
    {
      stepIndex: 1,
      name: "Web Research",
      type: "llm",
      config: {
        modelId: "gpt-5.2",
        webSearch: true,
        condition: { stepIndex: 0, field: "needs_web", operator: "eq", value: true },
        systemPrompt: `You are a research assistant for a Slovenian newsroom.
Research the given topic and return STRICT JSON only — no explanations, no markdown.

Return this exact structure:
{
  "facts": [
    { "claim": "factual statement", "source": "source name", "url": "source url" }
  ],
  "sources": [
    { "title": "source title", "url": "source url" }
  ],
  "key_figures": ["person or entity relevant to the story"],
  "timeline": ["chronological event if relevant"]
}

Rules:
- Include 3-8 verified facts with sources
- Prioritize Slovenian and reputable international sources
- Include specific numbers, dates, and quotes where available
- All URLs must be real and accessible`,
        userPromptTemplate: "Research this topic thoroughly:\n\n{{original_input}}",
      },
    },

    // ── Step 2: OUTLINE (conditional: complexity == "high") ──
    {
      stepIndex: 2,
      name: "Outline",
      type: "llm",
      config: {
        modelStrategy: "auto",
        modelStrategySource: { stepIndex: 0, field: "complexity" },
        modelStrategyMap: { low: "gpt-5-mini", medium: "gpt-5.2", high: "gpt-5.2" },
        condition: { stepIndex: 0, field: "complexity", operator: "eq", value: "high" },
        systemPrompt: `You are a senior editor creating an article outline for a Slovenian newsroom.
Return STRICT JSON only:

{
  "headline_options": ["option 1", "option 2", "option 3"],
  "lead": "compelling lead paragraph in 1-2 sentences",
  "sections": [
    {
      "title": "section title",
      "bullet_points": ["key point 1", "key point 2"],
      "suggested_sources": ["reference to research fact if available"]
    }
  ],
  "angle": "the editorial angle or perspective for the article"
}

Write in Slovenian. Target 4-6 sections for a comprehensive article.`,
        userPromptTemplate: "Create article outline.\n\nTopic: {{original_input}}\n\nResearch data:\n{{step.1.text}}",
      },
    },

    // ── Step 3: WRITING ENGINE ──
    {
      stepIndex: 3,
      name: "Članek",
      type: "llm",
      config: {
        modelStrategy: "auto",
        modelStrategySource: { stepIndex: 0, field: "complexity" },
        modelStrategyMap: { low: "gpt-5-mini", medium: "gpt-5.2", high: "gpt-5.2" },
        systemPrompt: `Si profesionalni novinar za slovensko medijsko hišo. Piši v slovenščini.

NALOGA:
Na podlagi teme, raziskave in (opcijsko) osnutka sestavi profesionalen novinarski članek.

FORMAT:
1. # NASLOV — jasen, informativen, največ 12 besed
2. PODNASLOV / LEAD — 1-2 povedi ki povzamejo bistvo (v prvem odstavku)
3. TELO ČLANKA:
   - Uporabi piramido obrnjenega trikotnika (najpomembnejše najprej)
   - ## Podnaslov za vsak tematski sklop
   - Citati v navednicah z navedbo govorca (če so na voljo iz raziskave)
   - Alineje (bullet points) za sezname ali ključne podatke
   - **Krepko** za poudarke
   - Navedi vire pri trditvah ki izhajajo iz web raziskave

PRAVILA:
- NE izmišljaj dejstev — uporabi SAMO informacije iz teme in raziskave
- Če informacija ni na voljo iz raziskave, NE dodajaj podatkov
- Če je informacija negotova, jo označi z [?]
- Ohrani nevtralen novinarski ton
- Piši jedrnato, jasno in strokovno
- Dolžina naj ustreza zahtevnosti teme`,
        userPromptTemplate: `Napiši novinarski članek.

TEMA:
{{original_input}}

KLASIFIKACIJA:
{{step.0.text}}

RAZISKAVA (web):
{{step.1.text}}

OUTLINE (če obstaja):
{{step.2.text}}`,
      },
    },

    // ── Step 4: SEO ENGINE ──
    {
      stepIndex: 4,
      name: "SEO",
      type: "llm",
      config: {
        modelId: "gpt-5-mini",
        systemPrompt: `Si SEO strokovnjak za slovensko medijsko hišo. Na podlagi članka ustvari SEO metapodatke.

Odgovori STRIKTNO v JSON formatu (brez markdown blokov, samo čist JSON):
{
  "meta_title": "SEO naslov, max 60 znakov",
  "meta_description": "SEO meta opis, 150-160 znakov",
  "keywords": ["ključna1", "ključna2", "ključna3", "ključna4", "ključna5"],
  "slug": "url-prijazni-slug-clanka",
  "social_title": "Naslov za družbena omrežja, max 70 znakov",
  "social_description": "Opis za družbena omrežja, max 200 znakov",
  "category_suggestion": "predlagana kategorija",
  "titles": [
    {"type": "exclamation", "text": "Naslov z vzklikom!"},
    {"type": "question", "text": "Naslov kot vprašanje?"},
    {"type": "prediction", "text": "Naslov z napovedjo"}
  ],
  "tags": ["oznaka1", "oznaka2", "oznaka3"],
  "internal_link_suggestions": ["tema za interno povezavo"]
}

PRAVILA:
- Vsi naslovi v slovenščini
- Meta opis mora privabiti bralca in vsebovati ključno besedo
- Ključne besede: 5-8, relevantne za iskalnike
- Tags: 3-5 tematskih oznak
- Slug: samo male črke, brez šumnikov, pomišljaji namesto presledkov`,
        userPromptTemplate: "Ustvari SEO metapodatke za naslednji članek:\n\n{{step.3.text}}",
      },
    },

    // ── Step 5: FACT CHECK (conditional: risk_level != "low") ──
    {
      stepIndex: 5,
      name: "Fact Check",
      type: "llm",
      config: {
        modelId: "gpt-5.2",
        condition: { stepIndex: 0, field: "risk_level", operator: "neq", value: "low" },
        systemPrompt: `You are a fact-checker for a Slovenian news organization.
Analyze the article for factual accuracy. Compare claims against the provided research data.

Return STRICT JSON only:
{
  "verified_claims": [
    { "claim": "statement from article", "status": "verified", "source": "matching source" }
  ],
  "flagged_claims": [
    { "claim": "problematic statement", "issue": "description of the problem", "severity": "warning" | "error" }
  ],
  "corrections": [
    { "original": "incorrect text", "corrected": "suggested correction", "reason": "explanation" }
  ],
  "overall_verdict": "safe" | "needs_review" | "high_risk",
  "confidence_score": <number 0-100>,
  "summary": "brief assessment in Slovenian"
}

Rules:
- confidence_score: 90-100 = all claims verified, 70-89 = minor issues, 50-69 = significant concerns, <50 = major problems
- If no research data available, base assessment on internal consistency and plausibility
- Flag any claims that appear fabricated or unverifiable
- "safe" = all claims verified or plausible, "needs_review" = some flagged claims, "high_risk" = major factual issues`,
        userPromptTemplate: `Fact-check this article.

ČLANEK:
{{step.3.text}}

RAZISKAVA (web viri):
{{step.1.json}}

KLASIFIKACIJA:
{{step.0.json}}`,
      },
    },

    // ── Step 6: DRUPAL OUTPUT ──
    {
      stepIndex: 6,
      name: "Drupal Output",
      type: "output_format",
      config: {
        formats: ["drupal_json"],
        description: "Sestavi finalni Drupal JSON payload z člankom, SEO, viri in confidence score",
      },
    },
  ],
};

/** All available presets */
export const RECIPE_PRESETS: RecipePreset[] = [NOVINAR_PRESET, NOVINAR_AUTO_1_PRESET];

/** Get preset by key */
export function getPreset(key: string): RecipePreset | undefined {
  return RECIPE_PRESETS.find((p) => p.key === key);
}
