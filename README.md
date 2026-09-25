# LongCut — long-form video intelligence & clipping workstation

LongCut turns **1–10 hour** livestreams, podcasts, interviews, webinars and gaming streams into
**complete, standalone 5–20 minute clips**. It isn't built for 30-second viral moments. It:

1. ingests a local upload (resumable, straight to object storage) or a YouTube URL,
2. extracts speech audio with FFmpeg and transcribes it in checkpointed chunks (word timestamps, speakers),
3. detects English / Hindi / Urdu / **Hinglish** and keeps the creator's natural style,
4. maps every topic across the full transcript, proposes long-form segments, snaps them to clean sentence
   boundaries and scores each one on 16 content signals,
5. surfaces the **#1 Best Clip** with a full publishing package (titles, descriptions, hashtags, hook,
   thumbnail concept + AI image prompt, CTA), then the other high-potential clips and the full list,
6. provides a browser editor (timeline with waveform, drag in/out, transcript-based editing and cuts,
   caption styling with a live preview) and
7. renders MP4 (H.264/AAC) with burned-in captions, plus SRT/VTT, as background batch exports.

---

## 1. Architecture

```
 Browser (Next.js UI)
   │  ① presigned multipart PUTs (resumable, parallel) ─────────────────────┐
   │  ② JSON API (auth, presign, enqueue, status polling)                    │
   ▼                                                                        ▼
 Netlify: Next.js app + route handlers ──── Postgres ────  S3-compatible storage
 (no video bytes, no FFmpeg)          (data + job queue)   (R2 / S3 / MinIO)
                                             ▲  ▲                 ▲
                                  claim/lease│  │status/progress  │ range reads, uploads
                                             │  │                 │
                          Processing worker (Docker: Node + FFmpeg + yt-dlp [+ faster-whisper])
                             ├─ media layer: probe, audio, waveform, proxy, render (FFmpeg/libass)
                             ├─ speech layer: Deepgram / OpenAI Whisper / Groq / local faster-whisper
                             └─ intelligence layer: Claude (default) or OpenAI (transcript text only)
```

**Why this shape**

| Decision | Reason |
|---|---|
| **Browser → storage multipart uploads** | A 10-hour file (5–50 GB) never touches a serverless function or browser memory. Files are read slice by slice, uploaded in parallel parts with retries, and resumable after a reload (`ListParts`). |
| **Postgres job queue** (`FOR UPDATE SKIP LOCKED`, leases + heartbeats, dedupe keys, exponential backoff) | No extra infrastructure (no Redis). The web app enqueues on its own DB connection; NOTIFY wakes workers instantly. A crashed or redeployed worker's lease expires and the job is re-queued. |
| **Checkpointed pipeline** | The source, metadata, extracted audio, *every transcript chunk*, the transcript and the topic map are persisted. A retry at hour 7 of a 10-hour transcription resumes at hour 7. |
| **FFmpeg reads presigned URLs** | Probing, audio extraction and clip renders stream from storage with HTTP range requests (`-ss` before `-i`), so a 20-minute render never downloads a 10-hour source. |
| **Separate AI and media layers** | FFmpeg does all video/audio work. The LLM only ever sees transcript text (and one JPEG frame for thumbnail prompts), and it returns schema-validated JSON. |
| **Deterministic scoring blend** | The LLM rates signals (hook, story, density, standalone context…). The *Predicted Performance Potential* is a weighted blend computed in code, so switching strategy re-ranks instantly with no re-analysis. |
| **Worker on a container host** (Fly.io / Railway / Render / VPS / GPU box) | Long-running CPU/GPU work, large temp disk, FFmpeg and fonts. Scales separately from the UI. `WORKER_ROLES` lets you run heavy (FFmpeg) and light (LLM) pools as separate services. |

**Recommended stack:** Netlify (web) + Supabase or Neon Postgres + Cloudflare R2 (no egress fees for
previews and downloads) + a Fly.io/Railway worker + Deepgram Nova-3 (native Hindi/English code-switching,
diarization, fast) + Claude for analysis.

### Processing pipeline

