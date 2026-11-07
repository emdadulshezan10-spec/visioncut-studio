# Contributing to VisionCut Studio

Thanks for helping! This guide gets you from clone to pull request.

## Setup
```bash
git clone <repo> && cd visioncut-studio     # use a SHORT path, e.g. C:\dev\visioncut-studio
npm install
npm run dev
```
Node.js 20+ on Windows 10/11. No Supabase account is needed for editor work (local mode).

## Workflow
1. Fork, then branch from `main`: `git checkout -b feat/short-description`.
2. Make focused changes. Keep modules small; put pure logic in testable functions (see `src/editor/timeline/ops.ts`, `electron/export/buildArgs.ts`).
3. Run **`npm run typecheck && npm test`** — both must pass. For changes touching export/timeline/IPC also run `npm run test:e2e`.
4. Open a PR using the template. Describe *what* and *why*, and include a screenshot/GIF for UI changes.

## Code guidelines
- TypeScript `strict`; no `any` unless justified in a comment.
- Renderer code never imports Electron or Node modules — go through the typed preload API (`electron/preload.ts` ↔ `src/types/electron.d.ts`; update both).
- Every IPC handler must validate its inputs (types, allowed paths/ids) — the renderer is untrusted.
- Timeline edits are **pure functions** returning a new `Project`; add a unit test for each new operation.
- New export features must be added to `buildArgs.ts` **and** verified by a real FFmpeg render in `tests/export.test.ts`.
- Keep the preview and export maths in sync (`src/utils/anim.ts`, `src/editor/preview/layout.ts`).
- Don't claim a feature in the UI/README unless it works end-to-end.

## Security rules (non-negotiable)
- Never commit `.env`, API keys, passwords, tokens or the Supabase **service-role** key. Use `.env.example` for names only.
- Never log secrets or user media paths to remote services.
- Report vulnerabilities privately — see [SECURITY.md](SECURITY.md).

## Commit messages
Imperative mood, ≤72-char subject: `Fix ripple delete across locked tracks`.

## Tests
| Suite | File | Needs |
|---|---|---|
| Timeline/export helpers | `tests/timeline.test.ts` | — |
| Real FFmpeg renders | `tests/export.test.ts` | `ffmpeg` on PATH |
| API + database | `tests/server.test.ts` | embedded PostgreSQL (auto) |
| Supabase RLS SQL | `tests/rls.test.ts` | embedded PostgreSQL (auto) |
| End-to-end app | `scripts/e2e-smoke.mjs` | built app + FFmpeg |
