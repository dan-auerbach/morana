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

/**
 * URL POVZETEK preset: URL → Fetch → Classifier → Research → Article → SEO → Fact-check → Drupal JSON
 *
 * Engine v2 features used:
 * - URL content fetching (fetchUrls: true on step 0)
 * - Conditional step execution (outline for high complexity, research if needs_web)
 * - Dynamic model selection (modelStrategy: auto)
 * - Web search (OpenAI Responses API for research & fact-check)
 * - Cross-step context references ({{step.N.text}}, {{step.N.json}})
 *
 * Input: URL to an article or web page
 * Output: structured Drupal JSON + SEO + confidence score + public preview
 */
export const URL_POVZETEK_PRESET: RecipePreset = {
  key: "url-povzetek",
  name: "URL POVZETEK",
  description: "URL → povzetek → članek → SEO → fact-check → Drupal JSON. Pipeline za povzemanje spletnih vsebin.",
  inputKind: "text",
  inputModes: ["text"],
  defaultLang: "sl",
  uiHints: {
    label: "URL Povzetek",
    description: "Prilepite URL spletne strani — AI bo prebral vsebino, napisal članek, SEO in fact-check.",
    placeholder: "Prilepite URL spletne strani (npr. https://www.rtvslo.si/...)",
  },
  steps: [
    // ── Step 0: CLASSIFIER (with URL fetching) ──
    {
      stepIndex: 0,
      name: "Klasifikator",
      type: "llm",
      config: {
        modelId: "gemini-2.0-flash",
        fetchUrls: true,
        systemPrompt: `You are a newsroom classifier for a Slovenian media organization.
You will receive the fetched content of a web page URL. Analyze it and return STRICT JSON only — no explanations, no markdown.

Return this exact structure:
{
  "complexity": "low" | "medium" | "high",
  "needs_web": true | false,
  "topic_type": "politics" | "economy" | "local" | "breaking" | "analysis" | "culture" | "sports" | "technology" | "other",
  "recommended_length": <number of words>,
  "risk_level": "low" | "medium" | "high",
  "source_language": "sl" | "en" | "de" | "hr" | "other",
  "source_title": "title of the original article",
  "source_summary": "comprehensive 5-10 sentence summary of the source article, covering all key facts, figures, quotes, and conclusions"
}

Guidelines:
- complexity: "low" for simple factual topics, "medium" for multi-faceted topics, "high" for investigative/analysis topics
- needs_web: true if additional context or verification from other web sources would improve the article
- topic_type: classify the topic into the most appropriate category
- recommended_length: 300-500 for low, 500-800 for medium, 800-1200 for high
- risk_level: "high" for politics, legal, health claims; "medium" for economy, breaking; "low" for culture, sports, local events
- source_language: the language of the original article
- source_title: the title as found in the source
- source_summary: DETAILED summary — this is the primary data source for the article writer. Include ALL key facts, names, numbers, dates, quotes, and conclusions from the source.`,
        userPromptTemplate: "Classify and summarize the content from this URL:\n\n{{original_input}}",
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
You are given a URL and its classified content. Research the topic further to find additional context, verify key claims, and gather supplementary information.

Return STRICT JSON only — no explanations, no markdown.

Return this exact structure:
{
  "facts": [
    { "claim": "factual statement", "source": "source name", "url": "source url" }
  ],
  "sources": [
    { "title": "source title", "url": "source url" }
  ],
  "key_figures": ["person or entity relevant to the story"],
  "timeline": ["chronological event if relevant"],
  "additional_context": "any important background context not in the original article"
}

Rules:
- Include 3-8 verified facts with sources
- Prioritize Slovenian and reputable international sources
- Focus on SUPPLEMENTARY information not already in the source article
- Include specific numbers, dates, and quotes where available
- All URLs must be real and accessible`,
        userPromptTemplate: `Research this topic for additional context and verification.

SOURCE URL: {{original_input}}

CLASSIFICATION (includes source summary):
{{step.0.text}}`,
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
You are creating an outline for an article based on a web source. The article should be an original piece inspired by the source, NOT a simple translation or copy.

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
  "angle": "the editorial angle or perspective — how this article differs from the source"
}

Write in Slovenian. Target 4-6 sections for a comprehensive article.
The article must provide NEW VALUE beyond the source — a unique angle, deeper analysis, or local perspective.`,
        userPromptTemplate: `Create article outline based on the source content.

SOURCE URL: {{original_input}}

CLASSIFICATION (includes source summary):
{{step.0.text}}

ADDITIONAL RESEARCH (web):
{{step.1.text}}`,
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
        modelStrategyMap: { low: "gpt-5-mini", medium: "gpt-5.2", high: "claude-sonnet-4-5-20250929" },
        systemPrompt: `Si profesionalni novinar za slovensko medijsko hišo. Piši v slovenščini.

NALOGA:
Na podlagi vsebine spletne strani (klasifikacija vsebuje podroben povzetek vira), morebitne dodatne raziskave in (opcijsko) osnutka sestavi IZVIRNI novinarski članek v slovenščini.

POMEMBNO:
- Članek NI prevod izvirnika — je NOVA novinarska vsebina, ki temelji na podatkih iz vira
- Če je izvirni članek v tujem jeziku, preoblikuj vsebino v naraven slovenski novinarski slog
- Dodaj kontekst, ki je relevanten za slovensko občinstvo
- Navedi izvirni vir (URL) v članku

FORMAT:
1. # NASLOV — jasen, informativen, največ 12 besed, v slovenščini
2. PODNASLOV / LEAD — 1-2 povedi ki povzamejo bistvo
3. TELO ČLANKA:
   - Uporabi piramido obrnjenega trikotnika (najpomembnejše najprej)
   - ## Podnaslov za vsak tematski sklop
   - Citati v navednicah z navedbo govorca (če so na voljo)
   - Alineje (bullet points) za sezname ali ključne podatke
   - **Krepko** za poudarke
   - Na koncu navedi vir: "Vir: [naslov vira](URL)"

PRAVILA:
- NE izmišljaj dejstev — uporabi SAMO informacije iz klasifikacije, raziskave in osnutka
- Če informacija ni na voljo, NE dodajaj podatkov
- Če je informacija negotova, jo označi z [?]
- Ohrani nevtralen novinarski ton
- Piši jedrnato, jasno in strokovno
- Dolžina naj ustreza zahtevnosti teme (glej klasifikacijo)`,
        userPromptTemplate: `Napiši izvirni novinarski članek v slovenščini na podlagi spletnega vira.

IZVIRNI URL:
{{original_input}}

KLASIFIKACIJA (vsebuje podroben povzetek vira):
{{step.0.text}}

DODATNA RAZISKAVA (web):
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

    // ── Step 5: FACT CHECK ──
    {
      stepIndex: 5,
      name: "Fact Check",
      type: "llm",
      config: {
        modelId: "gpt-5.2",
        webSearch: true,
        systemPrompt: `You are a fact-checker for a Slovenian news organization.
Analyze the article for factual accuracy. Compare claims against:
1. The original source URL content (from classification step)
2. The additional web research data
3. Your own web search verification

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
  "source_fidelity": "accurate" | "embellished" | "distorted",
  "overall_verdict": "safe" | "needs_review" | "high_risk",
  "confidence_score": <number 0-100>,
  "summary": "brief assessment in Slovenian"
}

Rules:
- confidence_score: 90-100 = all claims verified, 70-89 = minor issues, 50-69 = significant concerns, <50 = major problems
- source_fidelity: check whether the article accurately represents the source material
- Flag any claims that appear fabricated, embellished beyond the source, or unverifiable
- "safe" = all claims verified or plausible, "needs_review" = some flagged claims, "high_risk" = major factual issues`,
        userPromptTemplate: `Fact-check this article against its source.

IZVIRNI URL:
{{original_input}}

KLASIFIKACIJA (vključuje povzetek vira):
{{step.0.json}}

ČLANEK:
{{step.3.text}}

DODATNA RAZISKAVA (web viri):
{{step.1.json}}`,
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

/**
 * INTERVJU > ČLANEK preset: Audio → STT → Article (5 best quotes) → SEO → Drupal JSON
 *
 * Specialized for interview recordings. The LLM identifies the 5 most
 * interesting/impactful statements from the transcript and weaves them
 * into a journalistic article as highlighted blockquotes.
 *
 * Input: audio file, audio URL, or pasted transcript
 * Output: structured Drupal JSON + SEO + public preview (no fact-check needed)
 */
export const INTERVJU_CLANEK_PRESET: RecipePreset = {
  key: "intervju-clanek",
  name: "INTERVJU > ČLANEK",
  description: "Intervju (audio) → transkripcija → novinarski članek s 5 najboljšimi izjavami → SEO → Drupal JSON.",
  inputKind: "audio",
  inputModes: ["file", "url", "text"],
  defaultLang: "sl",
  uiHints: {
    acceptAudio: "audio/mpeg,audio/mp3,audio/wav,audio/ogg,audio/flac,audio/m4a,audio/aac,audio/webm",
    maxFileSizeMB: 100,
  },
  steps: [
    // ── Step 0: TRANSKRIPCIJA (Soniox STT) ──
    {
      stepIndex: 0,
      name: "Transkripcija",
      type: "stt",
      config: {
        provider: "soniox",
        language: "sl",
        description: "Transkribiraj audio posnetek intervjuja v besedilo (slovenščina)",
      },
    },

    // ── Step 1: ČLANEK (Interview → Article with 5 best quotes) ──
    {
      stepIndex: 1,
      name: "Članek",
      type: "llm",
      config: {
        modelId: "gpt-5.2",
        systemPrompt: `Si profesionalni novinar za slovensko medijsko hišo. Piši v slovenščini.

NALOGA:
Na podlagi transkripcije intervjuja sestavi novinarski članek za spletne medije.

KLJUČNA ZAHTEVA — 5 NAJBOLJŠIH IZJAV:
Iz transkripcije izberi **5 najbolj zanimivih, pomembnih ali vplivnih izjav** sogovornika.
Izberi izjave, ki so:
- Presenetljive, kontroverzne ali emocionalne
- Ključne za razumevanje teme
- Citatno vredne — da bi jih bralec želel deliti
- Informativne z novo ali ekskluzivno informacijo

Izjave vključi v članek kot poudarjene citate v formatu:

> "Dobesedni citat iz transkripcije." — Ime Govorca

FORMAT ČLANKA:
1. # NASLOV — jasen, informativen, lahko temelji na najmočnejši izjavi, največ 12 besed
2. PODNASLOV / LEAD — 1-2 povedi: kdo je bil intervjuvan, o čem, zakaj je to pomembno
3. TELO ČLANKA:
   - Uporabi piramido obrnjenega trikotnika (najpomembnejše najprej)
   - ## Podnaslov za vsak tematski sklop
   - 5 citatov (blockquote z >) naravno vpletenih v besedilo — NE samo naštevaj citatov
   - Pred vsakim citatom kratka kontekstualizacija (kaj je sogovornik želel povedati, zakaj je to pomembno)
   - Po vsakem citatu kratka analiza ali pojasnilo
   - **Krepko** za poudarke
   - 5-8 odstavkov

PRAVILA:
- NE izmišljaj dejstev — uporabi SAMO informacije iz transkripcije
- Citati morajo biti DOBESEDNI iz transkripcije (dovoljeno je rahlo urediti za berljivost, ohrani pomen)
- Če govorec ni jasno identificiran v transkripciji, uporabi "sogovornik" ali "gost"
- Če je informacija negotova ali nejasna, jo označi z [?]
- Ohrani nevtralen novinarski ton
- Piši jedrnato, jasno in strokovno`,
        userPromptTemplate: "Napiši novinarski članek na podlagi naslednjega intervjuja:\n\n{{input}}",
      },
    },

    // ── Step 2: SEO ENGINE ──
    {
      stepIndex: 2,
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
- Slug: samo male črke, brez šumnikov, pomišljaji namesto presledkov
- Upoštevaj, da gre za INTERVJU — naslovi naj odražajo izjave ali temo pogovora`,
        userPromptTemplate: "Ustvari SEO metapodatke za naslednji članek:\n\n{{step.1.text}}",
      },
    },

    // ── Step 3: DRUPAL OUTPUT ──
    {
      stepIndex: 3,
      name: "Drupal Output",
      type: "output_format",
      config: {
        formats: ["drupal_json"],
        description: "Sestavi finalni Drupal JSON payload z člankom in SEO podatki",
      },
    },
  ],
};

