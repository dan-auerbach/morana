# MORANA

Internal AI operations terminal for media organizations. Multi-provider AI pipeline with speech-to-text, text-to-speech, LLM chat, image/video generation, multi-step recipes, and Telegram bot integration.

**Stack:** Next.js 16 | React 19 | TypeScript | Tailwind CSS 4 | Prisma 7 | PostgreSQL (Neon + pgvector) | Cloudflare R2 | Inngest

## Modules

| Module | Provider | Description |
|--------|----------|-------------|
| **LLM** | Anthropic, OpenAI, Gemini | Multi-turn chat, vision, RAG, web search, prompt templates |
| **STT** | Soniox | Audio/video transcription, diarization, translation |
| **TTS** | ElevenLabs | Voice synthesis, multiple voices, multilingual |
| **Image** | Gemini, Flux (fal.ai) | Text-to-image, image editing, face swap |
| **Video** | Kling (fal.ai) | Text/image/video-to-video generation |
| **SFX** | ElevenLabs | Sound effects generation |
| **Recipes** | Multi-step | Chained AI pipelines (STT -> LLM -> TTS -> publish) |
| **News Scout** | Multi-source | Automated news scanning, ranking, deduplication |

## Architecture

```
src/
  app/
    (app)/                    # Authenticated pages
      admin/                  # Admin dashboard (users, models, recipes, templates, etc.)
      llm/                    # LLM chat interface
      stt/                    # Speech-to-text interface
      tts/                    # Text-to-speech interface
      image/                  # Image generation interface
      video/                  # Video generation interface
      recipes/                # Recipe builder & execution
      history/                # Run history
      jobs/                   # Background job monitoring
      usage/                  # Usage analytics
      settings/               # User preferences
    api/
      auth/                   # NextAuth (Google OAuth)
      runs/                   # AI operation endpoints (llm, stt, tts, image, video, sfx)
      conversations/          # Chat conversation management
      recipes/                # Recipe CRUD & execution
      telegram/               # Telegram bot webhook & linking
      admin/                  # Admin API (users, models, workspaces, news-scout)
      integrations/drupal/    # Drupal CMS publishing
      upload/                 # R2 presigned upload URLs
      files/                  # File download/management
      knowledge/              # RAG knowledge base
  lib/
    providers/                # AI provider integrations
      llm.ts                  # Anthropic + OpenAI + Gemini chat
      stt.ts                  # Soniox speech-to-text
      tts.ts                  # ElevenLabs text-to-speech
      image.ts                # Gemini image generation
      fal-image.ts            # Flux/FLUX.2 image generation & editing
      fal-video.ts            # Video generation (Kling)
      embeddings.ts           # Vector embeddings for RAG
    recipe-engine.ts          # Multi-step pipeline executor
    recipe-presets.ts         # Pre-configured recipe templates
    telegram.ts               # Telegram Bot API utilities
    telegram-handlers.ts      # Direct AI module handlers for Telegram
    telegram-settings.ts      # Per-user Telegram preferences
    inngest/functions.ts      # Background job definitions
    news-scout/               # News scanning engine
    drupal/                   # Drupal CMS integration
    rag.ts                    # Retrieval-augmented generation
    config.ts                 # Model configuration & pricing
    rate-limit.ts             # Rate limiting & module access
    usage.ts                  # Usage event logging
    storage.ts                # Cloudflare R2 operations
    auth.ts                   # NextAuth configuration
```

## Telegram Bot

The Telegram bot provides direct access to all AI modules. Users link their account via a 6-digit code, then interact using modes and commands.

### Modes

| Mode | Behavior |
|------|----------|
| `stt` (default) | Audio/video messages are transcribed |
| `llm` | Text messages go to LLM chat, audio is transcribed then sent to LLM, photos analyzed with vision |
| `recipe` | Files trigger recipe execution (NOVINAR for audio, STORY_VIDEO for images) |

### Commands

| Command | Description |
|---------|-------------|
| `/start` | Welcome message and instructions |
| `/link KODA` | Link Telegram to MORANA account |
| `/unlink` | Unlink account |
| `/mode stt\|llm\|recipe` | Switch active mode |
| `/settings` | Show current settings |
| `/lang sl\|en\|auto` | Set STT language |
| `/diarize on\|off` | Toggle speaker diarization |
| `/translate en\|sl\|off` | Set translation target |
| `/tts besedilo` | Generate speech (any mode) |
| `/voice` | List available TTS voices |
| `/setvoice ID` | Set TTS voice |
| `/model` | List available LLM models |
| `/setmodel ID` | Set LLM model |
| `/system prompt` | Set custom system prompt |
| `/clear` | Clear LLM conversation history |
| `/image opis` | Generate image (any mode) |
| `/run` | List available recipes |
| `/run slug text` | Execute a recipe |
| `/status` | Recent operations |
| `/help` | All commands |

### Per-user Settings (DB-backed)

Each user's preferences are stored in `TelegramUserSettings`:
- Mode (stt/llm/recipe)
- STT language, diarization, translation target
- TTS voice ID
- LLM model ID, system prompt
- Image provider (gemini/fal)

