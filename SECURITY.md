# Security Policy

## Reporting a vulnerability
Please **do not open a public issue** for security problems. Use GitHub's *Report a vulnerability* (Security → Advisories) on this repository, or email the maintainers. Include steps to reproduce and the affected version. We aim to acknowledge within 3 business days.

## Supported versions
Only the latest release receives security fixes.

## Security design
| Topic | Measure |
|---|---|
| Passwords | Never stored by VisionCut. Supabase Auth keeps a salted bcrypt hash in its private `auth` schema; `public.users` has no password column. |
| Secrets | `.env` is git-ignored. The Supabase **service-role key is never used** by the app or the API. Only the public anon key ships in the client. |
| Database | Row Level Security on every table (`docs/supabase.sql`, verified by `tests/rls.test.ts`); users cannot change their own plan. The API derives the user id **only** from a verified token and checks ownership on every query. |
| API | Token verified against Supabase Auth, zod validation on all inputs, helmet headers, rate limiting, body size limit, no stack traces in responses, 403/404 on cross-account access (tested). |
| Electron | `contextIsolation`, `sandbox`, `nodeIntegration: false`, strict CSP, navigation and `window.open` locked down, minimal typed preload API, microphone is the only permission granted. |
| Local files | Media is served through a `vcmedia://` protocol limited to media extensions; project/export ids are validated to prevent path traversal; JSON written atomically. |
| Privacy | Original media is never uploaded automatically. Cloud sync and media upload are separate opt-in switches (off by default). Cloud copies of projects contain file *names*, not local paths. |
| FFmpeg | Spawned with an argument array (no shell), so file names cannot inject commands. Temporary files are removed after every export. |

## Hardening checklist for deployers
- Rotate any key that was ever committed. Keep `DATABASE_URL` server-side only.
- Run the API behind HTTPS (reverse proxy) and set `CORS_ORIGINS` explicitly.
- Sign the Windows installer (code-signing certificate).
- Keep Electron and dependencies updated (`npm audit`).
