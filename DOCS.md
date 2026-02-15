# MORANA — Internal AI Operations Terminal

**Version:** 0.1.0
**Stack:** Next.js 16 | React 19 | TypeScript | Prisma 7 | PostgreSQL (Neon) | Tailwind CSS 4
**UI Theme:** Dark hacker/terminal aesthetic

---

## Pregled

MORANA je interni AI pipeline za medijsko podjetje. Združuje več AI storitev v enoten terminal-style vmesnik:

| Modul | Provider | Opis |
|-------|----------|------|
| **LLM** | Anthropic Claude, Google Gemini | Multi-turn chat, single-shot obdelava besedil |
| **STT** | Soniox | Transkripcija zvoka (SL, EN) |
| **TTS** | ElevenLabs | Sinteza govora z izbiro glasov |
| **Image** | Google Gemini 2.5 Flash | Generiranje in urejanje slik |

### Ključne zmožnosti

- Google OAuth avtentikacija z email whitelistom
- Admin panel za upravljanje uporabnikov in limitov
- Per-user rate limiting (dnevni runi, mesečni stroški)
- Beleženje porabe in stroškov po modelu
- Responsive dizajn za mobilne naprave
- Cloudflare R2 storage za datoteke
- Inngest async task queue za dolgotrajne procese

---

## Arhitektura

```
src/
  app/                    # Next.js App Router
    api/                  # API route handlers
      auth/[...nextauth]  # NextAuth endpoint
      admin/users/        # Admin CRUD za uporabnike
      conversations/      # LLM multi-turn chat API
      history/            # Zgodovina runov
      models/             # Seznam odobrenih modelov
      runs/               # STT, TTS, LLM, Image run endpoints
      usage/              # Statistika porabe
      voices/             # ElevenLabs glasovi
      inngest/            # Inngest webhook handler
    components/           # React komponente (Nav, StatusBadge, SessionProvider)
    admin/                # Admin stran
    llm/                  # LLM chat stran
    stt/                  # STT stran
    tts/                  # TTS stran
    image/                # Image generiranje stran
    history/              # Zgodovina stran
    usage/                # Poraba stran
    globals.css           # Globalni stili + responsive CSS
    layout.tsx            # Root layout
  lib/                    # Backend logika
    providers/            # AI provider integracije
      llm.ts              # Anthropic + Gemini LLM
      stt.ts              # Soniox STT
      tts.ts              # ElevenLabs TTS
      image.ts            # Gemini Image generiranje
    auth.ts               # NextAuth konfiguracija
    config.ts             # Guardrails, modeli, pricing
    prisma.ts             # Prisma client singleton + pg.Pool
    session.ts            # Session utilities (withAuth wrapper)
    rate-limit.ts         # Per-user rate limiting
    storage.ts            # Cloudflare R2 S3 storage
    usage.ts              # Usage event logging
    inngest/              # Async job definitions
  generated/prisma/       # Auto-generated Prisma client
  types/                  # TypeScript deklaracije
prisma/
  schema.prisma           # Database schema
  migrations/             # SQL migracije
```

---

## Database schema

### Enumi

| Enum | Vrednosti |
|------|-----------|
| `Role` | `user`, `admin` |
| `RunType` | `stt`, `llm`, `tts`, `image` |
| `RunStatus` | `queued`, `running`, `done`, `error` |
| `FileKind` | `input`, `output` |

### Modeli

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
| `maxMonthlyCostUsd` | Float? | Mesečni limit stroškov v USD |
| `allowedModels` | String? | Comma-separated model IDs (null = vsi) |
| `lastLoginAt` | DateTime | Zadnja prijava |

Relacije: `runs`, `files`, `usageEvents`, `accounts`, `sessions`, `conversations`

#### Conversation
Multi-turn LLM pogovori.

| Polje | Tip | Opis |
|-------|-----|------|
| `id` | String (cuid) | Primarni ključ |
| `userId` | String | FK na User |
| `title` | String | Naslov pogovora |
| `modelId` | String | ID izbranega modela |

