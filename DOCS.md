# MORANA — Internal AI Operations Terminal

**Version:** 2.2.0
**Stack:** Next.js 16 | React 19 | TypeScript | Prisma 7 | PostgreSQL (Neon) + pgvector | Tailwind CSS 4
**Hosting:** Vercel (serverless) | Cloudflare R2 (storage)
**UI Theme:** Dark hacker/terminal aesthetic
**URL:** morana.mojimediji.si

---

## Pregled

MORANA je interni AI operations terminal za medijsko podjetje. Združuje več AI storitev, pipeline orodja in knowledge management v enoten terminal-style vmesnik.

| Modul | Provider | Opis |
|-------|----------|------|
| **LLM** | Anthropic Claude, OpenAI GPT-4o, Google Gemini | Multi-turn chat z URL fetching, RAG, prompt templates |
| **STT** | Soniox | Transkripcija zvoka (SL, EN) |
| **TTS** | ElevenLabs | Sinteza govora z izbiro glasov |
| **Image** | Google Gemini 2.5 Flash | Generiranje in urejanje slik |
| **Recipes** | Multi-provider | Multi-step AI pipeline builder z audio podporo |
| **Jobs** | — | Background job dashboard z monitoring |

### Ključne zmožnosti

- Google OAuth avtentikacija z email whitelistom
- JWT session strategija (kompatibilna z Edge middleware)
- Auth middleware z bot blocking za zaščito vseh route-ov
- Auth logging vseh prijav in poskusov prijave (IP, geo, user-agent)
- CSRF zaščita na vseh state-changing endpointih
- SSRF zaščita z DNS resolucijo in IP blocklisto
- Security headerji na vseh response-ih (HSTS, CSP, X-Frame-Options, nosniff)
- robots.txt ki blokira vse crawlerje in AI bote
- **Workspace multi-tenancy** — več workspaceov z ločenimi podatki in member roles
- Admin panel za upravljanje uporabnikov, templateov, knowledge base, receptov, workspaceov in logov
- Prompt template sistem z versioniranjem (admin-managed system prompts)
- RAG knowledge base s pgvector embeddingi (PDF/TXT upload)
- Avtomatsko URL fetching iz uporabniških sporočil (Mozilla Readability)
- Cost preview pred vsako AI operacijo
- **Multi-step AI recepti z audio input podporo** (file upload, URL, transcript paste)
- **Recipe preset sistem** — preddefinirani pipelini (NOVINAR) z one-click instantiation
- **Async recipe execution** — Inngest background processing, non-blocking API
- **Recipe versioning** — avtomatske verzije ob spremembi korakov
- **Aggregated cost tracking** — totalCostCents + costBreakdownJson per execution
- **Audit trail** — SHA256 hashi inputov/outputov, provider response ID-ji
- **DB-driven AI model config** — admin upravljanje modelov, pricinga, enable/disable
- **Admin analytics dashboard** — error rates, latency, cost breakdown po modelu/providerju
- Background job dashboard z cancel/retry, cost display
- Per-user rate limiting (dnevni runi, mesečni stroški v centih)
- Globalni mesečni stroškovni cap (GLOBAL_MAX_MONTHLY_COST_CENTS)
- Workspace-level stroškovni cap in model omejitve
- Beleženje porabe in stroškov po modelu (integer centi, brez float zaokroževanja)
- MIME magic-bytes validacija za file uploade
- Error message sanitizacija (brez internih leakov)
- **Responsive nav z admin dropdownom, user dropdownom in overflow sistemom**
- Cloudflare R2 storage za datoteke, TTS audio in recipe audio uploade
- Inngest async task queue za dolgotrajne procese (zahteva signing key)
- Vercel deployment z maxDuration za dolgotrajne API route
- **MORANA branded favicon** (zeleni terminal square)

---

## Arhitektura

```
src/
  app/                    # Next.js App Router
    api/                  # API route handlers
      auth/[...nextauth]  # NextAuth endpoint
      admin/
        users/            # Admin CRUD za uporabnike
        templates/        # Admin CRUD za prompt template
        knowledge/        # Admin CRUD za knowledge base + document upload
        models/           # Admin AI model CRUD (DB-driven config)
        analytics/        # Admin analytics aggregation endpoint
        recipes/[id]/versions/ # Recipe version history
        auth-logs/        # Admin auth log viewer
      conversations/      # LLM multi-turn chat API
      history/            # Zgodovina runov
      jobs/               # Background job dashboard API
      knowledge/          # Public KB endpoint
      models/             # Seznam odobrenih modelov + pricing
      recipes/            # Recipe CRUD, execution, steps, presets API
      runs/               # STT, TTS, LLM, Image run endpoints
      templates/          # Public template endpoint
      usage/              # Statistika porabe
      voices/             # ElevenLabs glasovi
      workspaces/         # Workspace list + switch API
      inngest/            # Inngest webhook handler (zahteva INNGEST_SIGNING_KEY)
    components/           # React komponente (Nav, CostPreview, SessionProvider)
    admin/
      page.tsx            # Admin dashboard
      templates/          # Prompt template management
      knowledge/          # Knowledge base management
      recipes/            # Recipe builder z step config paneli
      models/             # AI model management (enable/disable, pricing)
      analytics/          # Analytics dashboard (error rates, costs, latency)
      auth-logs/          # Auth log viewer
      workspaces/         # Workspace management
    llm/                  # LLM chat stran
    stt/                  # STT stran
    tts/                  # TTS stran
    image/                # Image generiranje stran
    recipes/              # User recipe list + execution detail
    jobs/                 # Background job dashboard
    history/              # Zgodovina stran
    usage/                # Poraba stran
    globals.css           # Globalni stili + responsive CSS
    layout.tsx            # Root layout
    favicon.ico           # MORANA favicon (multi-size ICO)
    icon.png              # 32x32 PNG favicon
    apple-icon.png        # 180x180 Apple touch icon
  lib/                    # Backend logika
    providers/
      llm.ts              # Anthropic + OpenAI + Gemini LLM
      stt.ts              # Soniox STT
      tts.ts              # ElevenLabs TTS
      image.ts            # Gemini Image generiranje
      embeddings.ts       # OpenAI text-embedding-3-small za RAG
    auth.ts               # NextAuth konfiguracija (JWT + auth logging)
    config.ts             # Guardrails, modeli, pricing (DB-driven z ENV fallback)
    cost-preview.ts       # Client-side cost estimation utilities
    csrf.ts               # CSRF Origin/Referer validacija
    document-processor.ts # PDF/TXT/HTML text extraction za RAG
    mime-validate.ts      # Magic-bytes MIME validacija
    prisma.ts             # Prisma client singleton + pg.Pool
    rag.ts                # RAG: chunking, embedding search, context building
    rate-limit.ts         # Per-user rate limiting
    recipe-engine.ts      # Sequential recipe step execution engine (STT + LLM + output + audit hashes + cost aggregation)
    recipe-presets.ts     # Preddefinirani recipe preseti (NOVINAR)
    session.ts            # Session utilities (withAuth wrapper + CSRF)
    storage.ts            # Cloudflare R2 S3 storage (upload + download)
    url-fetcher.ts        # URL detection + Readability content extraction
    url-validate.ts       # SSRF zaščita (DNS resolucija, IP blocklist)
    usage.ts              # Usage event logging
    workspace.ts          # Workspace utilities (getActiveWorkspaceId)
    inngest/              # Async job definitions
  middleware.ts           # Auth + bot blocking + security headers
  generated/prisma/       # Auto-generated Prisma client
  types/                  # TypeScript deklaracije
prisma/
  schema.prisma           # Database schema
  migrations/             # SQL migracije
```

