# MORANA — Internal AI Operations Terminal

**Version:** 1.0.0
**Stack:** Next.js 16 | React 19 | TypeScript | Prisma 7 | PostgreSQL (Neon) | Tailwind CSS 4
**Hosting:** Vercel (serverless) | Cloudflare R2 (storage)
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
- JWT session strategija (kompatibilna z Edge middleware)
- Auth middleware za zaščito vseh route-ov
- CSRF zaščita na vseh state-changing endpointih
- SSRF zaščita z DNS resolucijo in IP blocklisto
- Security headerji (HSTS, CSP, X-Frame-Options, nosniff)
- Admin panel za upravljanje uporabnikov in limitov
- Per-user rate limiting (dnevni runi, mesečni stroški v centih)
- Globalni mesečni stroškovni cap (GLOBAL_MAX_MONTHLY_COST_CENTS)
- Beleženje porabe in stroškov po modelu (integer centi, brez float zaokroževanja)
- MIME magic-bytes validacija za file uploade
- Error message sanitizacija (brez internih leakov)
- Responsive dizajn za mobilne naprave
- Cloudflare R2 storage za datoteke in TTS audio
- Inngest async task queue za dolgotrajne procese (zahteva signing key)
- Vercel deployment z maxDuration za dolgotrajne API route

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
      inngest/            # Inngest webhook handler (zahteva INNGEST_SIGNING_KEY)
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
    auth.ts               # NextAuth konfiguracija (JWT strategija)
    config.ts             # Guardrails, modeli, pricing
    csrf.ts               # CSRF Origin/Referer validacija
    mime-validate.ts      # Magic-bytes MIME validacija
    prisma.ts             # Prisma client singleton + pg.Pool
    session.ts            # Session utilities (withAuth wrapper + CSRF)
    rate-limit.ts         # Per-user rate limiting
    storage.ts            # Cloudflare R2 S3 storage
    url-validate.ts       # SSRF zaščita (DNS resolucija, IP blocklist)
    usage.ts              # Usage event logging
    inngest/              # Async job definitions
  middleware.ts           # Auth middleware (JWT token preverba)
  generated/prisma/       # Auto-generated Prisma client
  types/                  # TypeScript deklaracije
prisma/
  schema.prisma           # Database schema
  migrations/             # SQL migracije