Relacije: `user`, `messages`

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

#### Run
Posamezna izvedba AI operacije.

| Polje | Tip | Opis |
|-------|-----|------|
| `type` | RunType | `stt`, `llm`, `tts`, `image` |
| `status` | RunStatus | `queued`, `running`, `done`, `error` |
| `provider` | String | AI provider |
| `model` | String | Model ID |
| `errorMessage` | Text? | Napaka, če status = error |

Relacije: `user`, `input` (RunInput), `output` (RunOutput), `files`, `usage`, `messages`

#### RunInput / RunOutput
JSON payload za vhod in izhod runa.

#### UsageEvent
Beleženje porabe in stroškov.

| Polje | Tip | Opis |
|-------|-----|------|
| `provider` | String | Provider |
| `model` | String | Model ID |
| `unitsJson` | Json | `{ inputTokens, outputTokens, chars, seconds }` |
| `costEstimate` | Float | Ocenjen strošek v USD |
| `latencyMs` | Int | Latenca |

---

## API Endpoints

### Avtentikacija

| Endpoint | Metoda | Opis |
|----------|--------|------|
| `/api/auth/[...nextauth]` | * | NextAuth Google OAuth handler |

### LLM Chat

| Endpoint | Metoda | Opis |
|----------|--------|------|
| `/api/conversations` | GET | Seznam pogovorov uporabnika |
| `/api/conversations` | POST | Ustvari nov pogovor |
| `/api/conversations/[id]` | GET | Podrobnosti pogovora z sporočili |
| `/api/conversations/[id]` | PATCH | Posodobi model |
| `/api/conversations/[id]` | DELETE | Izbriši pogovor |
| `/api/conversations/[id]/messages` | POST | Pošlji sporočilo, prejmi AI odgovor |

### Run Endpoints

| Endpoint | Metoda | Opis |
|----------|--------|------|
| `/api/runs/llm` | POST | Single-shot LLM obdelava |
| `/api/runs/stt` | POST | Speech-to-text (file/URL) |
| `/api/runs/tts` | POST | Text-to-speech |
| `/api/runs/image` | POST | Generiranje/urejanje slike |
| `/api/runs/[id]` | GET | Podrobnosti runa z input/output |

### Zgodovina in poraba

| Endpoint | Metoda | Opis |
|----------|--------|------|
| `/api/history` | GET | Paginirana zgodovina runov, filter po tipu |
| `/api/usage` | GET | Statistika porabe po datumu in modelu |

### Reference

| Endpoint | Metoda | Opis |
|----------|--------|------|
| `/api/models` | GET | Seznam odobrenih LLM modelov |
| `/api/voices` | GET | Seznam ElevenLabs glasov |

### Admin (zahteva role=admin)

| Endpoint | Metoda | Opis |
|----------|--------|------|
| `/api/admin/users` | GET | Seznam vseh uporabnikov s statistiko |
| `/api/admin/users` | POST | Dodaj novega uporabnika (whitelist email) |
| `/api/admin/users/[id]` | GET | Podrobnosti uporabnika z runi in statistiko |
| `/api/admin/users/[id]` | PATCH | Posodobi role, limite, active status |
| `/api/admin/users/[id]` | DELETE | Deaktiviraj uporabnika (soft delete) |

---

## AI Providerji

### LLM — Anthropic Claude + Google Gemini

**Datoteka:** `src/lib/providers/llm.ts`

Podpira dva načina:
- **Single-shot** (`runLLM`): Pošlji prompt + opcijsko izvorno besedilo
- **Multi-turn chat** (`runLLMChat`): Pošlji celoten history sporočil

**Modeli:**
| Model | Provider | Input cena | Output cena |
|-------|----------|-----------|-------------|
| `claude-sonnet-4-5-20250929` | Anthropic | $3.00/1M tok | $15.00/1M tok |
| `gemini-2.0-flash` | Gemini | $0.10/1M tok | $0.40/1M tok |