---

## Varnost

### Auth middleware (`src/middleware.ts`)

Middleware teče na Edge runtime pred vsakim requestom:

1. **Bot blocking:** Preverja user-agent proti 30+ patternov (crawlerji, AI boti, scraperji, CLI orodja)
2. **Security headerji:** Doda na vsak response (glej tabelo spodaj)
3. **Auth check:** Preusmeri neprijavljene na `/` (307) ali vrne 401 za API
4. Uporablja `getToken()` iz `next-auth/jwt` za JWT verifikacijo
5. Podpira secure cookie name (`__Secure-` prefix) za HTTPS

**Blokirani bot patterni:** `bot`, `crawl`, `spider`, `gptbot`, `chatgpt`, `google-extended`, `ccbot`, `anthropic`, `bytespider`, `perplexitybot`, `facebookbot`, `amazonbot`, `semrushbot`, `ahrefsbot`, `python-requests`, `curl`, `wget`, `scrapy` in še 15+ drugih.

**Javne poti** (brez avtentikacije):
- `/` — Home / login stran
- `/api/auth/*` — NextAuth endpointi
- `/api/inngest` — Inngest webhook (ima lastno signing key avtentikacijo)
- `/_next/*` — Next.js statični asseti
- `/favicon.ico`, `/icon.png`, `/apple-icon.png`, `/robots.txt`

### Auth logging (`src/lib/auth.ts`)

Vsak poskus prijave se logira v `AuthLog` tabelo:
- **Event tipi:** `sign_in_ok`, `sign_in_denied_inactive`, `sign_in_denied_unknown`, `sign_in_denied_no_email`, `sign_in_bootstrap`
- **Podatki:** email, IP (x-forwarded-for), user-agent, država/mesto (Vercel geo headerji), razlog zavrnitve
- Admin pregled na `/admin/auth-logs` s filtriranjem, statistikami (denied 24h/7d, unique IPs) in expandable detajli
- Logging je fire-and-forget — nikoli ne prekine avtentikacije

### robots.txt (`public/robots.txt`)

Disallow `/` za vse user-agente. Eksplicitno blokira 15+ AI/LLM crawlerjev: GPTBot, ChatGPT-User, Google-Extended, CCBot, anthropic-ai, Claude-Web, Bytespider, cohere-ai, PerplexityBot, FacebookBot, Amazonbot, Applebot-Extended, meta-externalagent.

### Security headerji (middleware)

| Header | Vrednost |
|--------|----------|
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` |
| `Content-Security-Policy` | `default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; connect-src 'self' https://accounts.google.com; frame-src https://accounts.google.com; ...` |
| `X-Frame-Options` | `DENY` |
| `X-Content-Type-Options` | `nosniff` |
| `X-XSS-Protection` | `1; mode=block` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `camera=(), microphone=(self), geolocation=(), interest-cohort=()` |
| `X-Powered-By` | (removed) |

### CSRF zaščita (`src/lib/csrf.ts`)

Vsi state-changing endpointi (POST, PATCH, DELETE) zahtevajo veljavno `Origin` ali `Referer` header. Validacija poteka v `withAuth()` wrapperju.

### SSRF zaščita (`src/lib/url-validate.ts`)

URL fetch (npr. STT iz URL-ja) je zaščiten z:
- Samo HTTPS protokol
- DNS resolucija pred fetchem
- Blokada privatnih IP-jev (RFC1918, loopback, link-local, metadata 169.254.x)
- Blokada credentialov v URL-ju
- `redirect: "error"` na fetch requestih

### MIME validacija (`src/lib/mime-validate.ts`)

File uploadi so validirani z magic-bytes (ne zaupamo MIME tipu iz brskalnika). Podprti formati: MP3, WAV, OGG, FLAC, M4A, AAC, WebM, PNG, JPEG, WebP, GIF, PDF.

### Error sanitizacija

Vsi API route catch blocki:
- Logirajo podroben error interno (`console.error`)
- Vračajo generično sporočilo uporabniku (`"Internal server error"`)
- Brez stack trace ali internih detajlov v HTTP response

---

## Database schema

### Enumi

| Enum | Vrednosti |
|------|-----------|
| `Role` | `user`, `admin` |
| `RunType` | `stt`, `llm`, `tts`, `image` |
| `RunStatus` | `queued`, `running`, `done`, `error` |
| `FileKind` | `input`, `output` |
| `DocumentStatus` | `pending`, `processing`, `ready`, `error` |
| `RecipeStatus` | `draft`, `active`, `archived` |
| `ExecutionStatus` | `pending`, `running`, `done`, `error`, `cancelled` |
| `WorkspaceRole` | `member`, `admin` |

### Modeli

#### Workspace
Workspace za multi-tenant izolacijo podatkov.

| Polje | Tip | Opis |
|-------|-----|------|
| `id` | String (cuid) | Primarni ključ |
| `name` | String | Ime workspacea |
| `slug` | String (unique) | URL-friendly identifikator |
| `isActive` | Boolean | Ali je workspace aktiven |
| `maxMonthlyCostCents` | Int? | Workspace mesečni stroškovni cap (v centih) |
| `allowedModels` | Json? | JSON array model ID-jev (null = vsi) |

Relacije: `members`, `conversations`, `promptTemplates`, `knowledgeBases`, `recipes`, `runs`, `usageEvents`

#### WorkspaceMember
Članstvo uporabnika v workspaceu.

| Polje | Tip | Opis |
|-------|-----|------|
| `workspaceId` | String | FK na Workspace |
| `userId` | String | FK na User |
| `role` | WorkspaceRole | `member` ali `admin` |

Unique constraint: `[workspaceId, userId]`

#### User
Uporabniški profil z role-based access control in per-user limiti.

| Polje | Tip | Opis |
|-------|-----|------|
| `id` | String (cuid) | Primarni ključ |
| `email` | String (unique) | Email za Google Auth |
| `name` | String? | Ime uporabnika |
| `role` | Role | `user` ali `admin` |
| `active` | Boolean | Aktiviran/deaktiviran |
| `maxRunsPerDay` | Int? | Per-user dnevni limit (null = globalni default) |
| `maxMonthlyCostCents` | Int? | Mesečni limit stroškov v **centih** (integer) |
| `allowedModels` | Json? | JSON array model ID stringov (null = vsi modeli) |
| `activeWorkspaceId` | String? | Trenutno aktivni workspace |
| `lastLoginAt` | DateTime | Zadnja prijava (posodobljeno max 1x/uro) |

Relacije: `runs`, `files`, `usageEvents`, `accounts`, `sessions`, `conversations`, `promptTemplates`, `knowledgeBases`, `recipes`, `recipeExecutions`, `workspaceMemberships`, `templateVersions`

#### Conversation
Multi-turn LLM pogovori.

| Polje | Tip | Opis |
|-------|-----|------|
| `id` | String (cuid) | Primarni ključ |
| `userId` | String | FK na User |
| `workspaceId` | String? | FK na Workspace |
| `title` | String | Naslov pogovora |
| `modelId` | String | ID izbranega modela |
| `templateId` | String? | FK na PromptTemplate |
| `knowledgeBaseIds` | Json? | JSON array KB ID-jev za RAG |

