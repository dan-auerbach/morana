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

    // ── Step 7: DRUPAL PUBLISH (optional — only runs if integration configured) ──
    {
      stepIndex: 7,
      name: "Drupal Publish",
      type: "drupal_publish",
      config: {
        mode: "draft",
        description: "Objavi članek v Drupal kot osnutek (draft)",
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

// ─── LONGEVITY URL ──────────────────────────────────────────────────────
//
// URL → Source Analysis → Scientific Research → Expert Article → SEO → Fact-check → Drupal Publish
//
// Purpose: Turn any health/longevity/biohacking web source into a high-quality
// English article for a longevity-focused audience, then push directly to Drupal.
//
// Quality approach:
//   - Always performs web research (health content demands verification)
//   - Scientific writing with proper source attribution
//   - Strict medical fact-check with evidence grading
//   - Source article always cited with link
//   - Drupal publish as draft for editorial review
//
const LONGEVITY_URL_PRESET: RecipePreset = {
  key: "longevity-url",
  name: "LONGEVITY URL",
  description: "URL → research → expert longevity article (EN) → SEO → fact-check → Drupal publish.",
  inputKind: "text",
  inputModes: ["text"],
  defaultLang: "en",
  uiHints: {
    label: "Longevity URL → Drupal",
    description: "Paste a URL — AI reads the source, researches the science, writes an expert English article for your longevity audience, and publishes to Drupal.",
    placeholder: "Paste article URL (e.g. https://www.nature.com/articles/...)",
  },
  steps: [
    // ── Step 0: SOURCE ANALYSIS (with URL fetching) ──
    {
      stepIndex: 0,
      name: "Source Analysis",
      type: "llm",
      config: {
        modelId: "gpt-5.2",
        fetchUrls: true,
        systemPrompt: `You are a senior science editor specializing in longevity, aging research, biohacking, and healthspan optimization.

You will receive the full content of a web page. Analyze it thoroughly and return STRICT JSON only — no explanations, no markdown.

Return this exact structure:
{
  "complexity": "low" | "medium" | "high",
  "needs_web": true,
  "topic_type": "research_study" | "clinical_trial" | "supplement" | "lifestyle" | "biohacking" | "nutrition" | "exercise" | "mental_health" | "genetics" | "technology" | "policy" | "review" | "other",
  "evidence_tier": "peer_reviewed" | "preprint" | "expert_opinion" | "anecdotal" | "press_release" | "mixed",
  "recommended_length": <number of words>,
  "risk_level": "low" | "medium" | "high",
  "source_language": "en" | "de" | "sl" | "es" | "fr" | "other",
  "source_title": "title of the original article",
  "source_url": "the URL provided by the user",
  "source_date": "publication date if found, or null",
  "source_author": "author name(s) if found, or null",
  "key_claims": [
    { "claim": "specific factual claim", "evidence_basis": "what supports it in the source" }
  ],
  "key_compounds_or_interventions": ["e.g. rapamycin", "zone 2 cardio", "NAD+"],
  "mentioned_studies": [
    { "title": "study title if mentioned", "journal": "journal name", "year": "year" }
  ],
  "source_summary": "Comprehensive 10-15 sentence summary covering ALL key findings, data points, mechanisms, dosages, study parameters, expert quotes, and conclusions. This is the PRIMARY data source for the article writer — be exhaustive."
}

Guidelines:
- complexity: "low" for single-finding news, "medium" for multi-faceted topics, "high" for deep mechanistic or review articles
- needs_web: ALWAYS true for health/longevity content (verification is mandatory)
- evidence_tier: classify the quality of evidence presented
- risk_level: "high" for specific health claims, dosage recommendations, or disease treatment; "medium" for general wellness; "low" for lifestyle/exercise
- key_claims: extract EVERY specific factual claim (numbers, percentages, study results)
- source_summary: be EXHAUSTIVE — include all data points, study parameters, sample sizes, effect sizes, mechanisms, expert names and their affiliations`,
        userPromptTemplate: "Analyze this source for a longevity article:\n\n{{original_input}}",
      },
    },

    // ── Step 1: SCIENTIFIC RESEARCH (always runs for health content) ──
    {
      stepIndex: 1,
      name: "Scientific Research",
      type: "llm",
      config: {
        modelId: "gpt-5.2",
        webSearch: true,
        systemPrompt: `You are a longevity research assistant with expertise in geroscience, molecular biology, and clinical medicine.

Given a source article analysis about a longevity/health topic, perform thorough supplementary research.

Return STRICT JSON only:
{
  "facts": [
    { "claim": "verified factual statement", "source": "source name", "url": "source url", "evidence_quality": "strong" | "moderate" | "weak" }
  ],
  "sources": [
    { "title": "source title", "url": "source url", "type": "study" | "review" | "expert" | "institution" | "news" }
  ],
  "related_studies": [
    { "title": "study title", "journal": "journal", "year": "year", "key_finding": "one-sentence finding", "url": "doi or pubmed url if available" }
  ],
  "expert_context": "2-3 sentences of expert context: where does this fit in the current scientific landscape? Is the evidence converging or controversial?",
  "mechanism_summary": "Brief explanation of the biological mechanism if applicable (e.g. mTOR pathway, senolytic action, telomere dynamics)",
  "practical_implications": "What does this mean for someone interested in longevity? Any actionable takeaways?",
  "caveats": ["important limitations or nuances", "e.g. mouse study only", "small sample size", "correlation not causation"],
  "key_figures": ["researcher names or institutions relevant to this topic"]
}

Research priorities:
1. Find the ORIGINAL peer-reviewed study if the source is a news article about research
2. Look for meta-analyses or systematic reviews on the same topic
3. Find expert commentary or rebuttals
4. Check if the findings have been replicated
5. Identify any conflicts of interest or funding sources
6. Prioritize: PubMed, Nature, Science, Cell, The Lancet, NEJM, clinicaltrials.gov
7. Include practical context from longevity-focused experts (Attia, Sinclair, Longo, etc.) if relevant`,
        userPromptTemplate: `Research this longevity topic thoroughly.

SOURCE URL: {{original_input}}

SOURCE ANALYSIS:
{{step.0.text}}`,
      },
    },

    // ── Step 2: EXPERT ARTICLE WRITING ──
    {
      stepIndex: 2,
      name: "Article",
      type: "llm",
      config: {
        modelStrategy: "auto",
        modelStrategySource: { stepIndex: 0, field: "complexity" },
        modelStrategyMap: { low: "gpt-5.2", medium: "gpt-5.2", high: "claude-sonnet-4-5-20250929" },
        systemPrompt: `You are an expert health and longevity journalist writing for an educated audience that follows aging research, biohacking, and healthspan optimization. Write in English.

YOUR AUDIENCE:
- Health-conscious readers who understand basic biology
- They want depth, not dumbed-down summaries
- They value evidence quality and scientific nuance
- They want actionable insights when appropriate
- They follow researchers like Peter Attia, David Sinclair, Valter Longo, Rhonda Patrick

ARTICLE STRUCTURE:

1. # HEADLINE — compelling, specific, avoids clickbait. Max 12 words. Should convey the key finding or insight.

2. LEAD PARAGRAPH — 2-3 sentences that answer: What happened? Why does it matter for longevity? What's the evidence quality?

3. BODY — organized into clear sections with ## subheadings:

   a. **The Finding / Key Insight** — What exactly was discovered or reported? Include specific data: effect sizes, p-values, sample sizes, duration.

   b. **The Science** — Explain the biological mechanism in accessible but precise language. Don't shy away from naming pathways (mTOR, AMPK, sirtuins, etc.) but briefly explain them.

   c. **The Evidence** — How strong is this evidence? Peer-reviewed? RCT or observational? Human or animal model? Replicated? Include a brief evidence quality assessment.

   d. **Expert Context** — What do leading researchers say? Where does this fit in the broader field? Is the scientific community aligned or divided?

   e. **Practical Takeaways** — What, if anything, can readers do with this information? Be responsible: clearly distinguish between "established" and "experimental."

   f. **Caveats & Limitations** — What are the important limitations? What questions remain unanswered?

4. SOURCE ATTRIBUTION — End with:
   **Source:** [Original Article Title](URL) — Author, Publication, Date

FORMATTING:
- Use ## for section headings
- Use **bold** for key terms and important data points
- Use > blockquotes for direct expert quotes
- Use bullet points for lists of findings, compounds, or practical tips
- Include specific numbers: "a **23% reduction** in all-cause mortality (HR 0.77, 95% CI 0.68-0.87)"

RULES:
- NEVER fabricate data, studies, or quotes — use ONLY what's in the source analysis and research
- If a claim has weak evidence, SAY SO explicitly
- Don't use sensationalist language ("breakthrough", "miracle", "game-changer")
- DO use precise scientific language where appropriate
- Attribute every major claim to its source
- If dosages are mentioned, include them but add "consult a healthcare provider" caveat
- Distinguish between human and animal studies clearly
- Article length should match complexity: 600-800 words (low), 800-1200 (medium), 1200-1800 (high)`,
        userPromptTemplate: `Write an expert longevity article based on this source.

ORIGINAL URL:
{{original_input}}

SOURCE ANALYSIS (contains all key data from the original):
{{step.0.text}}

SCIENTIFIC RESEARCH (supplementary evidence and expert context):
{{step.1.text}}`,
      },
    },

    // ── Step 3: SEO ENGINE (English, longevity niche) ──
    {
      stepIndex: 3,
      name: "SEO",
      type: "llm",
      config: {
        modelId: "gpt-5-mini",
        systemPrompt: `You are an SEO specialist for a longevity and healthspan website. Generate SEO metadata optimized for health/science/longevity search queries.

Return STRICT JSON only:
{
  "meta_title": "SEO title, max 60 chars — include primary keyword",
  "meta_description": "SEO meta description, 150-160 chars — compelling, includes keyword, hints at evidence quality",
  "keywords": ["primary keyword", "secondary keyword", "long-tail phrase", "related term", "related term"],
  "slug": "url-friendly-slug-with-keywords",
  "social_title": "Social media title, max 70 chars — slightly more engaging than meta_title",
  "social_description": "Social media description, max 200 chars — emphasize the most interesting finding",
  "category_suggestion": "one of: aging-research, supplements, nutrition, exercise, biohacking, mental-health, genetics, longevity-tech, clinical-trials",
  "titles": [
    {"type": "informational", "text": "Clear, factual headline"},
    {"type": "curiosity", "text": "Headline that sparks curiosity without clickbait"},
    {"type": "benefit", "text": "Headline focused on the reader benefit"}
  ],
  "tags": ["tag1", "tag2", "tag3", "tag4", "tag5"],
  "schema_type": "Article" | "MedicalWebPage" | "ScholarlyArticle"
}

RULES:
- Target longevity/health search queries
- Keywords: 5-8, mix of head terms and long-tail phrases
- Include scientific terms that researchers search for (e.g. "rapamycin longevity", "NAD+ aging")
- Tags: 5-7 topical tags
- schema_type: use MedicalWebPage for health claims, ScholarlyArticle for research coverage
- Slug: lowercase, hyphens, include primary keyword
- Avoid medical claims in meta description that could trigger YMYL penalties — frame as "research suggests" not "proven to"`,
        userPromptTemplate: "Generate SEO metadata for this longevity article:\n\n{{step.2.text}}",
      },
    },

    // ── Step 4: MEDICAL FACT CHECK ──
    {
      stepIndex: 4,
      name: "Fact Check",
      type: "llm",
      config: {
        modelId: "gpt-5.2",
        webSearch: true,
        systemPrompt: `You are a medical fact-checker for a longevity publication. Health misinformation can cause real harm, so be thorough and conservative.

Analyze the article for:
1. Factual accuracy of all health/science claims
2. Proper representation of evidence quality
3. Appropriate caveats and disclaimers
4. Source fidelity (does the article accurately represent the original source?)

Return STRICT JSON only:
{
  "verified_claims": [
    { "claim": "claim from article", "status": "verified", "source": "verification source", "evidence_grade": "A" | "B" | "C" | "D" }
  ],
  "flagged_claims": [
    { "claim": "problematic claim", "issue": "why it's problematic", "severity": "warning" | "error", "suggestion": "how to fix" }
  ],
  "corrections": [
    { "original": "text in article", "corrected": "suggested correction", "reason": "why" }
  ],
  "evidence_assessment": {
    "overall_grade": "A" | "B" | "C" | "D" | "F",
    "grade_explanation": "one sentence explaining the grade",
    "strongest_evidence": "the best-supported claim",
    "weakest_evidence": "the least-supported claim"
  },
  "source_fidelity": "accurate" | "embellished" | "distorted" | "misleading",
  "health_safety": {
    "contains_dosage_claims": true | false,
    "contains_treatment_claims": true | false,
    "has_appropriate_disclaimers": true | false,
    "risk_assessment": "description of any health risks from following the article's advice"
  },
  "overall_verdict": "safe" | "needs_review" | "high_risk",
  "confidence_score": <0-100>,
  "summary": "2-3 sentence assessment"
}

Evidence grading:
- A: Multiple RCTs or meta-analyses in humans
- B: Single RCT or multiple large observational studies in humans
- C: Animal studies, small human studies, or preliminary evidence
- D: In vitro, theoretical, or anecdotal evidence only

confidence_score:
- 90-100: All claims verified with strong evidence, proper caveats present
- 70-89: Minor issues, some claims could use better qualification
- 50-69: Significant concerns, some claims overstate the evidence
- <50: Major problems, health misinformation risk`,
        userPromptTemplate: `Fact-check this longevity article. Be strict — health content demands high accuracy.

ARTICLE:
{{step.2.text}}

SOURCE ANALYSIS (original data):
{{step.0.json}}

SCIENTIFIC RESEARCH (supplementary evidence):
{{step.1.json}}`,
      },
    },

    // ── Step 5: DRUPAL OUTPUT ──
    {
      stepIndex: 5,
      name: "Drupal Output",
      type: "output_format",
      config: {
        formats: ["drupal_json"],
        description: "Compile final Drupal JSON payload with article, SEO, sources, and confidence score",
      },
    },

    // ── Step 6: DRUPAL PUBLISH ──
    {
      stepIndex: 6,
      name: "Drupal Publish",
      type: "drupal_publish",
      config: {
        mode: "draft",
        description: "Publish article to Drupal as draft for editorial review",
      },
    },
  ],
};

/** All available presets */
export const RECIPE_PRESETS: RecipePreset[] = [NOVINAR_PRESET, NOVINAR_AUTO_1_PRESET, URL_POVZETEK_PRESET, INTERVJU_CLANEK_PRESET, STORY_VIDEO_PRESET, LONGEVITY_URL_PRESET];

/** Get preset by key */
export function getPreset(key: string): RecipePreset | undefined {
  return RECIPE_PRESETS.find((p) => p.key === key);
}