| Stage (UI status) | What happens | Checkpoint |
|---|---|---|
| Uploading / Downloading | Browser multipart upload, or `yt-dlp` → local disk → multipart to storage | `projects.storage_path` |
| Extracting audio | ffprobe metadata + thumbnail; mono 16 kHz Opus (~14 MB/hour); waveform peaks; 540p preview proxy queued for MKV/AVI/HEVC/4K | `audio_path`, `waveform_path` |
| Transcribing | 10-min chunks with 4 s overlap, parallel; words merged at overlap midpoints; hallucination loops removed; sentences/paragraphs built | `transcript_chunks` rows, then `transcripts` |
| Analyzing | Topic map over ~30-min windows (map) | `analyses.sections` |
| Finding clips | Global candidate proposal over the whole topic map (reduce), per-candidate boundary refinement + signal scoring, quality gate (weak standalone context / abrupt start *and* end), overlap de-dupe, strategy ranking, #1 publishing package | `clips` |

### Clip detection logic

1. **Segment by topic.** Each transcript window is split into coherent sections (story, explanation, debate,
   Q&A, gameplay, filler…) with value/energy ratings.
2. **Propose long-form candidates.** One call sees the *entire* topic map and composes contiguous section
   ranges that fit the duration window (±12% around fixed targets, 5–20 min for Auto). Filler is skipped
   and candidates never overlap.
3. **Refine boundaries.** For each candidate the model sees the transcript around it and picks the exact
   opening sentence (the viewer understands the topic) and concluding sentence (a natural resolution). The
   code then enforces the window on sentence edges, preferring clean endings.
4. **Score.** 16 signals (hook, curiosity gap, emotion, story, density, relevance, controversy, surprise,
   shareability, standalone context, completeness, opening, ending, retention, energy, humor) plus context
   flags. Strategy weights (Balanced, Viral, Educational, Storytelling, Controversial, Emotional, Business,
   Comedy, High Energy, Gaming, Custom) produce the 0–100 **Predicted Performance Potential**.
5. **Filter, de-duplicate, rank.** The top clip becomes **#1 BEST CLIP**, and its publishing package is
   generated from its own transcript plus a real source frame.

### Captions (English / Hinglish / Original)

- Captions always come from **real word timestamps**. Segmentation is an optimal dynamic program over
  natural break points: sentence ends, pauses, commas, and breaks before connectives, including
  Hinglish/Urdu ones such as *ke, ki, aur, lekin, toh, kyunki, matlab…*. It also avoids dangling words.
  Example (a unit test):
  `Guys aaj hum basically ye dekhne wale hain` / `ke business ko scale kaise karna hai.`
- **Auto** keeps the creator's style; **English** translates non-English speech naturally; **Hinglish**
  romanizes Devanagari/Urdu script while keeping English words; **Original** shows words as transcribed.
  Translations are cached per sentence, so boundary edits don't re-translate.
- For Hinglish speech with Whisper-family engines the worker adds a Roman-Hinglish style prompt so output
  stays in natural Roman script. Deepgram uses `language=multi` (code-switching).
- Styles: Clean, Bold, Podcast, Minimal, Highlight, plus font, size, position, margin, chars/line, lines,
  colors, background box, outline, shadow, word highlighting and uppercase. The browser preview uses the
  same geometry as the libass (ASS) burn-in.

---

## 2. Repository layout

```
apps/web/        Next.js 16 (App Router) UI + API route handlers → Netlify
apps/worker/     Background worker (FFmpeg, yt-dlp, STT, LLM, rendering) → container host
  python/        faster-whisper transcription script (optional local STT)
packages/shared/ Pure TS: statuses, errors, scoring, captions, timeline/cut mapping, language detection
packages/db/     Drizzle schema, SQL migrations, Postgres job queue
packages/services/ S3-compatible storage (multipart, presign) and secret encryption
```

### Files added (this is a new repository)

- Root: `package.json` (npm workspaces), `tsconfig.base.json`, `.env.example`, `netlify.toml`,
  `docker-compose.yml`, `.dockerignore`, `.gitignore`, `README.md`
- `packages/shared/src/*`: `time`, `statuses`, `errors`, `scoring`, `settings`, `transcript`, `captions`,
  `language`, `youtube`, `publishing`, tests