Relacije: `user`, `messages`, `workspace`

#### Message
Sporočila znotraj pogovora.

| Polje | Tip | Opis |
|-------|-----|------|
| `role` | String | `user` ali `assistant` |
| `content` | Text | Vsebina sporočila |
| `inputTokens` | Int? | Vhodni tokeni |
| `outputTokens` | Int? | Izhodni tokeni |
| `latencyMs` | Int? | Latenca odgovora |
| `runId` | String? | FK na Run |

#### PromptTemplate
Admin-managed prompt predloge za LLM chat z versioniranjem.

| Polje | Tip | Opis |
|-------|-----|------|
| `name` | String | Ime template |
| `slug` | String (unique) | URL-friendly identifikator |
| `systemPrompt` | Text | System prompt za LLM |
| `userPromptTemplate` | Text? | Opcijski user prompt template |
| `category` | String | Kategorija (default: "general") |
| `knowledgeText` | Text? | Statično referenčno besedilo |
| `isActive` | Boolean | Ali je template aktiven |
| `sortOrder` | Int | Vrstni red prikaza |
| `workspaceId` | String? | FK na Workspace |
| `createdBy` | String | FK na User (admin) |

Relacije: `creator`, `versions`, `workspace`

#### PromptTemplateVersion
Verzije prompt templateov (audit trail).

| Polje | Tip | Opis |
|-------|-----|------|
| `templateId` | String | FK na PromptTemplate |
| `version` | Int | Verzija (auto-increment per template) |
| `systemPrompt` | Text | System prompt v tej verziji |
| `userPromptTemplate` | Text? | User prompt template v tej verziji |
| `knowledgeText` | Text? | Knowledge text v tej verziji |
| `changedBy` | String | FK na User (admin ki je spremenil) |
| `changeNote` | String? | Opis spremembe |

#### KnowledgeBase
RAG knowledge base za kontekstualizacijo LLM odgovorov.

| Polje | Tip | Opis |
|-------|-----|------|
| `name` | String | Ime KB |
| `description` | Text? | Opis |
| `isActive` | Boolean | Ali je KB aktivna |
| `workspaceId` | String? | FK na Workspace |
| `createdBy` | String | FK na User (admin) |

Relacije: `creator`, `documents`, `workspace`

#### Document
Dokumenti znotraj knowledge base.

| Polje | Tip | Opis |
|-------|-----|------|
| `knowledgeBaseId` | String | FK na KnowledgeBase |
| `fileName` | String | Ime datoteke |
| `mimeType` | String | MIME tip |
| `sizeBytes` | Int | Velikost |
| `status` | DocumentStatus | `pending`, `processing`, `ready`, `error` |
| `chunkCount` | Int | Število chunkov |

Relacije: `knowledgeBase`, `chunks`

#### DocumentChunk
Chunki dokumentov z vektorskimi embeddingi.

| Polje | Tip | Opis |
|-------|-----|------|
| `documentId` | String | FK na Document |
| `content` | Text | Vsebina chunka |
| `chunkIndex` | Int | Indeks chunka |
| `embedding` | vector(1536) | pgvector embedding (via raw SQL) |

#### Recipe
Multi-step AI pipeline definicije z input konfiguracijami in versioniranjem.

| Polje | Tip | Opis |
|-------|-----|------|
| `name` | String | Ime recepta |
| `slug` | String (unique) | URL-friendly identifikator |
| `status` | RecipeStatus | `draft`, `active`, `archived` |
| `currentVersion` | Int | Trenutna verzija (auto-increment ob spremembi korakov) |
| `isPreset` | Boolean | Ali je recept iz preseta (read-only identifikator) |
| `presetKey` | String? (unique) | Unikaten preset ključ (npr. "novinar") |
| `inputKind` | String | Tip vhoda: `text`, `audio`, `image`, `none` |
| `inputModes` | Json? | Dovoljeni input načini: `["file", "url", "text"]` |
| `defaultLang` | String? | Privzeti jezik (npr. `sl`, `en`) |
| `uiHints` | Json? | UI namigi za frontend (npr. acceptAudio, maxFileSizeMB) |
| `workspaceId` | String? | FK na Workspace |
| `createdBy` | String | FK na User (admin) |

Relacije: `creator`, `steps`, `executions`, `versions`, `workspace`

#### RecipeVersion
Verzije receptov (audit trail). Avtomatsko ustvarjene ob spremembi korakov.

| Polje | Tip | Opis |
|-------|-----|------|
| `recipeId` | String | FK na Recipe |
| `versionNumber` | Int | Verzija (unique per recipe) |
| `stepsSnapshot` | Json | Posnetek korakov v tej verziji |
| `name` | String | Ime recepta v tej verziji |
| `description` | String? | Opis recepta v tej verziji |
| `changedBy` | String | FK na User (admin ki je spremenil) |
| `changeNote` | String? | Opis spremembe |

Unique constraint: `[recipeId, versionNumber]`

#### RecipeStep
Posamezni koraki recepta.

| Polje | Tip | Opis |
|-------|-----|------|
| `recipeId` | String | FK na Recipe |
| `stepIndex` | Int | Vrstni red koraka |
| `name` | String | Ime koraka |
| `type` | String | `stt`, `llm`, `tts`, `image`, `output_format` |
| `config` | Json | Step-specific konfiguracija (glej spodaj) |

**Config po tipu:**
- **`stt`:** `{ provider, language, description }`
- **`llm`:** `{ modelId, systemPrompt, userPromptTemplate, templateId?, knowledgeBaseIds? }`
- **`tts`:** `{ voiceId }`
- **`image`:** `{ promptTemplate }`
- **`output_format`:** `{ formats: ["markdown", "html", "json", "drupal_json"] }`

#### RecipeExecution
Izvedbe receptov z agregiranim stroškom in verzijo.

| Polje | Tip | Opis |
|-------|-----|------|
| `recipeId` | String | FK na Recipe |
| `userId` | String | FK na User |
| `status` | ExecutionStatus | `pending`, `running`, `done`, `error`, `cancelled` |
| `progress` | Int | Napredek v % |
| `currentStep` | Int | Trenutni korak |
| `totalSteps` | Int | Skupno korakov |
| `recipeVersion` | Int? | Verzija recepta ob izvedbi |
| `totalCostCents` | Int | Skupni strošek v centih (0 = ni podatka) |
| `costBreakdownJson` | Json? | Per-step cost breakdown: `{ steps: [{ stepIndex, model, costCents }] }` |
| `inputData` | Json? | Vhodni podatki (text, transcriptText, audioStorageKey, audioUrl, language) |

Relacije: `recipe`, `user`, `stepResults`

#### RecipeStepResult
Rezultati posameznih korakov izvedbe z audit trail hashi.

| Polje | Tip | Opis |
|-------|-----|------|
| `executionId` | String | FK na RecipeExecution |
| `stepIndex` | Int | Indeks koraka |
| `runId` | String? | FK na Run |
| `status` | String | `pending`, `running`, `done`, `error` |
| `inputPreview` | Text? | Predogled vhoda |
| `outputPreview` | Text? | Predogled izhoda |
| `outputFull` | Json? | Polni izhod |
| `inputHash` | String? | SHA256 hash vhodnega besedila (audit trail) |
| `outputHash` | String? | SHA256 hash izhodnega besedila (audit trail) |
| `providerResponseId` | String? | Provider-ov ID odgovora (Anthropic/OpenAI) |

