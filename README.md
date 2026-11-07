# VisionCut Studio

A professional desktop video editor for Windows — multi-track timeline, real-time preview, colour grading, effects, transitions, text, audio tools and **real FFmpeg export**.
Built with Electron, React, TypeScript, Tailwind, Zustand, FFmpeg, Express, Prisma/PostgreSQL and Supabase.

> **Status: v0.1.0 — working core.** What is implemented, tested and what is not is listed honestly below.

## Features

| Area | Implemented |
|---|---|
| **Accounts** | Email/password sign-up, email-code verification, login/logout, remember-me, forgot/reset password (email code), profile (name, picture), Google OAuth (optional), protected UI. Local mode when Supabase isn't configured |
| **Projects** | Create from aspect-ratio templates, rename, duplicate, delete, save, autosave + crash recovery, rolling version history (restore), thumbnails, reopen recent |
| **Media** | Import video/audio/images (dialog or drag & drop), ffprobe metadata, thumbnails, waveforms, folders, search/filter, preview player, proxies, relink missing files, corrupt-file errors |
| **Timeline** | Multi-track video/audio/image/text, drag & drop, move, trim, split, merge, duplicate, delete, ripple delete, magnetic snapping, zoom/scroll, markers, lock/hide/mute tracks, undo/redo (100 steps), freeze frame |
| **Preview** | Live compositing, play/pause, frame stepping, 0.25x–2x speed, loop, preview resolution, fullscreen, timecode |
| **Properties** | Position, scale, rotation, opacity, flip, crop, speed (0.1x–8x, slow/fast-mo, reverse), duration, volume, fades, audio offset, noise reduction, keyframes |
| **Look** | Brightness, contrast, saturation, temperature, tint, exposure, highlights/shadows, RGB, LUT (.cube), filters; blur, gaussian blur, sharpen, glow, vignette, grain, noise, chromatic aberration, mirror, invert, mask, chroma key (green screen), stabilize (deshake) |
| **Transitions** | Fade in/out, cross dissolve, wipe, slide, zoom, blur |
| **Text** | Titles, lower thirds, subtitles (+ `.srt` import), **automatic subtitles** (offline speech-to-text), fonts, colour, size, bold/italic, alignment, outline, shadow, background, animations |
| **Tracking** | **Motion tracking**: lock a title/overlay onto a point in a video; it follows the point via generated x/y keyframes (position only) |
| **Audio** | Waveforms, trimming, volume, fades, multiple tracks, background music, voiceover recording, noise reduction, sync offset |
| **Export** | MP4/MOV/WebM/AVI · H.264/H.265/VP9 · 720p/1080p/1440p/4K · 24/30/60 fps · custom bitrate · progress + ETA · cancel · error messages · size estimate · output folder · notification · history |
| **Backend** | Express API, Prisma schema (7 tables), Supabase Auth token verification, Row Level Security SQL, plan limits |

### Automatic subtitles (offline)
Text tab → **Auto subtitles**. The first use asks permission to download the open-source [whisper.cpp](https://github.com/ggml-org/whisper.cpp) engine (4 MB, GitHub release v1.8.7) and the English `base.en` model (148 MB, Hugging Face). Both are verified against pinned SHA-256 checksums and stored in the app's data folder. Audio is transcribed on your PC and never uploaded. English only; always review the result.

### Not implemented / limitations
- **Payments**: no provider is connected; plans/limits exist in the DB. Everyone is on the free plan.
- **Two-pass stabilisation**: tried with FFmpeg's `vidstab` and dropped, because the Windows FFmpeg build cannot read back its own transform file. "Stabilize" uses single-pass `deshake`.
- **Motion tracking** follows position only (no rotation/scale), needs a textured, visible target, and stops (with a message) when it loses it.
- Auto subtitles are English only.

See [docs/architecture.md](docs/architecture.md) for the full list of preview-vs-export differences.

## Quick start (development)

Requirements: **Windows 10/11**, **Node.js 20+**, npm. FFmpeg is bundled (`ffmpeg-static`); a system FFmpeg on PATH is used first if present (`winget install Gyan.FFmpeg`).

```bash
git clone <your-fork-url> visioncut-studio
cd visioncut-studio
npm install
npm run dev
```
The app starts in **local mode** (no login). Keep the project in a **short folder path** (e.g. `C:\dev\visioncut-studio`): Windows tools such as NSIS and some native binaries fail on paths over 260 characters.

### Commands
| Command | What it does |
|---|---|
| `npm run dev` | Vite + Electron with hot reload |
| `npm run typecheck` | TypeScript for renderer and Node code |
| `npm test` | Unit, FFmpeg, API (real embedded PostgreSQL) and RLS tests |
| `npm run build` | Typecheck + production bundles |
| `npm start` | Build and launch the production bundle |
| `npm run test:e2e` | Drives the real built app: import → edit → save → export → cancel |
| `npm run server` | Start the sync API (needs `.env`) |
| `npm run db:push` | Create/update tables from `prisma/schema.prisma` |
| `npm run dist` | Windows installer → `release/VisionCut Studio Setup x.y.z.exe` |

## Configure Supabase (accounts & cloud)
Step-by-step: **[docs/supabase.md](docs/supabase.md)**. Summary: create a project → copy URL + anon key to `.env` → `npm run db:push` → run `docs/supabase.sql` → set email templates to include `{{ .Token }}`.

## Configure FFmpeg
Resolution order: `VISIONCUT_FFMPEG`/`VISIONCUT_FFPROBE` env vars → `ffmpeg`/`ffprobe` on PATH → bundled `ffmpeg-static`/`ffprobe-static`. Check **Settings → FFmpeg & system** to see which one is used and which encoders/filters are available.
The installer bundles a GPL FFmpeg build ([ffmpeg-static](https://github.com/eugeneware/ffmpeg-static)); if you redistribute the installer you must comply with FFmpeg's licence.

## Build the Windows installer
```bash
npm run dist
```
Output: `release/VisionCut Studio Setup 0.1.0.exe` (NSIS, per-user, choose install folder). The installer is **unsigned** (Windows SmartScreen will warn); add a code-signing certificate in `package.json → build.win` for distribution. Add `build/icon.ico` (256×256) to replace the default Electron icon.

## Project structure
```
electron/   main process, preload bridge, IPC (media, projects, export), FFmpeg graph builder
src/        React app: pages, editor (timeline, preview, media, effects, properties), stores, services
server/     Express API (routes, middleware, services)
prisma/     schema.prisma (users, projects, project_files, project_settings, subscriptions, export_history, user_preferences)
docs/       architecture, Supabase guide + SQL (RLS, triggers, storage)
tests/      unit + integration tests     scripts/  build + e2e helpers
```

## Keyboard shortcuts
`Space` play/pause · `S` split · `Del` delete · `Shift+Del` ripple delete · `Ctrl+D` duplicate · `Ctrl+Z/Y` undo/redo · `Ctrl+S` save · `←/→` frame step · `Home/End` · `M` marker · `+/-` zoom · `Ctrl+Wheel` zoom timeline

## Security & privacy
See [SECURITY.md](SECURITY.md). Highlights: no secrets in the repo, service-role key never used, passwords handled only by Supabase Auth, RLS on all tables, media stays local unless you opt in.

## Contributing / License
[CONTRIBUTING.md](CONTRIBUTING.md) · [MIT](LICENSE)