## Recipes

Multi-step AI pipelines that chain operations together. Examples:

- **NOVINAR AUTO 1**: Audio -> STT -> LLM (news article) -> TTS -> Drupal publish
- **INTERVJU > CLANEK**: Audio -> STT -> LLM (interview to article)
- **STORY > VIDEO**: Image + text -> Video generation
- **URL POVZETEK**: URL -> Fetch -> LLM (summary)

Recipes execute via Inngest background jobs with progress tracking, cost aggregation, and Telegram notifications on completion.

## Database Schema

32 models organized into groups:

- **Auth**: User, Account, Session, AuthLog
- **Multi-tenancy**: Workspace, WorkspaceMember
- **Chat**: Conversation, Message
- **Execution**: Run, RunInput, RunOutput, File, UsageEvent
- **Templates**: PromptTemplate, PromptTemplateVersion
- **Knowledge**: KnowledgeBase, Document, DocumentChunk (pgvector)
- **Recipes**: Recipe, RecipeStep, RecipeVersion, RecipeExecution, RecipeStepResult
- **Config**: AIModel
- **Telegram**: TelegramLink, TelegramLinkCode, TelegramUserSettings, TelegramExecutionMap
- **Integrations**: IntegrationDrupal
- **News Scout**: NewsScoutTopic, NewsScoutSource, NewsScoutRun

## Setup

### Prerequisites

- Node.js 20+
- PostgreSQL 15+ with pgvector extension (or Neon)
- Cloudflare R2 bucket

### Environment Variables

```bash
# Database
DATABASE_URL=postgresql://...

# Auth
NEXTAUTH_URL=https://your-domain.com
NEXTAUTH_SECRET=           # openssl rand -base64 32
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
ALLOWED_EMAILS=            # comma-separated bootstrap whitelist

# AI Providers
ANTHROPIC_API_KEY=
GEMINI_API_KEY=
OPENAI_API_KEY=
SONIOX_API_KEY=
ELEVENLABS_API_KEY=
FAL_KEY=

# Storage (Cloudflare R2)
R2_ENDPOINT=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=morana

# Background Jobs (Inngest)
INNGEST_EVENT_KEY=
INNGEST_SIGNING_KEY=

# Telegram Bot (optional)
TELEGRAM_BOT_TOKEN=
TELEGRAM_WEBHOOK_SECRET=

# Drupal Integration (optional)
DRUPAL_ENCRYPTION_KEY=     # 64 hex chars (32 bytes)

# Guardrails
MAX_FILE_SIZE_MB=500       # 4 on Vercel
MAX_RUNS_PER_DAY_PER_USER=200
GLOBAL_MAX_MONTHLY_COST_CENTS=30000  # $300
```

### Install & Run

```bash
npm install
npx prisma db push
npm run dev
```

### Production Build

```bash
npm run build
npm start
```

## Usage & Cost Tracking

Every AI operation logs a `UsageEvent` with provider, model, unit breakdown, and estimated cost. Costs are stored as **float cents** for sub-cent precision (e.g. a Gemini Flash call with 2000 tokens = 0.02¢).

### Pricing Configuration

Pricing is resolved in order:
1. **DB-driven** — `AIModel` table records (cached 60s), managed via Admin → Models
2. **Hardcoded fallback** — `defaultPricing` in `src/lib/config.ts`

Supported pricing units:

| Unit | Example | Calculation |
|------|---------|-------------|
| `1M_tokens` | LLM models | `(inputTokens × input + outputTokens × output) / 1M` |
| `1k_chars` | ElevenLabs TTS/SFX | `chars × input / 1000` |
| `per_minute` | Soniox STT | `(seconds / 60) × input` |
| `per_image` | Flux image gen | `images × input` |
| `per_second` | Kling video gen | `videoSeconds × input` |

### Rate Limiting & Cost Caps

- **Per-user daily run limit** — `User.maxRunsPerDay` (default: 200 via ENV)
- **Per-user monthly cost cap** — `User.maxMonthlyCostCents` (optional)
- **Workspace monthly cost cap** — `Workspace.maxMonthlyCostCents` (optional)
- **Global monthly cost cap** — `GLOBAL_MAX_MONTHLY_COST_CENTS` ENV (default: $300)

### Usage Dashboard

`/usage` page shows summary cards, per-model breakdown, recipe execution costs, and a detailed event table with date/provider filtering.

## Security

- Google OAuth with email whitelist
- CSRF protection on state-changing endpoints
- SSRF protection (DNS resolution + IP blocklist for URL fetching)
- Rate limiting (per-user daily limits, global monthly cost caps)
- Module access control (per-user allowedModules)
- Encrypted Drupal credentials (AES-256-GCM)
- Auth logging with IP/geolocation
- Security headers (HSTS, CSP, X-Frame-Options)

## Internationalization

UI supports English and Slovenian (`/settings` -> locale). Telegram bot messages are in Slovenian by default.

## Deployment

Deployed on Vercel (serverless) with:
- Neon PostgreSQL (with pgvector)
- Cloudflare R2 (file storage)
- Inngest (background job processing)