Gemini je na voljo samo če je `GEMINI_API_KEY` nastavljen.

**Anthropic:** Uporablja `@anthropic-ai/sdk`, `max_tokens: 8192`
**Gemini:** Uporablja `@google/generative-ai`, `startChat` za multi-turn

### STT — Soniox

**Datoteka:** `src/lib/providers/stt.ts`

Async transkripcija prek Soniox REST API:
1. Upload audio datoteke (`POST /v1/files`)
2. Ustvari transkripcijo (`POST /v1/transcriptions`)
3. Polling do zaključka (max 3 min)
4. Preberi transkript (`GET /v1/transcriptions/{id}/transcript`)
5. Cleanup uploada

**Model:** `stt-async-v4`
**Jeziki:** Slovenščina (`sl`), Angleščina (`en`)
**Formati:** MP3, WAV, OGG, FLAC, M4A, AAC, WebM
**Cena:** $0.35/minuta

### TTS — ElevenLabs

**Datoteka:** `src/lib/providers/tts.ts`

Text-to-speech z izbiro glasu:
- Seznam glasov: `GET /v1/voices`
- Sinteza: `POST /v1/text-to-speech/{voiceId}`

**Model:** `eleven_v3`
**Output:** MP3 (audio/mpeg)
**Limit:** 10,000 znakov
**Cena:** $0.30/1k znakov

### Image — Gemini 2.5 Flash Image

**Datoteka:** `src/lib/providers/image.ts`

Generiranje in urejanje slik z besedilnimi navodili:
- Text prompt za generiranje novih slik
- Text prompt + input slika za urejanje obstoječih slik

**Model:** `gemini-2.5-flash-image`
**Config:** `responseModalities: ["Text", "Image"]`
**Formati input:** PNG, JPEG, WebP, GIF (max 20MB)
**Output:** Base64 encoded slika (ni shranjena v DB)
**Cena:** $0.15/1M input tok, $30.00/1M output tok (~$0.039/slika)

---

## Konfiguracija

### Guardrails (`src/lib/config.ts`)

| Parameter | ENV spremenljivka | Default |
|-----------|-------------------|---------|
| Max upload velikost | `MAX_FILE_SIZE_MB` | 500 MB |
| URL fetch timeout | `MAX_URL_FETCH_SECONDS` | 60 s |
| TTS znakov limit | `MAX_TTS_CHARS` | 10,000 |
| LLM prompt limit | `MAX_LLM_PROMPT_CHARS` | 200,000 |
| Dnevni runi/uporabnik | `MAX_RUNS_PER_DAY_PER_USER` | 200 |

### Environment spremenljivke

```bash
# Database (Neon PostgreSQL)
DATABASE_URL="postgresql://..."

# NextAuth
NEXTAUTH_URL="http://localhost:3003"
NEXTAUTH_SECRET="<random-secret>"

# Google OAuth
GOOGLE_CLIENT_ID="<google-client-id>"
GOOGLE_CLIENT_SECRET="<google-client-secret>"

# AI API ključi
ANTHROPIC_API_KEY="<anthropic-key>"
ANTHROPIC_MODEL="claude-sonnet-4-5-20250929"      # opcijsko
GEMINI_API_KEY="<gemini-key>"
GEMINI_MODEL="gemini-2.0-flash"                    # opcijsko
SONIOX_API_KEY="<soniox-key>"
ELEVENLABS_API_KEY="<elevenlabs-key>"

# Cloudflare R2 Storage
R2_ENDPOINT="https://<account-id>.r2.cloudflarestorage.com"
R2_ACCESS_KEY_ID="<r2-access-key>"
R2_SECRET_ACCESS_KEY="<r2-secret-key>"
R2_BUCKET="morana"

# Access Control
ALLOWED_EMAILS="user1@example.com,user2@example.com"

# Guardrails (opcijsko)
MAX_FILE_SIZE_MB="500"
MAX_URL_FETCH_SECONDS="60"
MAX_TTS_CHARS="10000"
MAX_LLM_PROMPT_CHARS="200000"
MAX_RUNS_PER_DAY_PER_USER="200"

# Inngest (async jobs)
INNGEST_EVENT_KEY="<event-key>"
INNGEST_SIGNING_KEY="<signing-key>"
```