#### AIModel
DB-driven AI model konfiguracija (admin-managed).

| Polje | Tip | Opis |
|-------|-----|------|
| `modelId` | String (unique) | ID modela (npr. "claude-sonnet-4-5-20250929") |
| `label` | String | Prikazno ime |
| `provider` | String | Provider: `anthropic`, `openai`, `gemini` |
| `isEnabled` | Boolean | Ali je model aktiven |
| `isDefault` | Boolean | Ali je privzeti model |
| `sortOrder` | Int | Vrstni red prikaza |
| `pricingInput` | Float | Cena vnosa (po enoti) |
| `pricingOutput` | Float | Cena izhoda (po enoti) |
| `pricingUnit` | String | Enota: `1M_tokens`, `1k_chars`, `per_minute` |

Indeks: `[isEnabled, sortOrder]`

#### AuthLog
Logiranje vseh poskusov avtentikacije.

| Polje | Tip | Opis |
|-------|-----|------|
| `email` | String | Email naslov |
| `event` | String | Tip dogodka (sign_in_ok, denied_*, bootstrap) |
| `provider` | String | OAuth provider (default: google) |
| `ip` | String? | IP naslov (x-forwarded-for) |
| `userAgent` | Text? | User-Agent string |
| `country` | String? | Država (Vercel geo header) |
| `city` | String? | Mesto (Vercel geo header) |
| `reason` | String? | Razlog zavrnitve |

Indeksi: `email`, `createdAt`, `event`

#### Run, RunInput, RunOutput, UsageEvent, File
(Nespremenjeno od v1 — glej posamezne modele v Prisma schema)

---

## API Endpoints

### Avtentikacija

| Endpoint | Metoda | Opis |
|----------|--------|------|
| `/api/auth/[...nextauth]` | * | NextAuth Google OAuth handler |

### Workspaces

| Endpoint | Metoda | Opis |
|----------|--------|------|
| `/api/workspaces` | GET | Seznam workspaceov uporabnika + activeWorkspaceId |
| `/api/workspaces` | POST | Preklopi aktivni workspace (body: `{ workspaceId }`) |
| `/api/admin/workspaces` | GET | Vsi workspacei s člani (admin) |
| `/api/admin/workspaces` | POST | Ustvari workspace (admin) |
| `/api/admin/workspaces/[id]` | PATCH | Posodobi workspace (admin) |
| `/api/admin/workspaces/[id]/members` | POST | Dodaj/odstrani člana (admin) |

### LLM Chat

| Endpoint | Metoda | CSRF | Opis |
|----------|--------|------|------|
| `/api/conversations` | GET | — | Seznam pogovorov uporabnika (workspace-scoped) |
| `/api/conversations` | POST | ✅ | Ustvari nov pogovor (z modelId, templateId, knowledgeBaseIds) |
| `/api/conversations/[id]` | GET | — | Podrobnosti pogovora z sporočili |
| `/api/conversations/[id]` | PATCH | ✅ | Posodobi model, template, knowledgeBaseIds |
| `/api/conversations/[id]` | DELETE | ✅ | Izbriši pogovor |
| `/api/conversations/[id]/messages` | POST | ✅ | Pošlji sporočilo, prejmi AI odgovor (maxDuration: 60s). Avtomatsko: template system prompt, RAG retrieval, URL fetching |

### Run Endpoints

| Endpoint | Metoda | CSRF | maxDuration | Opis |
|----------|--------|------|-------------|------|
| `/api/runs/llm` | POST | ✅ | 60s | Single-shot LLM obdelava |
| `/api/runs/stt` | POST | ✅ | 300s | Speech-to-text (file/URL) — zahteva Vercel Pro |
| `/api/runs/tts` | POST | ✅ | 60s | Text-to-speech (audio upload v R2) |
| `/api/runs/image` | POST | ✅ | 60s | Generiranje/urejanje slike |
| `/api/runs/[id]` | GET | — | — | Podrobnosti runa z input/output |

### Prompt Templates

| Endpoint | Metoda | Opis |
|----------|--------|------|
| `/api/templates` | GET | Seznam aktivnih templateov (public, workspace-scoped) |
| `/api/admin/templates` | GET | Vsi templati (admin) |
| `/api/admin/templates` | POST | Ustvari template (admin) |
| `/api/admin/templates/[id]` | GET, PATCH, DELETE | CRUD za posamezen template (admin). PATCH avtomatsko ustvari verzijo. |

### Knowledge Base (RAG)

| Endpoint | Metoda | Opis |
|----------|--------|------|
| `/api/knowledge` | GET | Seznam aktivnih KB (public, workspace-scoped) |
| `/api/admin/knowledge` | GET, POST | Seznam / ustvari KB (admin) |
| `/api/admin/knowledge/[id]` | GET, PATCH, DELETE | CRUD za KB (admin) |
| `/api/admin/knowledge/[id]/documents` | GET, POST | Seznam / upload dokument (admin, maxDuration: 120s) |
| `/api/admin/knowledge/[id]/documents/[docId]` | DELETE | Izbriši dokument (admin) |

### Recipes (AI Pipelines)

| Endpoint | Metoda | Opis |
|----------|--------|------|
| `/api/recipes` | GET | Seznam receptov (active za userje, vsi za admin; workspace-scoped) |
| `/api/recipes` | POST | Ustvari recept z inputKind, inputModes, defaultLang, uiHints (admin) |
| `/api/recipes/[id]` | GET, PATCH, DELETE | CRUD za recept (admin) |
| `/api/recipes/[id]/steps` | PUT | Zamenjaj vse korake recepta (admin) |
| `/api/recipes/[id]/execute` | POST | Zaženi izvedbo (maxDuration: 30s). Podpira JSON in multipart/form-data za audio upload. **Execution je asinhrona** — endpoint shrani inpute, pošlje Inngest event in takoj vrne `{ execution: { id, status: "pending" } }`. Frontend nato polira za napredek. |
| `/api/recipes/presets` | GET | Seznam dostopnih presetov (admin) |
| `/api/recipes/presets` | POST | Instantiiraj preset kot recept (admin, body: `{ presetKey }`) |
| `/api/recipes/executions` | GET | Seznam uporabnikovih izvedb |
| `/api/recipes/executions/[id]` | GET | Podrobnosti izvedbe |
| `/api/recipes/executions/[id]` | POST | Cancel izvedbo |

### Jobs (Background Job Dashboard)

| Endpoint | Metoda | Opis |
|----------|--------|------|
| `/api/jobs` | GET | Seznam vseh jobov (admin vidi vse, user svoje) |
| `/api/jobs/[id]` | GET | Podrobnosti joba |
| `/api/jobs/[id]` | POST | Cancel ali retry (body: `{ action: "cancel" | "retry" }`) |

### Zgodovina in poraba

| Endpoint | Metoda | Opis |
|----------|--------|------|
| `/api/history` | GET | Paginirana zgodovina runov, filter po tipu |
| `/api/usage` | GET | Statistika porabe po datumu in modelu |

### Reference

| Endpoint | Metoda | Opis |
|----------|--------|------|
| `/api/models` | GET | Seznam odobrenih LLM modelov + pricing mapa |
| `/api/voices` | GET | Seznam ElevenLabs glasov |

### Admin

