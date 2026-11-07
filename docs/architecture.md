# Architecture

```
┌────────────────────────── Electron ──────────────────────────┐
│ renderer (React/TS, sandboxed)      main process (Node)      │
│  pages, editor, stores  ──preload──▶ ipc/media    ffprobe    │
│  preview compositor       typed      ipc/projects JSON files │
│  text rasteriser (canvas) bridge     ipc/export   FFmpeg     │
└──────────────┬───────────────────────────────┬───────────────┘
               │ Supabase JS (anon key, RLS)   │ vcmedia:// streams local files
               ▼                               ▼
        Supabase Auth / Storage          user's disk (originals stay here)
               │ Bearer JWT
               ▼
        Express API  ──Prisma──▶  PostgreSQL (Supabase)
```

## Key decisions
- **Local-first.** `project.json` in the app data folder is the source of truth. Cloud sync is opt-in and best-effort.
- **Project model** (`src/types/project.ts`) is shared by editor, export and server. All edits are pure functions in `src/editor/timeline/ops.ts` (unit-tested) → trivial undo/redo (`editorStore` keeps immutable snapshots).
- **Preview ≈ export.** Both use the same maths: `anim.ts` (keyframes, transitions) and a single text rasteriser (`renderText.ts`) that produces PNGs for the preview *and* for FFmpeg overlays (no `drawtext`/font dependency).
- **Export** (`electron/export/buildArgs.ts`) is a pure function that turns the timeline into one `filter_complex` graph; `ipc/export.ts` spawns FFmpeg, parses `-progress`, supports cancel (process tree kill) and cleans temp files.
- **Security.** `contextIsolation`, `sandbox`, CSP, navigation lock, a whitelisted preload API, path-whitelisted `vcmedia://` protocol, IDs validated before touching the file system, zod validation on every API input, helmet, rate-limit, token verification through Supabase Auth.
- **Crash recovery.** Autosave writes `autosave.json` every N seconds while dirty; opening a project offers to restore a newer autosave. Each explicit save keeps a rolling history (15 versions).

## Subscriptions
Tables `subscriptions` (plan, status, limits JSON, provider fields) and `users.subscription_plan` exist and the API enforces `maxProjects`. **No payment processing is implemented.** To add paid plans, integrate a legitimate provider (e.g. Stripe Checkout + webhook that updates `subscriptions` using a server-side secret) — until then every account is `free`.

## Known limitations (honest list)
- **Auto subtitles** run offline through whisper.cpp (`electron/ipc/subtitles.ts`): engine + English model are downloaded on request, checksum-verified, and kept under userData/whisper. English only.
- **Motion tracking** (`src/utils/tracker.ts`, `electron/ipc/tracking.ts`) is SAD block matching with sub-pixel refinement on 320 px grayscale frames at 15 fps. It follows translation only and reports where it loses the target. Results are written as x/y keyframes; crop/rotation/flip of the tracked clip are not accounted for.
- **Two-pass stabilisation** (vidstab) is *not used*: the Windows FFmpeg build fails to re-read its `.trf` file ("Cannot parse localmotion!"), so "Stabilize" uses single-pass `deshake`.
- Preview does not render: sharpen, glow, grain/noise, chromatic aberration, chroma key, LUTs, reversed playback (steps frames), stabilize. They are applied on export.
- Reverse needs the clip segment in RAM during export.
- Cross-dissolve is an alpha fade: place the overlapping clip on a track below to see a true dissolve.
- Dragging moves one clip at a time; multi-select supports delete/duplicate/property edits.
- Cloud media upload plumbing (`uploadMediaToCloud`, bucket + RLS) exists; there is no bulk-upload UI yet.
