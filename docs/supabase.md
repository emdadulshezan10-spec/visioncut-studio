# Supabase setup

VisionCut works **without** Supabase in *local mode* (no accounts, projects stored on your PC). Follow this guide to enable sign-in, profiles and optional cloud sync.

## 1. Create the project
1. Create a free project at <https://supabase.com>.
2. **Project Settings → API**: copy the *Project URL* and the **anon / public** key.
3. **Project Settings → Database → Connection string (URI)**: copy it (use the *Session pooler* string if your network lacks IPv6).

## 2. Configure `.env`
```bash
copy .env.example .env
```
Fill in `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` and `DATABASE_URL`.

> ⚠️ **Never** put the `service_role` key in `.env` for the desktop app or commit it anywhere. The desktop app uses only the public anon key; Row Level Security protects the data. The API server does not need the service-role key either.

`VITE_*` values are baked into the app at build time (they are public by design).

## 3. Create the tables
```bash
npm run db:push
```
Then open **SQL Editor** in Supabase, paste `docs/supabase.sql` and run it. This adds the auth foreign key, the sign-up trigger, Row Level Security policies, and the private `avatars` / `project-media` storage buckets.

## 4. Authentication settings (Authentication → …)
| Setting | Value |
|---|---|
| Providers → Email | enabled, **Confirm email** ON |
| Providers → Google (optional) | enable and add your Google OAuth client ID/secret |
| URL Configuration → Redirect URLs | add `visioncut://auth-callback` (needed for Google sign-in) |
| Email Templates → **Confirm signup** | include the code: `Your code: {{ .Token }}` |
| Email Templates → **Reset password** | include the code: `Your code: {{ .Token }}` |

The desktop app uses **6-digit email codes** (not browser links) for verification and password reset, so the templates must contain `{{ .Token }}`.

> **Free-plan note:** Supabase only lets you edit email templates after you connect a custom SMTP provider (Authentication → Emails → SMTP Settings), and its built-in sender is heavily rate-limited. Without SMTP the code emails cannot work. For local testing you may switch **Confirm email OFF** so sign-up logs in immediately — but that lets anyone register an address they do not own, so turn it back ON (with SMTP) before releasing.

**No database password handy?** Skip `npm run db:push` and generate the schema SQL instead, then run it in the SQL Editor before `docs/supabase.sql`:
```bash
npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script
```

## 5. Run the API server (cloud sync)
```bash
npm run server        # http://localhost:4000
```
Then set `VITE_API_URL` if you host it elsewhere. In the app: **Settings → Cloud & privacy → Sync project files**.

## Privacy model
- Original media never leaves your computer unless you enable *Allow uploading media* **and** upload explicitly.
- Cloud sync sends only the project timeline JSON with file *names* (not folder paths).
- Row Level Security: every table is locked to `auth.uid()`; users cannot change their own `subscription_plan`.