// ─── STORY > VIDEO ──────────────────────────────────────────────────────
//
// Photo + short story → AI-enhanced cinematic video prompt → 5s img2video
// Pipeline: LLM (prompt engineer) → Video (fal.ai img2video 480p)
//
// Quality features:
//   - Expert cinematographer system prompt with motion/lighting/mood vocabulary
//   - Web search to incorporate current visual trends
//   - 300-word prompt budget for maximum detail to video model
//   - Emotional micro-arc guidance even in 5 seconds
//
const STORY_VIDEO_PRESET: RecipePreset = {
  key: "story-video",
  name: "STORY > VIDEO",
  description: "Naloži fotografijo in napiši kratko zgodbo → AI ustvari kinematografski 5-sekundni video.",
  inputKind: "image_text",
  inputModes: ["file"],
  defaultLang: "en",
  uiHints: {
    label: "Story to Video",
    description: "Upload a photo and write a short story. AI will create a cinematic 5-second video.",
    acceptImage: "image/png,image/jpeg,image/webp",
    maxFileSizeMB: 20,
    textPlaceholder: "Describe the scene, tell a short story, or set the mood for the video...",
  },
  steps: [
    // ── Step 0: LLM — Video Prompt Engineer ──────────────────────
    {
      stepIndex: 0,
      name: "Video Prompt",
      type: "llm",
      config: {
        modelId: "gpt-5.2",
        webSearch: true,
        description: "Analyze story and craft an expert cinematic video prompt for img2video generation",
        systemPrompt: `You are an expert cinematographer and AI video prompt engineer. You specialize in creating prompts for AI video generation (image-to-video) that produce cinematic, visually stunning short videos.

CONTEXT:
You will receive the user's uploaded photo AND their text description/story. You can SEE the actual image — carefully analyze its visual elements: the people, their expressions, poses, clothing, the colors, lighting, composition, setting, background, and overall mood.

YOUR TASK:
1. LOOK at the photo carefully — identify specific visual elements (number of people, their appearance, setting, colors, objects, lighting conditions)
2. Read the user's story/description to understand the narrative intent and desired direction
3. Combine what you SEE in the photo with what the user WROTE to craft the perfect video prompt
4. Search the web for current visual trends, cinematography techniques, or aesthetic references that match the mood
5. Create a single, detailed video prompt that describes:
   - Camera movement (slow dolly, gentle pan, zoom, static with subject motion, etc.)
   - Subject motion based on ACTUAL people/objects in the photo (what moves, how, how fast)
   - Atmospheric effects that complement the ACTUAL lighting in the photo
   - Mood and emotional progression across the 5 seconds
   - Cinematic style (film grain, color grading, depth of field)

OUTPUT FORMAT:
Return ONLY the video prompt text. No explanations, no JSON, no markdown. Just the prompt.

RULES FOR GREAT VIDEO PROMPTS:
- Keep it under 300 words but be specific and vivid
- Reference SPECIFIC visual elements you see in the photo (e.g., "the three people raise their arms", not generic descriptions)
- Describe motion explicitly ("camera slowly dollies forward", "wind gently moves the hair")
- Include lighting direction and quality based on what you observe ("warm golden hour light from the left")
- Mention depth of field and focus ("shallow depth of field, background softly blurred")
- Reference a cinematic style when fitting ("Wes Anderson color palette", "Terrence Malick natural light")
- Add subtle atmospheric details ("dust particles catch the light", "gentle lens flare")
- Describe the emotional arc even in 5 seconds ("starting serene, building to wonder")
- Avoid impossible physics or jarring transitions — keep motion natural
- The prompt MUST complement and extend the existing image, never contradict what is visible
- Modern trends: cinematic color grading, anamorphic lens feel, natural handheld movement
- If the story is in a non-English language, still write the video prompt in ENGLISH`,
        userPromptTemplate: "{{original_input}}",
      },
    },
    // ── Step 1: Video Generation (img2video) ─────────────────────
    {
      stepIndex: 1,
      name: "Video Generation",
      type: "video",
      config: {
        videoOperation: "img2video",
        videoDuration: 5,
        videoResolution: "480p",
        videoAspectRatio: "16:9",
        description: "Generate a 5-second cinematic video from the uploaded photo using the AI-crafted prompt",
      },
    },
  ],
};

/** All available presets */
export const RECIPE_PRESETS: RecipePreset[] = [NOVINAR_PRESET, NOVINAR_AUTO_1_PRESET, URL_POVZETEK_PRESET, INTERVJU_CLANEK_PRESET, STORY_VIDEO_PRESET];

/** Get preset by key */
export function getPreset(key: string): RecipePreset | undefined {
  return RECIPE_PRESETS.find((p) => p.key === key);
}
