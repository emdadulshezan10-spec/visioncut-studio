import { Router } from 'express'
import type { Prisma, PrismaClient } from '@prisma/client'
import { z } from 'zod'
import { HttpError, validateBody } from '../middleware/common'
import { ensureUser } from '../services/users'

const idSchema = z.string().regex(/^[A-Za-z0-9_-]{3,64}$/, 'invalid id')

const projectBody = z.object({
  name: z.string().trim().min(1).max(120),
  // The editor's Project JSON. Shape is validated loosely: the server stores it, it never executes it.
  data: z.object({ id: z.string(), tracks: z.array(z.unknown()), clips: z.array(z.unknown()), media: z.array(z.unknown()) }).passthrough(),
  settings: z.object({
    width: z.number().int().min(240).max(7680), height: z.number().int().min(240).max(7680),
    fps: z.number().int().min(1).max(240), aspectLabel: z.string().max(40), backgroundColor: z.string().max(16),
  }).passthrough(),
})

const exportBody = z.object({
  projectId: z.string().max(64).optional(),
  format: z.enum(['mp4', 'mov', 'webm', 'avi']), codec: z.enum(['h264', 'h265', 'vp9']),
  resolution: z.enum(['720p', '1080p', '1440p', '4k']), fps: z.number().int().min(1).max(240),
  sizeBytes: z.number().int().min(0), durationSec: z.number().min(0),
})

const prefsBody = z.object({
  autosaveSeconds: z.number().int().min(5).max(600).optional(),
  cloudSyncEnabled: z.boolean().optional(),
  cloudUploadEnabled: z.boolean().optional(),
  theme: z.enum(['dark', 'light']).optional(),
}).strict()

const profileBody = z.object({ fullName: z.string().trim().min(1).max(80) }).strict()

export function apiRouter(db: PrismaClient): Router {
  const r = Router()
  // Every handler derives the user ONLY from the verified token (req.user), never from request input.
  const uid = (req: Express.Request & { user?: { id: string } }) => req.user!.id

  r.get('/me', async (req, res) => {
    const x = await ensureUser(db, req.user!)
    res.json({ profile: { id: x.user.id, email: x.user.email, fullName: x.user.fullName, plan: x.user.subscriptionPlan, createdAt: x.user.createdAt, lastLogin: x.user.lastLogin }, subscription: { plan: x.subscription.plan, status: x.subscription.status, limits: x.limits }, preferences: x.preferences })
  })

  r.put('/me', validateBody(profileBody), async (req, res) => {
    await ensureUser(db, req.user!)
    const u = await db.user.update({ where: { id: uid(req) }, data: { fullName: req.body.fullName } })
    res.json({ fullName: u.fullName })
  })

  r.get('/projects', async (req, res) => {
    const rows = await db.project.findMany({ where: { userId: uid(req), deletedAt: null }, select: { id: true, name: true, updatedAt: true, createdAt: true }, orderBy: { updatedAt: 'desc' }, take: 500 })
    res.json(rows)
  })

  r.get('/projects/:id', async (req, res) => {
    const id = idSchema.parse(req.params.id)
    const p = await db.project.findFirst({ where: { id, userId: uid(req), deletedAt: null } })
    if (!p) throw new HttpError(404, 'Project not found.')
    res.json({ id: p.id, name: p.name, updatedAt: p.updatedAt, data: p.data })
  })

  r.put('/projects/:id', validateBody(projectBody), async (req, res) => {
    const id = idSchema.parse(req.params.id)
    const x = await ensureUser(db, req.user!)
    const existing = await db.project.findUnique({ where: { id }, select: { userId: true } })
    if (existing && existing.userId !== uid(req)) throw new HttpError(403, 'This project id belongs to another account.')
    if (!existing) {
      const count = await db.project.count({ where: { userId: uid(req), deletedAt: null } })
      if (count >= x.limits.maxProjects) throw new HttpError(402, `Your ${x.subscription.plan} plan allows ${x.limits.maxProjects} cloud projects.`)
    }
    const { name, data, settings } = req.body as z.infer<typeof projectBody>
    const saved = await db.$transaction(async (tx) => {
      const p = await tx.project.upsert({
        where: { id },
        update: { name, data: data as Prisma.InputJsonValue, deletedAt: null },
        create: { id, userId: uid(req), name, data: data as Prisma.InputJsonValue },
      })
      await tx.projectSetting.upsert({
        where: { projectId: id },
        update: { width: settings.width, height: settings.height, fps: settings.fps, aspectLabel: settings.aspectLabel, backgroundColor: settings.backgroundColor },
        create: { projectId: id, width: settings.width, height: settings.height, fps: settings.fps, aspectLabel: settings.aspectLabel, backgroundColor: settings.backgroundColor },
      })
      // Mirror the media list into project_files as METADATA ONLY (storage_path stays NULL = not uploaded).
      await tx.projectFile.deleteMany({ where: { projectId: id, storagePath: null } })
      const media = (data.media as { name?: string; kind?: string; size?: number }[]).slice(0, 500)
      if (media.length) {
        await tx.projectFile.createMany({
          data: media.map((m) => ({ projectId: id, userId: uid(req), name: String(m.name ?? 'media').slice(0, 255), kind: ['video', 'audio', 'image'].includes(String(m.kind)) ? String(m.kind) : 'video', sizeBytes: BigInt(Math.max(0, Math.floor(Number(m.size) || 0))) })),
        })
      }
      return p
    })
    res.json({ id: saved.id, updatedAt: saved.updatedAt })
  })

  r.delete('/projects/:id', async (req, res) => {
    const id = idSchema.parse(req.params.id)
    const { count } = await db.project.deleteMany({ where: { id, userId: uid(req) } })
    if (!count) throw new HttpError(404, 'Project not found.')
    res.status(204).end()
  })

  r.post('/exports', validateBody(exportBody), async (req, res) => {
    await ensureUser(db, req.user!)
    const b = req.body as z.infer<typeof exportBody>
    const owned = b.projectId ? await db.project.findFirst({ where: { id: b.projectId, userId: uid(req) }, select: { id: true } }) : null
    const row = await db.exportHistory.create({ data: { userId: uid(req), projectId: owned?.id ?? null, format: b.format, codec: b.codec, resolution: b.resolution, fps: b.fps, sizeBytes: BigInt(b.sizeBytes), durationSec: b.durationSec } })
    res.status(201).json({ id: row.id })
  })

  r.get('/exports', async (req, res) => {
    const rows = await db.exportHistory.findMany({ where: { userId: uid(req) }, orderBy: { createdAt: 'desc' }, take: 100 })
    res.json(rows.map((e) => ({ ...e, sizeBytes: Number(e.sizeBytes) })))
  })

  r.get('/preferences', async (req, res) => { res.json((await ensureUser(db, req.user!)).preferences) })
  r.put('/preferences', validateBody(prefsBody), async (req, res) => {
    await ensureUser(db, req.user!)
    res.json(await db.userPreference.update({ where: { userId: uid(req) }, data: req.body }))
  })

  return r
}