---

## Avtentikacija in avtorizacija

### Prijava

1. Uporabnik klikne "sign_in --google"
2. Google OAuth redirect
3. Callback preveri:
   - Ali je email v `ALLOWED_EMAILS` env spremenljivki? -> Dovolj
   - Ali obstaja User v DB z `active: true`? -> Dovolj
   - Ali obstaja User v DB z `active: false`? -> Zavrni
   - Sicer -> Zavrni

### Vloge

| Vloga | Dostop |
|-------|--------|
| `user` | LLM, STT, TTS, Image, History, Usage |
| `admin` | Vse kot user + Admin panel |

### Rate limiting (`src/lib/rate-limit.ts`)

Preverjanja pred vsako AI operacijo:
1. **Active check:** Ali je uporabnik aktiven?
2. **Dnevni limit:** Per-user `maxRunsPerDay` ali globalni default (200)
3. **Mesečni strošek:** Per-user `maxMonthlyCostUsd` (opcijsko)

### Session wrapper (`src/lib/session.ts`)

`withAuth(handler)` — zaščiti API route:
- Preveri NextAuth session
- Vrne 401 če ni prijavljen
- Lovi napake in vrne 500

---

## Admin panel

Dostop: samo uporabniki z `role: admin`

### Funkcije

- **Dodaj uporabnika:** Pre-create User v DB -> email se doda na whitelist -> uporabnik se prijavi z Google Auth
- **Upravljaj uporabnike:** Spremeni role, active status, dnevne limite, mesečne stroške, dovoljene modele
- **Pregled statistike:** Dnevni in mesečni runi, stroški, zadnja prijava
- **Zadnji runi:** Pregled 50 zadnjih runov vsakega uporabnika
- **Deaktivacija:** Soft delete (active = false), admin ne more deaktivirati sam sebe

---

## Strani (Pages)

### Home (`/`)
Dashboard z ASCII art logotipom in pregledom orodij.

### LLM (`/llm`)
Multi-turn chat vmesnik. Sidebar s seznamom pogovorov. Izbira modela per-conversation. Avtomatski naslovi pogovorov.

### STT (`/stt`)
Upload audio datoteke ali URL. Izbira jezika (SL/EN). Rezultat transkripcije z latency statistiko. Sidebar z zgodovino. Možnost pošiljanja rezultata v LLM za obdelavo.

### TTS (`/tts`)
Tekstovno polje z counter znakov (max 10,000). Izbira glasu iz ElevenLabs. Audio player za predvajanje. Sidebar z zgodovino.

### Image (`/image`)
Tekstovni prompt za generiranje. Opcijski upload slike za urejanje. Prikaz generirane slike z download gumbom. Sidebar z zgodovino.

### History (`/history`)
Tabela vseh runov z expandable podrobnostmi. Filtriranje po tipu (LLM, STT, TTS, Image). Paginacija.

### Usage (`/usage`)
Statistika porabe po datumu. Stroški po modelu. Tabelarični pregled z filtriranjem po obdobju.

### Admin (`/admin`)
Tabela uporabnikov z inline urejanjem. Obrazec za dodajanje novih uporabnikov. Expandable detail panel s statistiko in zadnjimi runi.

---

## Responsive dizajn

### Breakpoints

| Breakpoint | Opis |
|------------|------|
| `> 768px` | Desktop: horizontalni nav, sidebar levo |
| `<= 768px` | Mobilni: hamburger meni, sidebar nad content (max 200px) |
| `<= 480px` | Mali telefoni: manjši font (13px) |