- `packages/db`: `src/schema.ts`, `src/client.ts`, `src/queue.ts`, `src/migrate.ts`, `migrations/0000_init.sql`
- `packages/services/src`: `storage.ts`, `secrets.ts`
- `apps/worker`: `Dockerfile`, `fly.toml`, `python/transcribe.py`, and `src/` (`index`, `runner`, `config`,
  `providers`, `media/*`, `stt/*`, `llm/*`, `analysis/*`, `jobs/*`, tests)
- `apps/web/src`: `proxy.ts` (auth gate), `lib/*`, `components/*` (UI kit, shell, results, editor),
  `app/(auth)/*`, `app/(app)/*` pages, `app/api/**` route handlers

---

## 3. Environment variables

All variables are documented in [`.env.example`](.env.example). Minimum sets:

| Where | Required |
|---|---|
| **Web (Netlify)** | `DATABASE_URL` (pooled), `AUTH_SECRET`, `APP_ENCRYPTION_KEY`, `STORAGE_BUCKET`, `STORAGE_ENDPOINT` (R2), `STORAGE_REGION`, `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY`. Optional: `YOUTUBE_API_KEY`, `ALLOW_SIGNUPS`, `MAX_UPLOAD_BYTES`, `DATABASE_POOL_MAX=3` |
| **Worker** | `DATABASE_URL`, `APP_ENCRYPTION_KEY`, all `STORAGE_*`, `ANTHROPIC_API_KEY` (or `LLM_PROVIDER=openai` + `OPENAI_API_KEY`), one STT option: `DEEPGRAM_API_KEY` / `OPENAI_API_KEY` / `GROQ_API_KEY` / `STT_PROVIDER=local`. Recommended: `RUN_MIGRATIONS=true` |

API keys live only on the server. Users can also add their own keys in **Settings**. Those are stored
AES-256-GCM encrypted, are write-only (the browser only ever sees a masked suffix), and override the
server keys for that user's jobs.

Model choice: `ANTHROPIC_MODEL` defaults to `claude-opus-5`. Set `ANTHROPIC_FAST_MODEL=claude-sonnet-5` to
make the high-volume passes (topic mapping, caption translation) cheaper. Use Claude 4.6+/5-family models,
because requests use adaptive thinking, effort and structured outputs.

---

## 4. Local setup

Prerequisites: Node 22+, Docker (for Postgres + MinIO), or your own Postgres/S3.

```bash
npm install
cp .env.example .env
# fill in: AUTH_SECRET (openssl rand -base64 48), APP_ENCRYPTION_KEY (openssl rand -base64 32),
#          ANTHROPIC_API_KEY and one speech key (e.g. DEEPGRAM_API_KEY)
# for docker-compose infra use:
#   DATABASE_URL=postgres://postgres:postgres@localhost:5432/longcut
#   STORAGE_BUCKET=longcut STORAGE_ENDPOINT=http://localhost:9000 STORAGE_REGION=us-east-1
#   STORAGE_ACCESS_KEY_ID=minioadmin STORAGE_SECRET_ACCESS_KEY=minioadmin STORAGE_FORCE_PATH_STYLE=true

docker compose up -d postgres minio minio-init   # infra only
npm run db:migrate                                # create tables
npm run dev:web                                   # http://localhost:3000
npm run dev:worker                                # needs ffmpeg + yt-dlp on PATH
# …or run the worker in Docker instead:  docker compose up -d worker
```

Checks:

```bash
npm run typecheck
npm test                                   # unit + FFmpeg media tests
E2E=1 npx vitest run e2e -w @longcut/worker   # drains the real queue; AI APIs replaced by test doubles
```

---

## 5. Netlify deployment (web app)

1. Push the repo and **Add new site → Import from Git**. `netlify.toml` sets the build command to
   `npm run build:web`, the publish directory to `apps/web/.next`, and the Next.js runtime plugin. If
   Netlify's monorepo detection asks for a package directory, choose `apps/web`.