| Endpoint | Metoda | CSRF | Opis |
|----------|--------|------|------|
| `/api/admin/users` | GET | — | Seznam vseh uporabnikov s statistiko |
| `/api/admin/users` | POST | ✅ | Dodaj novega uporabnika (whitelist email) |
| `/api/admin/users/[id]` | GET | — | Podrobnosti uporabnika |
| `/api/admin/users/[id]` | PATCH | ✅ | Posodobi role, limite, active status |
| `/api/admin/users/[id]` | DELETE | ✅ | Deaktiviraj uporabnika (soft delete) |
| `/api/admin/models` | GET | — | Seznam vseh AI modelov (admin) |
| `/api/admin/models` | POST | ✅ | Dodaj nov AI model (admin) |
| `/api/admin/models/[id]` | PATCH | ✅ | Posodobi model (enable/disable, pricing, default) |
| `/api/admin/models/[id]` | DELETE | ✅ | Izbriši model (admin) |
| `/api/admin/analytics` | GET | — | Agregirane metrike za dashboard (admin, ?period=7d\|30d\|90d) |
| `/api/admin/recipes/[id]/versions` | GET | — | Seznam verzij recepta (admin) |
| `/api/admin/auth-logs` | GET | — | Auth logi s filtriranjem in statistikami |

---

## AI Providerji

### LLM — Anthropic Claude + OpenAI GPT-4o + Google Gemini

**Datoteka:** `src/lib/providers/llm.ts`

Podpira dva načina:
- **Single-shot** (`runLLM`): Pošlji prompt + opcijsko izvorno besedilo
- **Multi-turn chat** (`runLLMChat`): Pošlji celoten history sporočil + opcijski system prompt

**Modeli:**
| Model | Provider | Input cena | Output cena |
|-------|----------|-----------|-------------|
| `claude-sonnet-4-5-20250929` | Anthropic | $3.00/1M tok | $15.00/1M tok |
| `gpt-4o` | OpenAI | $2.50/1M tok | $10.00/1M tok |
| `gpt-4o-mini` | OpenAI | $0.15/1M tok | $0.60/1M tok |
| `gemini-2.0-flash` | Gemini | $0.10/1M tok | $0.40/1M tok |

OpenAI modeli so na voljo samo če je `OPENAI_API_KEY` nastavljen.
Gemini je na voljo samo če je `GEMINI_API_KEY` nastavljen.

**System prompt:** Vsak provider uporablja nativno system prompt podporo:
- Anthropic: `system` parameter
- OpenAI: `role: "system"` message
- Gemini: `systemInstruction` parameter

### STT — Soniox

**Datoteka:** `src/lib/providers/stt.ts`

Async transkripcija prek Soniox REST API:
1. Upload audio datoteke
2. Ustvari transkripcijo
3. Polling do zaključka (max 3 min)
4. Preberi transkript
5. Cleanup uploada
6. Na timeout: cancela job in pobriše upload

**Model:** `stt-async-v4` | **Jeziki:** SL, EN | **Cena:** $0.35/min

### TTS — ElevenLabs

**Datoteka:** `src/lib/providers/tts.ts`

**Model:** `eleven_v3` | **Output:** MP3 → R2 signed URL | **Limit:** 10,000 znakov | **Cena:** $0.30/1k znakov

### Image — Gemini 2.5 Flash Image

**Datoteka:** `src/lib/providers/image.ts`

**Model:** `gemini-2.5-flash-image` | **Output:** Base64 → R2 | **Cena:** ~$0.039/slika

### Embeddings — OpenAI

**Datoteka:** `src/lib/providers/embeddings.ts`

Za RAG knowledge base. Uporablja `text-embedding-3-small` (1536 dimenzij).
- `generateEmbedding(text)` — posamezen embedding
- `generateEmbeddings(texts)` — batch embeddingi

---

## Prompt Template System

**Admin:** `/admin/templates` — CRUD za prompt template z versioniranjem

Template vsebuje:
- **System prompt** — nativno poslan LLM-u (ne kot user message)
- **Knowledge text** — statično referenčno besedilo (vstavljen za system prompt)
- **User prompt template** — opcijski template za formatiranje user sporočil
- **Kategorija** — za organizacijo (general, creative, technical...)

Uporabnik izbere template v LLM chat headerju. Template se shrani na conversacijo (`templateId`). System prompt se vsakič naloži iz DB in inject-a v LLM klic.

**Versioniranje:** Ob vsaki spremembi (PATCH) se avtomatsko ustvari `PromptTemplateVersion` z verzijo, starimi vrednostmi in `changedBy`. Admin lahko pregleduje zgodovino sprememb.

---

## RAG Knowledge Base

### Arhitektura

```
Admin upload PDF/TXT → extract text → chunk (500 chars, 50 overlap)
→ OpenAI embedding (text-embedding-3-small, 1536d) → pgvector store

User message → embed query → cosine similarity search (top 5)
→ inject matching chunks as system prompt context → LLM response
```

### Komponente

| Datoteka | Opis |
|----------|------|
| `src/lib/providers/embeddings.ts` | OpenAI embedding API |
| `src/lib/document-processor.ts` | PDF (pdf-parse), TXT, HTML text extraction |
| `src/lib/rag.ts` | Chunking, pgvector search, context building |

### pgvector

- Razširitev: `CREATE EXTENSION vector`
- Kolona: `DocumentChunk.embedding vector(1536)`
- Indeks: IVFFlat z cosine distance (`vector_cosine_ops`, lists=100)
- Similarity search: `1 - (embedding <=> query::vector) as score`

**Admin:** `/admin/knowledge` — Ustvari KB, uploadi dokumente (PDF/TXT), pregled chunkov.
**User:** Izbere KB v LLM chat headerju. Relevantni chunki se avtomatsko vstavijo v prompt.

---

## URL Fetching

**Datoteka:** `src/lib/url-fetcher.ts`

Ko uporabnik pošlje sporočilo z URL-ji v LLM chatu:

1. **Regex detekcija** URL-jev v sporočilu (max 3)
2. **Fetch** vsakega URL-ja paralelno (8s timeout)
3. **Meta extraction** — title, og:description, JSON-LD structured data
4. **Mozilla Readability** (linkedom) — isti algoritem kot Firefox Reader View za ekstrakcijo article vsebine
5. **Fallback** — regex-based extraction če Readability faila
6. **Injection** — vsebina se vstavi v system prompt z navodilom "Use ONLY the information provided"

**Omejitve:** 3 URL-ji/sporočilo, 12k znakov/URL, 30k skupaj, 8s timeout/URL.

**Odvisnosti:** `@mozilla/readability`, `linkedom`

---

## Cost Preview

**Datoteke:** `src/lib/cost-preview.ts`, `src/app/components/CostPreview.tsx`

Real-time ocena stroškov pred izvedbo operacije:

| Modul | Metoda ocene |
|-------|--------------|
| LLM | ~3.5 chars/token, input+output estimate na podlagi pricing mape |
| STT | File size → trajanje (~1MB/min) → cena/min |
| TTS | Število znakov → cena/1k znakov |
| Image | Flat estimate na sliko |

`/api/models` endpoint vrne `pricing` mapo poleg seznama modelov.

---

## Workspace Multi-Tenancy

### Koncept

Workspace omogoča izolacijo podatkov med različnimi ekipami ali projekti. Vsak uporabnik je lahko član več workspaceov.

### Struktura

