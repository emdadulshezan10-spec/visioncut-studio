// Verifies docs/supabase.sql on a real PostgreSQL: the sign-up trigger and Row Level Security actually isolate users.
// Supabase's own `auth` / `storage` schemas are stubbed (minimal tables + auth.uid()).
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { PrismaClient } from '@prisma/client'
import { embeddedPgAvailable, startTestPg, type TestPg } from './helpers/pg'

const PORT = 54330
const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
let pg: TestPg
let db: PrismaClient

/** Splits SQL into statements without breaking `$$ ... $$` function bodies. */
function statements(sql: string): string[] {
  const out: string[] = []
  let cur = ''
  let inDollar = false
  for (const line of sql.split('\n')) {
    if (!inDollar && line.trim().startsWith('--')) continue
    cur += line + '\n'
    if ((line.match(/\$\$/g) ?? []).length % 2 === 1) inDollar = !inDollar
    if (!inDollar && line.trimEnd().endsWith(';')) { out.push(cur.trim()); cur = '' }
  }
  return out.filter(Boolean)
}

/** Runs queries as a Supabase "authenticated" user (role + auth.uid() claim), inside a rolled-back transaction. */
async function asUser<T>(uid: string, fn: (tx: PrismaClient) => Promise<T>): Promise<T> {
  class Rollback extends Error { constructor(public value: T) { super('rollback') } }
  try {
    await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('set local role authenticated')
      await tx.$executeRawUnsafe(`select set_config('request.jwt.claim.sub', '${uid}', true)`)
      throw new Rollback(await fn(tx as unknown as PrismaClient))
    })
  } catch (e) {
    if (e instanceof Rollback) return e.value
    throw e
  }
  throw new Error('unreachable')
}

describe.skipIf(!embeddedPgAvailable())('Supabase SQL (docs/supabase.sql)', () => {
  beforeAll(async () => {
    pg = startTestPg(PORT)
    execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'db', 'push', '--skip-generate', '--accept-data-loss'], { env: { ...process.env, DATABASE_URL: pg.url }, stdio: 'pipe' })
    db = new PrismaClient({ datasources: { db: { url: pg.url } } })
    const stub = `
      create role anon nologin;
      create role authenticated nologin;
      create schema auth;
      create schema storage;
      create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
      create table storage.objects (id uuid default gen_random_uuid(), bucket_id text, name text);
      create function storage.foldername(name text) returns text[] language sql as $$ select string_to_array(name, '/') $$;
      alter table storage.objects enable row level security;
      grant usage on schema public, auth, storage to anon, authenticated;
      grant select, insert, update, delete on all tables in schema public to authenticated;
      grant usage on all sequences in schema public to authenticated;
      grant select, insert, update, delete on all tables in schema storage to authenticated;
    `
    for (const s of statements(stub)) await db.$executeRawUnsafe(s)
    for (const s of statements(fs.readFileSync(path.join(process.cwd(), 'docs', 'supabase.sql'), 'utf8'))) await db.$executeRawUnsafe(s)
    // sign-up trigger fires for these inserts
    await db.$executeRawUnsafe(`insert into auth.users values ('${A}', 'a@example.com', '{"full_name":"Alice"}')`)
    await db.$executeRawUnsafe(`insert into auth.users values ('${B}', 'b@example.com', '{}')`)
    await db.$executeRawUnsafe(`insert into projects (id, user_id, name, data, updated_at) values ('prj_a', '${A}', 'A secret', '{}', now()), ('prj_b', '${B}', 'B secret', '{}', now())`)
  }, 240000)

  afterAll(async () => { await db?.$disconnect(); pg?.stop() })

  it('trigger creates profile, free subscription and preferences at sign-up', async () => {
    const u = await db.user.findUnique({ where: { id: A }, include: { subscription: true, preferences: true } })
    expect(u?.fullName).toBe('Alice'); expect(u?.subscriptionPlan).toBe('free')
    expect(u?.subscription?.plan).toBe('free'); expect(u?.preferences?.cloudUploadEnabled).toBe(false)
    expect((await db.user.findUnique({ where: { id: B } }))?.fullName).toBe('b') // falls back to email prefix
  })

  it('a user only sees their own projects', async () => {
    const rows = await asUser(A, (tx) => tx.$queryRawUnsafe<{ id: string }[]>('select id from projects'))
    expect(rows.map((r) => r.id)).toEqual(['prj_a'])
  })

  it('a user cannot update or delete another user\'s project', async () => {
    const n = await asUser(A, (tx) => tx.$executeRawUnsafe(`update projects set name = 'hacked' where id = 'prj_b'`))
    expect(n).toBe(0)
    const d = await asUser(A, (tx) => tx.$executeRawUnsafe(`delete from projects where id = 'prj_b'`))
    expect(d).toBe(0)
  })

  it('a user cannot insert a project for someone else', async () => {
    await expect(asUser(A, (tx) => tx.$executeRawUnsafe(`insert into projects (id, user_id, name, data, updated_at) values ('prj_x', '${B}', 'x', '{}', now())`))).rejects.toThrow()
  })

  it('a user cannot grant themselves a paid plan (column privileges + RLS)', async () => {
    await expect(asUser(A, (tx) => tx.$executeRawUnsafe(`update users set subscription_plan = 'premium' where id = '${A}'`))).rejects.toThrow(/permission denied/)
    // subscriptions has no UPDATE policy: RLS silently filters the row out, so 0 rows change
    expect(await asUser(A, (tx) => tx.$executeRawUnsafe(`update subscriptions set plan = 'premium' where user_id = '${A}'`))).toBe(0)
    // ...but may edit allowed profile columns
    expect(await asUser(A, (tx) => tx.$executeRawUnsafe(`update users set full_name = 'Alice 2' where id = '${A}'`))).toBe(1)
    // ...and not someone else's
    expect(await asUser(A, (tx) => tx.$executeRawUnsafe(`update users set full_name = 'x' where id = '${B}'`))).toBe(0)
  })

  it('storage objects are limited to the user\'s own folder', async () => {
    await db.$executeRawUnsafe(`insert into storage.objects (bucket_id, name) values ('avatars', '${A}/a.png'), ('avatars', '${B}/b.png')`)
    const rows = await asUser(A, (tx) => tx.$queryRawUnsafe<{ name: string }[]>(`select name from storage.objects where bucket_id = 'avatars'`))
    expect(rows.map((r) => r.name)).toEqual([`${A}/a.png`])
  })

  it('anonymous (not signed in) role sees nothing', async () => {
    class Rb extends Error {}
    let n = -1
    try {
      await db.$transaction(async (tx) => { await tx.$executeRawUnsafe('set local role anon'); n = (await tx.$queryRawUnsafe<unknown[]>('select 1 from projects')).length; throw new Rb() })
    } catch (e) { if (!(e instanceof Rb) && !/permission denied/.test(String(e))) throw e }
    expect(n === 0 || n === -1).toBe(true)
  })
})