### CSS klase

| Klasa | Opis |
|-------|------|
| `.nav-hamburger` | Hamburger gumb (skrit na desktop) |
| `.nav-links-desktop` | Horizontalni nav linki (skriti na mobile) |
| `.nav-email` | Email uporabnika (skrit na mobile) |
| `.nav-signout-desktop` | Sign out gumb (skrit na mobile) |
| `.page-with-sidebar` | Wrapper za strani s sidebar (flex-direction: column na mobile) |
| `.page-sidebar` | Sidebar kontejner (full width, max-height 200px na mobile) |
| `.page-main` | Main content kontejner |
| `.admin-form-grid-*` | Admin obrazci (single column na mobile) |
| `.admin-table-wrap` | Admin tabela (horizontal scroll na mobile) |

---

## Tehnični detajli

### Prisma + Neon PostgreSQL

```typescript
// src/lib/prisma.ts
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,                          // max 5 connections
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,  // 10s connection timeout
  statement_timeout: 15_000,        // 15s query timeout
});
```

Prisma 7 z `@prisma/adapter-pg` za direktno pg.Pool povezavo. Neon zahteva nizko `max` vrednost za serverless okolje.

### Storage — Cloudflare R2

S3-compatible storage prek `@aws-sdk/client-s3`:
- `uploadToR2(key, body, contentType)` — upload datoteke
- `uploadStreamToR2(key, stream, contentType)` — upload stream
- `getSignedDownloadUrl(key, expiresIn)` — signed URL za download (default 1h)

### Usage tracking

Vsaka AI operacija logira `UsageEvent` s:
- Provider in model
- Units (tokeni, znaki, sekunde)
- Ocenjen strošek prek `estimateCost()`
- Latenca

### Sanitizacija payload-a

`/api/runs/[id]` vrne sanitizirane payloade — stringi nad 10KB so skrajšani, da preprečijo zamrznitev brskalnika (npr. base64 audio).

---

## Razvoj

### Zagon

```bash
# Namestitev
npm install

# Generiranje Prisma clienta
npx prisma generate

# Dev server (port 3003)
PORT=3003 npx next dev --turbopack -p 3003
```

### Build

```bash
npm run build    # prisma generate + next build
npm start        # production server
```

### Database migracije

Zaradi drift-a s ročno dodanimi tabelami (Conversation, Message) se nove spremembe aplicirajo z raw SQL:

```sql
-- Primer dodajanja novega RunType
ALTER TYPE "RunType" ADD VALUE IF NOT EXISTS 'image';

-- Primer dodajanja stolpca
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "maxRunsPerDay" INTEGER;
```

---

## Odvisnosti

### Runtime

| Paket | Verzija | Namen |
|-------|---------|-------|
| `next` | 16.1.6 | Framework |
| `react` | 19.2.3 | UI |
| `@prisma/client` | ^7.4.0 | ORM |
| `@prisma/adapter-pg` | ^7.4.0 | PostgreSQL adapter |
| `pg` | ^8.18.0 | PostgreSQL driver |
| `next-auth` | ^4.24.13 | Avtentikacija |
| `@auth/prisma-adapter` | ^2.11.1 | NextAuth Prisma adapter |
| `@anthropic-ai/sdk` | ^0.74.0 | Claude API |
| `@google/generative-ai` | ^0.24.1 | Gemini API |
| `@aws-sdk/client-s3` | ^3.990.0 | R2 Storage |
| `@aws-sdk/s3-request-presigner` | ^3.990.0 | Signed URLs |
| `inngest` | ^3.52.0 | Async job queue |
| `uuid` | ^13.0.0 | UUID generiranje |
| `dotenv` | ^17.3.1 | ENV loading |

### Dev

| Paket | Verzija | Namen |
|-------|---------|-------|
| `typescript` | ^5 | Type checking |
| `tailwindcss` | ^4 | CSS framework |
| `eslint` | ^9 | Linting |