- **Workspace** — entiteta z imenom, slugom in opcijskimi limiti (mesečni cost cap, allowed models)
- **WorkspaceMember** — many-to-many med User in Workspace z role (`member` ali `admin`)
- **Active workspace** — User ima `activeWorkspaceId` ki se shrani v DB in cookie; preklop z workspace switcherjem v nav baru

### Scoping

Workspace-scoped entitete (imajo `workspaceId`): Conversation, PromptTemplate, KnowledgeBase, Recipe, Run, UsageEvent

### Admin UI (`/admin/workspaces`)

- Ustvari/uredi workspace
- Dodaj/odstrani člane
- Nastavi workspace-level limite

### Workspace switcher (Nav)

Desktop: orange "Default ▼" dropdown pred user dropdownom (prikazan samo ko > 1 workspace).
Mobile: workspace buttons v account sekciji hamburger menija.

---

## AI Recipes (Pipeline Builder)

### Koncept

Recipe je multi-step AI pipeline. Admin definira korake (npr. STT → LLM članek → LLM SEO → Drupal output), uporabnik zažene z vhodnimi podatki. Koraki se izvajajo sekvenčno, output enega koraka je input naslednjega.

### Input konfiguracija

Vsak recept ima `inputKind` ki določa tip vhoda in `inputModes` ki definira dovoljene načine vnosa:

| inputKind | inputModes | UI |
|-----------|------------|-----|
| `text` | `["text"]` | Textarea za paste besedila |
| `audio` | `["file", "url", "text"]` | Tabs: Upload file / Audio URL / Paste transcript |
| `image` | `["file", "url"]` | Upload ali URL |
| `none` | `[]` | Brez vhoda (samo pipeline koraki) |

Za audio recepte (npr. NOVINAR):
- **File upload:** Audio se uploada na R2 (`recipes/{recipeId}/{uuid}/{filename}`), reference se shrani v `inputData.audioStorageKey`
- **Audio URL:** URL se shrani v `inputData.audioUrl`
- **Transcript paste:** Besedilo se shrani v `inputData.transcriptText` — STT korak se avtomatsko preskoči

### Recipe preseti (`src/lib/recipe-presets.ts`)

Preddefinirani pipeline templati za one-click creation:

**NOVINAR preset:**
```
Audio → Transkripcija (Soniox SL) → Članek (GPT-4o-mini) → SEO (GPT-4o-mini) → Drupal Output
```
- Input: audio file, URL, ali transcript
- Output: Drupal-ready JSON s člankom, SEO metapodatki, HTML body

Admin vidi presete na `/recipes` in jih lahko instantiira z enim klikom. Preset ustvari Recipe + RecipeSteps v bazi.

### Execution engine (`src/lib/recipe-engine.ts`)

```
executeRecipe(executionId):
  for each step:
    1. Check if execution was cancelled
    2. Create step result record (status: running)
    3. Update execution progress (step N/total, %)
    4. Execute step based on type:
       - stt: skip if transcript provided, else fetch audio from R2/URL → Soniox
       - llm: build prompt from config → runLLMChat → cost tracking
       - output_format: format text as markdown/html/json/drupal_json
       - tts/image: placeholder (not yet implemented in pipeline)
    5. Pipe output → next step input
    6. Compute SHA256 hashes of input/output (audit trail)
    7. Save step result (inputPreview, outputPreview, outputFull, inputHash, outputHash, providerResponseId)
    8. Aggregate step cost from UsageEvent → costBreakdown
  Write totalCostCents + costBreakdownJson to execution
  Mark execution as done/error
```

**STT skip logika:**
1. Če `inputData.transcriptText` obstaja → preskoči STT, uporabi transcript
2. Če previousOutput ima besedilo (text input mode) → preskoči STT
3. Sicer → naloži audio iz R2 ali URL → poženi Soniox STT

**Async execution (Inngest):** API endpoint (`/api/recipes/[id]/execute`) shrani inpute, ustvari RecipeExecution zapis in pošlje `recipe/execute` event na Inngest. Vrne takoj s HTTP 201 (`{ execution: { id, status: "pending" } }`). Inngest worker (`recipeExecutionJob`) nato asinhrono izvede recipe engine. Frontend polira za napredek vsake 2-3 sekunde.

**Idempotency:** Inngest job preveri `execution.status !== "pending"` in preskoči če je že v teku ali zaključen. Retry: 1 (recepti se ne smejo avtomatsko ponavljati — uporabnik lahko ročno ponovi).

**Cost tracking:** Vsak STT in LLM korak ustvari `Run` zapis. Po vsakem koraku se iz `UsageEvent` agregira strošek. Ob zaključku se skupni strošek zapiše v `RecipeExecution.totalCostCents` z per-step breakdownom v `costBreakdownJson`.

**Audit trail:** Vsak korak dobi SHA256 hash vhoda (`inputHash`) in izhoda (`outputHash`). Za LLM korake se shrani tudi `providerResponseId` (Anthropic `resp.id`, OpenAI `resp.id`).

**Output formati:**
- `markdown` — besedilo kot markdown
- `html` — pretvori markdown paragrafe v HTML
- `json` — JSON z vsebino in timestampom
- `drupal_json` — NOVINAR-specific format: extrahira SEO JSON, sestavi article HTML, združi v Drupal payload

### Admin UI (`/admin/recipes`)

Recipe builder s form-based step management:
- **Recipe info:** ime, opis, status, inputKind, defaultLang, inputModes
- **Steps:** add/remove/reorder z up/down puščicami
- **Step config paneli po tipu:**
  - LLM: modelId select, systemPrompt textarea, userPromptTemplate textarea
  - STT: provider, language
  - TTS: voiceId
  - Image: promptTemplate
  - Output format: format checkboxes
- **Badges:** PRESET, AUDIO, step type badges
- **Preset instantiation:** one-click creation iz presetov

### User UI (`/recipes`)

- Seznam aktivnih receptov z opisom in step pregledom
- Input mode tabs za audio recepte (Upload / URL / Transcript)
- Language selector (SL / EN)
- File upload z drag-and-click (prikaže ime in velikost)
- "QUEUED..." stanje po kliku na execute
- Execution history z auto-polling (3s)
- Cost prikaz per execution (v $)

### Execution Detail (`/recipes/[id]`)

Step-by-step timeline s statusom, trajanjem, inputom in outputom. Auto-polling za running izvedbe. Prikazuje:
- Verzija recepta (vN badge)
- Skupni strošek izvedbe (v $)
- Per-step audit trail (SHA256 hashi, provider response ID) v collapsed "Audit Trail" sekciji

---

## Background Job Dashboard

**Stran:** `/jobs`

Centraliziran pregled vseh recipe izvedb:

- **Filtriranje** po statusu: all, running, done, error, cancelled
- **Summary bar** s štetjem po statusu
- **Job list** z expandable detajli:
  - Job ID, user, started/finished, duration, cost
  - Progress bar za running jobe
  - Step timeline z per-step status in trajanjem
  - Error message prikaz
- **Actions:** View detail, Cancel (running), Retry (failed/cancelled)
- **Cost display** — totalCostCents per job v rumeni barvi
- **Auto-polling** — osveži vsake 3s ko so running jobi

**API:**
- `GET /api/jobs` — seznam (admin vidi vse)
- `GET /api/jobs/[id]` — detail s step results
- `POST /api/jobs/[id]` — cancel ali retry (`{ action: "cancel" | "retry" }`)

---

## Navigacija