.env.example              # Dokumentacija vseh env spremenljivk
```

---

## Varnost

### Auth middleware (`src/middleware.ts`)

Middleware teče na Edge runtime pred vsakim requestom:
- Preusmeri neprijavljene uporabnike na `/` (307)
- Vrne 401 za neprijavljene API requeste
- Uporablja `getToken()` iz `next-auth/jwt` za JWT verifikacijo
- Podpira secure cookie name (`__Secure-` prefix) za HTTPS

**Javne poti** (brez avtentikacije):
- `/` — Home / login stran
- `/api/auth/*` — NextAuth endpointi
- `/api/inngest` — Inngest webhook (ima lastno signing key avtentikacijo)
- `/_next/*` — Next.js statični asseti
- `/favicon.ico`

### CSRF zaščita (`src/lib/csrf.ts`)

Vsi state-changing endpointi (POST, PATCH, DELETE) zahtevajo veljavno `Origin` ali `Referer` header. Validacija poteka v `withAuth()` wrapperju.

### SSRF zaščita (`src/lib/url-validate.ts`)

URL fetch (npr. STT iz URL-ja) je zaščiten z:
- Samo HTTPS protokol
- DNS resolucija pred fetchem
- Blokada privatnih IP-jev (RFC1918, loopback, link-local, metadata 169.254.x)
- Blokada credentialov v URL-ju
- `redirect: "error"` na fetch requestih

### Security headerji (`next.config.ts`)

| Header | Vrednost |
|--------|----------|
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` |
| `Content-Security-Policy` | `default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; ...` |
| `X-Frame-Options` | `DENY` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), browsing-topics=()` |

CSP `media-src` vključuje `https:` za R2 signed URL-je (TTS audio predvajanje).

### MIME validacija (`src/lib/mime-validate.ts`)

File uploadi so validirani z magic-bytes (ne zaupamo MIME tipu iz brskalnika). Podprti formati: MP3, WAV, OGG, FLAC, M4A, AAC, WebM, PNG, JPEG, WebP, GIF, PDF.

### Inngest endpoint zaščita

`/api/inngest` vrne 503 če `INNGEST_SIGNING_KEY` ni nastavljen. Brez signing key-a se handler sploh ne ustvari.

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
| `maxMonthlyCostCents` | Int? | Mesečni limit stroškov v **centih** (integer) |
| `allowedModels` | Json? | JSON array model ID stringov (null = vsi modeli) |
| `lastLoginAt` | DateTime | Zadnja prijava (posodobljeno max 1x/uro) |

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
| `idempotencyKey` | String? (unique) | Za preprečevanje dupliciranih runov |

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
| `costEstimateCents` | Int | Strošek v **centih** (integer, brez float zaokroževanja) |
| `latencyMs` | Int | Latenca |

---

## API Endpoints

### Avtentikacija

| Endpoint | Metoda | Opis |
|----------|--------|------|
| `/api/auth/[...nextauth]` | * | NextAuth Google OAuth handler |

### LLM Chat

| Endpoint | Metoda | CSRF | Opis |
|----------|--------|------|------|
| `/api/conversations` | GET | — | Seznam pogovorov uporabnika |
| `/api/conversations` | POST | ✅ | Ustvari nov pogovor |
| `/api/conversations/[id]` | GET | — | Podrobnosti pogovora z sporočili |
| `/api/conversations/[id]` | PATCH | ✅ | Posodobi model |
| `/api/conversations/[id]` | DELETE | ✅ | Izbriši pogovor |
| `/api/conversations/[id]/messages` | POST | ✅ | Pošlji sporočilo, prejmi AI odgovor (maxDuration: 60s) |

### Run Endpoints

| Endpoint | Metoda | CSRF | maxDuration | Opis |
|----------|--------|------|-------------|------|
| `/api/runs/llm` | POST | ✅ | 60s | Single-shot LLM obdelava |
| `/api/runs/stt` | POST | ✅ | 300s | Speech-to-text (file/URL) — zahteva Vercel Pro |
| `/api/runs/tts` | POST | ✅ | 60s | Text-to-speech (audio upload v R2) |
| `/api/runs/image` | POST | ✅ | 60s | Generiranje/urejanje slike |
| `/api/runs/[id]` | GET | — | — | Podrobnosti runa z input/output |

### Zgodovina in poraba

| Endpoint | Metoda | Opis |
|----------|--------|------|
| `/api/history` | GET | Paginirana zgodovina runov, filter po tipu (SQL $queryRaw) |
| `/api/usage` | GET | Statistika porabe po datumu in modelu |

### Reference

| Endpoint | Metoda | Opis |
|----------|--------|------|
| `/api/models` | GET | Seznam odobrenih LLM modelov |
| `/api/voices` | GET | Seznam ElevenLabs glasov |

### Admin (zahteva role=admin)

| Endpoint | Metoda | CSRF | Opis |
|----------|--------|------|------|
| `/api/admin/users` | GET | — | Seznam vseh uporabnikov s statistiko |
| `/api/admin/users` | POST | ✅ | Dodaj novega uporabnika (whitelist email) |
| `/api/admin/users/[id]` | GET | — | Podrobnosti uporabnika z runi in statistiko |
| `/api/admin/users/[id]` | PATCH | ✅ | Posodobi role, limite, active status |
| `/api/admin/users/[id]` | DELETE | ✅ | Deaktiviraj uporabnika (soft delete) |

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

**SSRF zaščita:** URL fetch je zaščiten z `validateFetchUrl()` — DNS resolucija, IP blocklist, HTTPS-only.

**Model:** `stt-async-v4`
**Jeziki:** Slovenščina (`sl`), Angleščina (`en`)
**Formati:** MP3, WAV, OGG, FLAC, M4A, AAC, WebM
**Cena:** $0.35/minuta
**Vercel:** `maxDuration: 300` — zahteva **Vercel Pro plan** ($20/mo)

### TTS — ElevenLabs

**Datoteka:** `src/lib/providers/tts.ts`

Text-to-speech z izbiro glasu:
- Seznam glasov: `GET /v1/voices`
- Sinteza: `POST /v1/text-to-speech/{voiceId}`
- Audio se uploada v **Cloudflare R2** (key: `tts/output/{runId}/{uuid}.mp3`)
- Fallback na base64 data URI če R2 ni dosegljiv

**Model:** `eleven_v3`
**Output:** MP3 (audio/mpeg) → R2 signed URL
**Limit:** 10,000 znakov
**Cena:** $0.30/1k znakov

### Image — Gemini 2.5 Flash Image

**Datoteka:** `src/lib/providers/image.ts`

Generiranje in urejanje slik z besedilnimi navodili:
- Text prompt za generiranje novih slik
- Text prompt + input slika za urejanje obstoječih slik

**Model:** `gemini-2.5-flash-image`
**Config:** `responseModalities: ["Text", "Image"]`
**Formati input:** PNG, JPEG, WebP, GIF (max 50MB)
**Output:** Base64 encoded slika (shranjena v R2 za image runs)
**Cena:** $0.15/1M input tok, $30.00/1M output tok (~$0.039/slika)

---

## Konfiguracija

### Guardrails (`src/lib/config.ts`)

| Parameter | ENV spremenljivka | Default | Vercel priporočilo |
|-----------|-------------------|---------|---------------------|
| Max upload velikost | `MAX_FILE_SIZE_MB` | 50 MB | 4 MB (Vercel body limit) |
| URL fetch timeout | `MAX_URL_FETCH_SECONDS` | 60 s | 55 s |
| TTS znakov limit | `MAX_TTS_CHARS` | 10,000 | — |
| LLM prompt limit | `MAX_LLM_PROMPT_CHARS` | 200,000 | — |
| Dnevni runi/uporabnik | `MAX_RUNS_PER_DAY_PER_USER` | 200 | — |
| Globalni mesečni cap | `GLOBAL_MAX_MONTHLY_COST_CENTS` | 30000 (=$300) | — |

### Environment spremenljivke

Vsi env-ji so dokumentirani v `.env.example`. Ključne kategorije:

| Kategorija | Spremenljivke |
|------------|---------------|
| Database | `DATABASE_URL` |
| NextAuth | `NEXTAUTH_URL`, `NEXTAUTH_SECRET` |
| Google OAuth | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |
| Access Control | `ALLOWED_EMAILS` |
| Anthropic | `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` |
| Gemini | `GEMINI_API_KEY`, `GEMINI_MODEL` |
| Soniox | `SONIOX_API_KEY` |
| ElevenLabs | `ELEVENLABS_API_KEY` |
| Cloudflare R2 | `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` |
| Inngest | `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY` |
| Guardrails | `MAX_FILE_SIZE_MB`, `MAX_URL_FETCH_SECONDS`, `MAX_TTS_CHARS`, itd. |

---

## Avtentikacija in avtorizacija

### Prijava

1. Uporabnik klikne "sign_in --google"
2. Google OAuth redirect
3. Callback preveri:
   - Ali obstaja User v DB z `active: true`? → Dovoli
   - Ali je email v `ALLOWED_EMAILS` env (bootstrap)? → Ustvari User v DB, dovoli
   - Ali obstaja User v DB z `active: false`? → Zavrni
   - Sicer → Zavrni

### JWT strategija

NextAuth je konfiguriran z `session: { strategy: "jwt" }` ker:
- Edge middleware na Vercelu nima dostopa do baze
- `getToken()` iz `next-auth/jwt` dela samo z JWT tokeni
- JWT vsebuje `id` in `role` (nastavljeno v `jwt` callback)
- Cookie name v production: `__Secure-next-auth.session-token`

### Vloge

| Vloga | Dostop |
|-------|--------|
| `user` | LLM, STT, TTS, Image, History, Usage |
| `admin` | Vse kot user + Admin panel |

### Rate limiting (`src/lib/rate-limit.ts`)

Preverjanja pred vsako AI operacijo:
1. **Active check:** Ali je uporabnik aktiven?
2. **Dnevni limit:** Per-user `maxRunsPerDay` ali globalni default (200)
3. **Mesečni strošek:** Per-user `maxMonthlyCostCents` (opcijsko)
4. **Globalni mesečni cap:** `GLOBAL_MAX_MONTHLY_COST_CENTS` čez vse uporabnike

### Session wrapper (`src/lib/session.ts`)

`withAuth(handler, req?)` — zaščiti API route:
- Preveri NextAuth session
- Vrne 401 če ni prijavljen
- Izvede **CSRF validacijo** na state-changing requestih (POST/PATCH/DELETE)
- Lovi napake, logira interno, vrne generični 500

---

## Admin panel

Dostop: samo uporabniki z `role: admin`

### Funkcije

- **Dodaj uporabnika:** Pre-create User v DB → email se doda na whitelist → uporabnik se prijavi z Google Auth
- **Upravljaj uporabnike:** Spremeni role, active status, dnevne limite, mesečne stroške (v centih), dovoljene modele (JSON array)
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
Upload audio datoteke ali URL. Izbira jezika (SL/EN). SSRF zaščita za URL fetch. Rezultat transkripcije z latency statistiko. Sidebar z zgodovino. Možnost pošiljanja rezultata v LLM za obdelavo.

### TTS (`/tts`)
Tekstovno polje z counter znakov (max 10,000). Izbira glasu iz ElevenLabs. Audio player za predvajanje (R2 signed URL). Sidebar z zgodovino.

### Image (`/image`)
Tekstovni prompt za generiranje. Opcijski upload slike za urejanje. MIME magic-bytes validacija. Prikaz generirane slike z download gumbom. Sidebar z zgodovino.

### History (`/history`)
Tabela vseh runov z expandable podrobnostmi. Filtriranje po tipu (LLM, STT, TTS, Image). Paginacija. SQL query z `$queryRaw` (ne `$queryRawUnsafe`).

### Usage (`/usage`)
Statistika porabe po datumu. Stroški po modelu (v centih). Tabelarični pregled z filtriranjem po obdobju.

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

## Deployment (Vercel)

### Zahteve

- **Vercel Pro plan** ($20/mo) — potreben za STT (`maxDuration: 300s`). Hobby plan ima limit 10s.
- **Node.js 20.x**
- Build command: `prisma generate && next build` (default)

### Vercel maxDuration

| Route | maxDuration | Razlog |
|-------|-------------|--------|
| `/api/runs/stt` | 300s | Soniox async transkripcija (polling) |
| `/api/runs/tts` | 60s | ElevenLabs sinteza + R2 upload |
| `/api/runs/llm` | 60s | LLM API klic |
| `/api/runs/image` | 60s | Gemini image generiranje |
| `/api/conversations/[id]/messages` | 60s | LLM chat odgovor |

### Environment spremenljivke — razlike od lokala

| Spremenljivka | Lokalno | Vercel Production |
|---------------|---------|-------------------|
| `NEXTAUTH_URL` | `http://localhost:3003` | `https://your-domain.com` |
| `NEXTAUTH_SECRET` | (development secret) | **nov** — `openssl rand -base64 32` |
| `MAX_FILE_SIZE_MB` | `50` | `4` (Vercel body limit) |
| `MAX_URL_FETCH_SECONDS` | `60` | `55` |

### Google OAuth

V Google Cloud Console → Credentials → OAuth 2.0 Client dodaj:
- **Authorized JavaScript origins:** `https://your-domain.com`
- **Authorized redirect URIs:** `https://your-domain.com/api/auth/callback/google`

### Custom domena

V Vercel → Settings → Domains:
- CNAME `app.domain.com` → `cname.vercel-dns.com`
- Ali A record za apex → `76.76.21.21`

---

## Tehnični detajli

### Prisma + Neon PostgreSQL

```typescript
// src/lib/prisma.ts
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,                          // max 5 connections (Neon free tier)
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,  // 10s connection timeout
  statement_timeout: 15_000,        // 15s query timeout
});
```

Prisma 7 z `@prisma/adapter-pg` za direktno pg.Pool povezavo.

### Storage — Cloudflare R2

S3-compatible storage prek `@aws-sdk/client-s3`:
- `uploadToR2(key, body, contentType)` — upload datoteke
- `uploadStreamToR2(key, stream, contentType)` — upload stream
- `getSignedDownloadUrl(key, expiresIn)` — signed URL za download (default 1h)

TTS audio se shranjuje v R2 z ključem `tts/output/{runId}/{uuid}.mp3`.

### Usage tracking

Vsaka AI operacija logira `UsageEvent` s:
- Provider in model
- Units (tokeni, znaki, sekunde) kot JSON
- Strošek v **centih** (integer) prek `estimateCost()`
- Latenca v milisekundah

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

```bash
# Generiranje migracije
npx prisma migrate dev --name opis_spremembe

# Apliciranje migracij na production
npx prisma migrate deploy
```

---

## Odvisnosti

### Runtime

| Paket | Verzija | Namen |
|-------|---------|-------|
| `next` | 16.1.6 | Framework |
| `react` | 19.2.3 | UI |
| `@prisma/client` | ^7.4.0 | ORM (generated) |
| `@prisma/adapter-pg` | ^7.4.0 | PostgreSQL adapter |
| `pg` | ^8.18.0 | PostgreSQL driver |
| `next-auth` | ^4.24.13 | Avtentikacija (JWT strategija) |
| `@auth/prisma-adapter` | ^2.11.1 | NextAuth Prisma adapter |
| `@anthropic-ai/sdk` | ^0.74.0 | Claude API |
| `@google/generative-ai` | ^0.24.1 | Gemini API |
| `@aws-sdk/client-s3` | ^3.990.0 | R2 Storage |
| `@aws-sdk/s3-request-presigner` | ^3.990.0 | Signed URLs |
| `inngest` | ^3.52.0 | Async job queue |
| `uuid` | ^13.0.0 | UUID generiranje |

### Dev

| Paket | Verzija | Namen |
|-------|---------|-------|
| `typescript` | ^5 | Type checking |
| `tailwindcss` | ^4 | CSS framework |
| `eslint` | ^9 | Linting |
| `prisma` | ^7.4.0 | Schema management + migracije |