2. Under **Site configuration → Environment variables**, add the web variables from §3. Use a *pooled*
   Postgres URL (Supabase pooler on port 6543, or Neon's `-pooler` host) and `DATABASE_POOL_MAX=3`.
3. Deploy. Route handlers only do light work: auth, presigning, DB reads/writes and enqueueing. They
   finish in milliseconds, well inside Netlify Function limits. **No video processing runs on Netlify.**
4. Add your Netlify domain to the storage bucket's CORS rules (see §7).

---

## 6. Worker deployment

The worker is one Docker image (`apps/worker/Dockerfile`, built from the repo root). It contains Node,
FFmpeg (with libass), yt-dlp, and fonts (Inter, Montserrat, Roboto, Noto incl. Devanagari/Arabic, Liberation).

**Fly.io (recommended default)**

```bash
fly launch --no-deploy --config apps/worker/fly.toml --dockerfile apps/worker/Dockerfile
fly volumes create longcut_tmp --size 100          # temp disk for downloads/renders
fly secrets set DATABASE_URL=... APP_ENCRYPTION_KEY=... STORAGE_BUCKET=... STORAGE_ENDPOINT=... \
  STORAGE_REGION=auto STORAGE_ACCESS_KEY_ID=... STORAGE_SECRET_ACCESS_KEY=... \
  ANTHROPIC_API_KEY=... DEEPGRAM_API_KEY=...
fly deploy --config apps/worker/fly.toml --dockerfile apps/worker/Dockerfile .
```

**Railway / Render:** create a service from the repo using `apps/worker/Dockerfile` (root context), attach a
volume at `/data`, set the worker env vars and `RUN_MIGRATIONS=true`. The health check is `GET /` on `$PORT`.

**Sizing.** Transcription and analysis are API-bound when you use Deepgram/Groq/OpenAI plus Claude, so a
4 vCPU / 8 GB machine handles 10-hour sources. Rendering is CPU-bound: libx264 `medium` renders a 1080p
10-minute clip in roughly 2–5 minutes on 4 vCPU. Add replicas, or split roles
(`WORKER_ROLES=heavy` / `WORKER_ROLES=light`) to scale renders independently of LLM jobs. Size the temp
disk for YouTube sources (a 10-hour 1080p download is about 10–20 GB).

**GPU / self-hosted speech:** build with `--build-arg INSTALL_WHISPER=true`, set `STT_PROVIDER=local`,
`LOCAL_WHISPER_DEVICE=cuda`, `LOCAL_WHISPER_COMPUTE_TYPE=float16`, `TRANSCRIBE_CONCURRENCY=1`, and run it on
a GPU host (RunPod, Lambda, a GPU VPS). `RENDER_ENCODER=h264_nvenc` uses NVENC for renders.

Graceful shutdown: on SIGTERM the worker stops claiming jobs and gives running ones 25 s to finish.
Anything unfinished is resumed by another worker from its checkpoints once the lease expires.

---

## 7. Database & storage setup

**Postgres** (Supabase, Neon, Railway, RDS…): create a database, then run `npm run db:migrate` with its
`DATABASE_URL`, or let the worker migrate on boot with `RUN_MIGRATIONS=true`. Tables: `users`,
`user_settings`, `projects`, `transcripts`, `transcript_chunks`, `analyses`, `clips`,
`sentence_translations`, `exports`, `jobs`.

**Cloudflare R2** (or S3):

1. Create a bucket (e.g. `longcut`) and an API token with Object Read & Write. Set `STORAGE_ENDPOINT` to
   `https://<account-id>.r2.cloudflarestorage.com` and `STORAGE_REGION=auto`.
2. **CORS** (required: browsers upload parts directly and must be able to read the `ETag` header):

```json
[
  {
    "AllowedOrigins": ["https://your-site.netlify.app", "http://localhost:3000"],
    "AllowedMethods": ["GET", "PUT", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

3. **Lifecycle:** add a rule that aborts incomplete multipart uploads after 7 days. The worker's hourly
   sweep also aborts abandoned uploads, expires exports per each user's cleanup policy, optionally purges
   intermediates, and clears stale temp dirs.

Storage layout: `users/<userId>/projects/<projectId>/{source/, work/audio.ogg, work/preview.mp4,
work/waveform.bin, thumb.jpg, clips/<clipId>/frame.jpg, exports/<exportId>/…}`. Objects are only ever served
through short-lived presigned URLs, which are generated after an ownership check.

---

## 8. API

All routes require the session cookie and only return the caller's own resources (unknown or foreign IDs → 404).

| Method & path | Purpose |
|---|---|
| `POST /api/auth/signup` · `login` · `logout`, `GET /api/auth/me` | Email/password auth (bcrypt, HS256 JWT in an httpOnly cookie) |
| `GET/POST /api/projects` | List / create (upload or YouTube) |
| `GET/PATCH/DELETE /api/projects/:id` | Detail (signed media URLs), rename, delete (+ async storage cleanup) |
| `POST /api/uploads` · `/sign` · `/complete` · `/abort`, `GET /api/uploads/parts` | Resumable multipart upload |
| `POST /api/youtube` | Validate URL, title, channel, thumbnail, duration |
| `POST /api/projects/:id/process` | Start/resume the pipeline (idempotent) |
| `GET /api/projects/:id/status` | Poll status, progress, active jobs |
| `GET /api/projects/:id/transcript` | Full / time window (`from`,`to`,`words=1`) / search (`q`) |
| `POST /api/projects/:id/analyze` | Re-run clip detection on the saved transcript |
| `POST /api/projects/:id/rerank` | Instant re-rank for a performance strategy |
| `GET/POST /api/projects/:id/clips` | List ranked clips / create a manual clip |
| `GET/PATCH/DELETE /api/clips/:id` | Clip; edit bounds, cuts, title, caption style/language; reset |
| `POST /api/clips/:id/package` | Generate the publishing package |
| `GET/POST /api/clips/:id/captions` | Cues / SRT / VTT; generate a translated/romanized language |
| `POST /api/clips/:id/render` · `/export` | Render with defaults / with explicit export options |
| `POST /api/exports/batch`, `GET /api/exports`, `GET /api/exports/:id/status`, `GET /api/exports/:id/download` | Batch exports, history, status, signed download |
| `GET /api/jobs` · `GET/PUT /api/settings` | Processing page · settings (keys are write-only) |

---

## 9. Known limitations

- **Verified locally, not on live providers.** In this build environment the full pipeline ran end to end
  against real Postgres, S3-compatible storage (moto), FFmpeg and the real web API and job runner. Only
  Deepgram/Whisper and Claude were replaced by test doubles (no API keys were available). Prompt quality
  on real 5–10 hour content should be reviewed on real content before launch.
- The Netlify config (`netlify.toml`) and the worker Dockerfile follow the platforms' documented monorepo
  and Next.js setups but have not been deployed from here.
- Speaker labels come from per-chunk diarization (Deepgram), so speaker numbers can change between
  10-minute chunks.
- The browser preview plays MP4/WebM directly. Other formats (MKV, AVI, HEVC, ProRes, >1080p) play
  after the background 540p proxy is built (roughly 5–15% of real time on 4 vCPU).
- Exports keep the source aspect ratio. There is no vertical 9:16 reframing, because the product targets
  long-form horizontal clips.
- The full transcript is stored as one JSONB document (~5–10 MB for 10 hours), read whole for editor
  windows and caption requests.
- Auth is email/password with no email verification, password reset or rate limiting yet. Put Netlify
  rate-limit rules or a WAF in front of `/api/auth/*`.
- Word-level highlighting after an English *translation* uses proportionally distributed timings, because
  translated words don't map 1:1 to spoken words.
- AI-generated thumbnails are prompts only. No image model is wired in.

## 10. Recommended next steps

1. Run a prompt-quality evaluation on real 3–10 hour streams, and tune the section/candidate/refine
   prompts and strategy weights against editor judgments.
2. Store transcripts in per-chunk rows, or in storage with a sentence index, instead of one JSONB document.
3. Server-sent events or websockets for status, replacing polling.
4. OAuth sign-in (Google), email verification, password reset and API rate limiting.
5. Per-user usage metering and cost caps (STT minutes, LLM tokens, render minutes).
6. Speaker-consistent diarization across chunks (embedding clustering), plus speaker names.
7. GPU render pool (NVENC) and a separate autoscaled light-job pool.
8. Direct publishing to YouTube/Facebook, and an image-model integration for thumbnails.
9. Observability: structured logs → Loki/Datadog, job metrics, alerting on repeated failures.