### Desktop nav (>950px)

```
[MORANA] // >Recipes >LLM >STT >TTS >Image  [Jobs >History >Usage]    Admin▼  Default▼  Mitja▼
```

- **Primarni linki** (center): Recipes, LLM, STT, TTS, Image
- **Overflow linki** (v "More" dropdownu na narrow desktop): Jobs, History, Usage
- **Admin dropdown** (desno, rdeč): Recipes, Templates, Knowledge, Models, Analytics, Auth Logs, Workspaces, Dashboard — vidno samo za admin
- **Workspace switcher** (desno, oranžen): prikazan samo ko > 1 workspace
- **User dropdown** (desno, zelen): prikaže first name ali email local-part; vsebuje email in sign_out

### Narrow desktop (769-950px)

Jobs, History in Usage se skrijejo v "More ▼" dropdown. Vse ostalo enako.

### Mobile (<=768px)

Hamburger meni z grupiranimi sekcijami:
- **// tools** — vsi primarni linki
- **// admin** — admin linki (samo za admin)
- **// account** — workspace switcher + email + sign_out

### Breakpointi

| Breakpoint | Obnašanje |
|------------|-----------|
| >950px | Polni desktop: vseh 8 primarnih linkov + Admin/WS/User dropdowni |
| 769-950px | Narrow desktop: History+Usage v "More ▼" dropdown |
| <=768px | Mobile: hamburger z grouped sections |
| <=480px | Small phone: manjša pisava (13px) |

---

## Avtentikacija in avtorizacija

### Prijava

1. Uporabnik klikne "sign_in --google"
2. Google OAuth redirect
3. Callback preveri + logira poskus:
   - Ali obstaja User v DB z `active: true`? → Poveže Google Account (če manjka), dovoli, logira `sign_in_ok`
   - Ali je email v `ALLOWED_EMAILS` env (bootstrap)? → Ustvari User v DB, dovoli, logira `sign_in_bootstrap`
   - Ali obstaja User v DB z `active: false`? → Zavrni, logira `sign_in_denied_inactive`
   - Sicer → Zavrni, logira `sign_in_denied_unknown`

### Pre-created uporabniki

Ko admin doda uporabnika preko admin panela, se ustvari samo User zapis (brez OAuth Account linka). Ob prvem Google sign-inu signIn callback:
1. Najde obstoječega User-ja po emailu
2. Preveri, da Account link za Google ne obstaja
3. Ustvari Account zapis ki poveže Google profil z DB uporabnikom
4. Nastavi pravilen `user.id` za JWT

### JWT strategija

NextAuth z `session: { strategy: "jwt" }`:
- Edge middleware na Vercelu nima dostopa do baze
- JWT vsebuje `id` in `role` (nastavljeno v `jwt` callback)
- Cookie name v production: `__Secure-next-auth.session-token`

### Vloge

| Vloga | Dostop |
|-------|--------|
| `user` | LLM, STT, TTS, Image, Recipes, Jobs, History, Usage |
| `admin` | Vse kot user + Admin panel, Templates, KB, Recipe Builder, Workspaces, Auth Logs |

### Rate limiting (`src/lib/rate-limit.ts`)

Preverjanja pred vsako AI operacijo:
1. **Active check:** Ali je uporabnik aktiven?
2. **Dnevni limit:** Per-user `maxRunsPerDay` ali globalni default (200)
3. **Mesečni strošek:** Per-user `maxMonthlyCostCents` (opcijsko)
4. **Globalni mesečni cap:** `GLOBAL_MAX_MONTHLY_COST_CENTS` čez vse uporabnike

---

## Strani (Pages)

### Home (`/`)
Dashboard z ASCII art logotipom in pregledom orodij.

### LLM (`/llm`)
Multi-turn chat vmesnik. Sidebar s seznamom pogovorov. Izbira modela (Anthropic/OpenAI/Gemini), prompt template in knowledge base per-conversation. Avtomatski naslovi pogovorov. Cost preview med tipkanjem. Avtomatsko URL fetching.

### STT (`/stt`)
Upload audio datoteke ali URL. Izbira jezika (SL/EN). SSRF zaščita za URL fetch. Rezultat transkripcije z latency statistiko. Cost preview. Sidebar z zgodovino.

### TTS (`/tts`)
Tekstovno polje z counter znakov. Izbira glasu iz ElevenLabs. Audio player (R2 signed URL). Cost preview. Sidebar z zgodovino.

### Image (`/image`)
Tekstovni prompt za generiranje. Opcijski upload slike za urejanje. MIME validacija. Cost preview. Sidebar z zgodovino.

### Recipes (`/recipes`)
Seznam aktivnih receptov z opisom in step badges. Audio recepti imajo input mode tabs (file/URL/transcript), language selector in file upload. Execute gumb z "RUNNING..." blinking animacijo. Avtomatski redirect na detail po zaključku. Execution history z auto-polling (3s).

### Recipe Detail (`/recipes/[id]`)
Execution progress bar. Step-by-step timeline s statusom, trajanjem, inputom in outputom. Auto-polling za running izvedbe.

### Jobs (`/jobs`)
Centraliziran dashboard za vse recipe izvedbe. Filtriranje po statusu. Summary bar. Expandable detajli s step timeline. Cancel/retry akcije.

### History (`/history`)
Tabela vseh runov z expandable podrobnostmi. Filtriranje po tipu. Paginacija.

### Usage (`/usage`)
Statistika porabe po datumu. Stroški po modelu (v centih). Tabelarični pregled z filtriranjem.

### Admin (`/admin`)
Tabela uporabnikov z inline urejanjem. Obrazec za dodajanje novih uporabnikov.

### Admin Templates (`/admin/templates`)
CRUD za prompt template z versioniranjem. Obrazec s system prompt, knowledge text, kategorijo. Pregled verzij.

### Admin Knowledge (`/admin/knowledge`)
Knowledge base management. Upload dokumentov (PDF/TXT). Pregled dokumentov in stanja procesiranja.

### Admin Recipes (`/admin/recipes`)
Recipe builder. Form-based step management (add, remove, reorder z puščicami). Step konfiguracija po tipu (LLM: model/system prompt/user prompt, STT: provider/language, itd.). Input config sekcija (inputKind, inputModes, defaultLang). Preset instantiation. PRESET in AUDIO badges. **Versioniranje:** ob spremembi korakov se avtomatsko ustvari RecipeVersion snapshot s stepsSnapshot, changedBy in changeNote.

### Admin Models (`/admin/models`)
DB-driven AI model konfiguracija. Tabela vseh modelov s toggle-i za enable/disable in default. Inline urejanje pricinga. Dodajanje novih modelov (modelId, label, provider, pricing). Spremembe invalidirajo in-memory cache.

### Admin Analytics (`/admin/analytics`)
Agregirane metrike iz obstoječih Run/UsageEvent/RecipeExecution podatkov:
- Summary kartice: Total runs, Total cost, Error rate, Avg latency
- Tabela po providerju: runs, errors, error %, avg latency, cost
- Tabela po modelu: runs, avg latency, cost
- Execution metrike: total, avg duration, success rate
- Period selektor: 7d / 30d / 90d
- Auto-refresh vsake 30s

### Admin Auth Logs (`/admin/auth-logs`)
Tabela vseh auth poskusov. Filtriranje po emailu in event tipu. Statistike (denied 24h/7d, unique IPs). Expandable detajli z IP, user-agent, geo, razlogom.

