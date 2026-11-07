// Integration test: the REAL Express API + Prisma against a REAL (embedded) PostgreSQL.
// Only Supabase token verification is faked (we cannot call Supabase in CI).
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import request from 'supertest'
import { embeddedPgAvailable, startTestPg, type TestPg } from './helpers/pg'
import { PrismaClient } from '@prisma/client'
import { createApp } from '../server/app'
import type { AuthUser, TokenVerifier } from '../server/middleware/auth'

const PORT = 54329
let url = ''
let pg: TestPg
let db: PrismaClient
let app: ReturnType<typeof createApp>

const users: Record<string, AuthUser> = {
  tokA: { id: '11111111-1111-4111-8111-111111111111', email: 'a@example.com', fullName: 'Alice A' },
  tokB: { id: '22222222-2222-4222-8222-222222222222', email: 'b@example.com', fullName: 'Bob B' },
}
const verify: TokenVerifier = async (t) => users[t] ?? null

const proj = (id: string, extra: Record<string, unknown> = {}) => ({
  name: 'My cut',
  settings: { width: 1920, height: 1080, fps: 30, aspectLabel: '16:9 Landscape', backgroundColor: '#000000' },
  data: { id, tracks: [], clips: [], media: [{ name: 'a.mp4', kind: 'video', size: 1234, path: 'a.mp4' }], ...extra },
})
const A = (r: request.Test) => r.set('Authorization', 'Bearer tokA')
const B = (r: request.Test) => r.set('Authorization', 'Bearer tokB')

beforeAll(async () => {
  if (!embeddedPgAvailable()) return
  pg = startTestPg(PORT)
  url = pg.url
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'db', 'push', '--skip-generate', '--accept-data-loss'], { env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe' })
  db = new PrismaClient({ datasources: { db: { url } } })
  app = createApp({ db, verify, corsOrigins: [] })
}, 240000)

afterAll(async () => {
  await db?.$disconnect()
  pg?.stop()
})

describe.skipIf(!embeddedPgAvailable())('API security', () => {
  it('rejects missing / invalid tokens', async () => {
    expect((await request(app).get('/api/projects')).status).toBe(401)
    expect((await request(app).get('/api/projects').set('Authorization', 'Bearer nope')).status).toBe(401)
  })
  it('health is public, unknown routes 404, no x-powered-by', async () => {
    const r = await request(app).get('/health')
    expect(r.status).toBe(200)
    expect(r.headers['x-powered-by']).toBeUndefined()
    expect((await A(request(app).get('/nothing'))).status).toBe(404)
  })
})

describe.skipIf(!embeddedPgAvailable())('projects', () => {
  it('creates, lists, reads, updates and deletes a project for its owner', async () => {
    const put = await A(request(app).put('/api/projects/prj_one').send(proj('prj_one')))
    expect(put.status).toBe(200)
    expect((await A(request(app).get('/api/projects'))).body.map((p: { id: string }) => p.id)).toEqual(['prj_one'])
    const got = await A(request(app).get('/api/projects/prj_one'))
    expect(got.body.data.id).toBe('prj_one')
    expect((await A(request(app).put('/api/projects/prj_one').send({ ...proj('prj_one'), name: 'Renamed' }))).status).toBe(200)
    expect((await A(request(app).get('/api/projects/prj_one'))).body.name).toBe('Renamed')
    // metadata mirrored into project_files and project_settings, never marked as uploaded
    const files = await db.projectFile.findMany({ where: { projectId: 'prj_one' } })
    expect(files).toHaveLength(1)
    expect(files[0].storagePath).toBeNull()
    expect((await db.projectSetting.findUnique({ where: { projectId: 'prj_one' } }))?.width).toBe(1920)
    expect((await A(request(app).delete('/api/projects/prj_one'))).status).toBe(204)
    expect((await A(request(app).get('/api/projects/prj_one'))).status).toBe(404)
  })

  it('isolates users: B cannot read, overwrite or delete A\'s project', async () => {
    await A(request(app).put('/api/projects/prj_priv').send(proj('prj_priv')))
    expect((await B(request(app).get('/api/projects/prj_priv'))).status).toBe(404)
    expect((await B(request(app).put('/api/projects/prj_priv').send(proj('prj_priv')))).status).toBe(403)
    expect((await B(request(app).delete('/api/projects/prj_priv'))).status).toBe(404)
    expect((await B(request(app).get('/api/projects'))).body).toEqual([])
  })

  it('validates input', async () => {
    expect((await A(request(app).put('/api/projects/x').send(proj('x')))).status).toBe(400) // id too short
    expect((await A(request(app).put('/api/projects/prj_bad').send({ name: '', data: {}, settings: {} }))).status).toBe(400)
    expect((await A(request(app).put('/api/projects/..%2F..%2Fetc').send(proj('x')))).status).toBe(400)
  })

  it('enforces the free plan project limit (402)', async () => {
    const ids = ['prj_l1', 'prj_l2', 'prj_l3', 'prj_l4', 'prj_l5']
    for (const id of ids) await A(request(app).put(`/api/projects/${id}`).send(proj(id)))
    const over = await A(request(app).put('/api/projects/prj_l6').send(proj('prj_l6')))
    expect(over.status).toBe(402)
  })
})

describe.skipIf(!embeddedPgAvailable())('profile, exports, preferences', () => {
  it('returns profile + subscription and creates default rows', async () => {
    const me = await A(request(app).get('/api/me'))
    expect(me.body.profile.plan).toBe('free')
    expect(me.body.subscription.limits.maxProjects).toBe(5)
    expect(me.body.preferences.cloudUploadEnabled).toBe(false) // consent defaults OFF
  })
  it('records export history', async () => {
    const r = await A(request(app).post('/api/exports').send({ format: 'mp4', codec: 'h264', resolution: '1080p', fps: 30, sizeBytes: 5000, durationSec: 12.5 }))
    expect(r.status).toBe(201)
    expect((await A(request(app).get('/api/exports'))).body[0].sizeBytes).toBe(5000)
    expect((await A(request(app).post('/api/exports').send({ format: 'exe' }))).status).toBe(400)
  })
  it('updates preferences strictly', async () => {
    expect((await A(request(app).put('/api/preferences').send({ cloudSyncEnabled: true }))).body.cloudSyncEnabled).toBe(true)
    expect((await A(request(app).put('/api/preferences').send({ userId: 'other' }))).status).toBe(400)
  })
})