### Admin Workspaces (`/admin/workspaces`)
Workspace management. Ustvari/uredi workspace. Dodaj/odstrani člane. Workspace-level limiti.

---

## Konfiguracija

### Guardrails (`src/lib/config.ts`)

| Parameter | ENV spremenljivka | Default |
|-----------|-------------------|---------|
| Max upload velikost | `MAX_FILE_SIZE_MB` | 50 MB |
| URL fetch timeout | `MAX_URL_FETCH_SECONDS` | 60 s |
| TTS znakov limit | `MAX_TTS_CHARS` | 10,000 |
| LLM prompt limit | `MAX_LLM_PROMPT_CHARS` | 200,000 |
| Dnevni runi/uporabnik | `MAX_RUNS_PER_DAY_PER_USER` | 200 |
| Globalni mesečni cap | `GLOBAL_MAX_MONTHLY_COST_CENTS` | 30000 (=$300) |

### Environment spremenljivke

| Kategorija | Spremenljivke |
|------------|---------------|
| Database | `DATABASE_URL` |
| NextAuth | `NEXTAUTH_URL`, `NEXTAUTH_SECRET` |
| Google OAuth | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |
| Access Control | `ALLOWED_EMAILS` |
| Anthropic | `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` |
| OpenAI | `OPENAI_API_KEY`, `OPENAI_MODEL` |
| Gemini | `GEMINI_API_KEY`, `GEMINI_MODEL` |
| Soniox | `SONIOX_API_KEY` |
| ElevenLabs | `ELEVENLABS_API_KEY` |
| Cloudflare R2 | `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` |
| Inngest | `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY` |
| Guardrails | `MAX_FILE_SIZE_MB`, `MAX_URL_FETCH_SECONDS`, `MAX_TTS_CHARS`, itd. |

---

## Deployment (Vercel)

### Zahteve

- **Vercel Pro plan** ($20/mo) — potreben za STT in recipe execution (`maxDuration: 300s`)
- **Node.js 20.x**
- Build command: `prisma generate && next build` (default)

### Vercel maxDuration

| Route | maxDuration | Razlog |
|-------|-------------|--------|
| `/api/runs/stt` | 300s | Soniox async transkripcija (polling) |
| `/api/runs/tts` | 60s | ElevenLabs sinteza + R2 upload |
| `/api/runs/llm` | 60s | LLM API klic |
| `/api/runs/image` | 60s | Gemini image generiranje |
| `/api/conversations/[id]/messages` | 60s | LLM chat + URL fetch + RAG |
| `/api/admin/knowledge/[id]/documents` | 120s | Document processing (extract → chunk → embed) |
| `/api/recipes/[id]/execute` | 30s | Recipe execution kick-off (upload + DB + Inngest send) — asinhrono |

### Database migracije

```bash
# Dev: ustvari + apliciraj migracijo
npx prisma migrate dev --name opis_spremembe

# Production: apliciraj obstoječe migracije
npx prisma migrate deploy

# pgvector setup (raw SQL — ni v Prisma schema):
# CREATE EXTENSION IF NOT EXISTS vector;
# ALTER TABLE "DocumentChunk" ADD COLUMN "embedding" vector(1536);
# CREATE INDEX ... USING ivfflat ... vector_cosine_ops;
```

---

## Odvisnosti

### Runtime

| Paket | Namen |
|-------|-------|
| `next` 16.1.6 | Framework |
| `react` 19.x | UI |
| `@prisma/client` ^7.4.0 | ORM |
| `@prisma/adapter-pg` + `pg` | PostgreSQL driver |
| `next-auth` ^4.24 | Avtentikacija (JWT) |
| `@auth/prisma-adapter` | NextAuth Prisma adapter |
| `@anthropic-ai/sdk` | Claude API |
| `openai` | GPT-4o API + Embeddings |
| `@google/generative-ai` | Gemini API |
| `@mozilla/readability` | Article text extraction (Reader View) |
| `linkedom` | Server-side DOM za Readability |
| `pdf-parse` | PDF text extraction za RAG |
| `@aws-sdk/client-s3` + presigner | R2 Storage |
| `inngest` | Async job queue |
| `uuid` | UUID generiranje |

### Dev

| Paket | Namen |
|-------|-------|
| `typescript` ^5 | Type checking |
| `tailwindcss` ^4 | CSS framework |
| `eslint` ^9 | Linting |
| `prisma` ^7.4.0 | Schema management + migracije |

---

## Changelog

### v2.2.0 (2026-02-16)

- **Async recipe execution (Inngest):** Recipe execution je sedaj asinhrona — API vrne takoj, Inngest worker izvede pipeline. maxDuration zmanjšan iz 300s na 30s. Frontend polira za napredek.
- **Aggregated cost tracking:** RecipeExecution ima totalCostCents + costBreakdownJson s per-step cost breakdown. Cost se prikaže v execution detail in jobs pages.
- **Recipe versioning:** Ob vsaki spremembi korakov (PUT /api/recipes/[id]/steps) se avtomatsko ustvari RecipeVersion snapshot. Recipe ima currentVersion counter. Execution shrani recipeVersion.
- **Audit trail hashi:** RecipeStepResult ima inputHash, outputHash (SHA256) in providerResponseId. Prikazano v collapsed "Audit Trail" sekciji na execution detail.
- **DB-driven AI model config:** AIModel tabela za admin upravljanje modelov, pricinga, enable/disable, default. Admin stran `/admin/models` s CRUD, inline pricing editing, toggli. Config.ts bere iz DB z 60s in-memory cache, fallback na ENV/hardcoded.
- **Admin analytics dashboard:** `/admin/analytics` z agregiranimi metrikami iz Run/UsageEvent/RecipeExecution. Error rates, latency, cost po providerju in modelu. Period selektor (7d/30d/90d), auto-refresh 30s.
- **Nav reorder:** Recipes je sedaj prvi primarni link. Jobs premaknjen v overflow (More ▼). Admin dropdown: dodana Models in Analytics.
- **Recipe version API:** GET `/api/admin/recipes/[id]/versions` za pregled verzij recepta.

### v2.1.0 (2025-02-16)

- **Workspace multi-tenancy:** Workspace model, members, per-workspace scoping za conversations/templates/KB/recipes/runs, workspace switcher v nav, admin workspace management
- **Template versioniranje:** PromptTemplateVersion model, avtomatske verzije ob PATCH
- **Recipe audio input:** inputKind/inputModes/defaultLang/uiHints polja na Recipe, multipart file upload na execute endpoint, audio file upload na R2
- **Recipe STT execution:** Implementacija dejanskega Soniox STT v recipe engine z skip logiko za transcript input
- **Recipe presets:** NOVINAR preset (Audio → Članek → SEO → Drupal), one-click instantiation
- **Sinhrona recipe execution:** Execute endpoint sedaj čaka na zaključek (prej fire-and-forget ki je Vercel ubijal)
- **Nav restructure:** Admin dropdown, user dropdown z sign_out, "More" overflow za narrow desktop, grouped mobile sections
- **MORANA favicon:** Zeleni terminal square (ico/png/apple-icon)
- **Admin recipe builder:** Izboljšani step config paneli, reordering, input config sekcija

### v2.0.0

- Začetna verzija z LLM/STT/TTS/Image moduli, prompt templates, RAG knowledge base, recipe builder, background jobs, auth security hardening
