/**
 * Local project storage. Layout per project (userData/projects/<id>/):
 *   project.json     last explicit save (source of truth)
 *   autosave.json    crash-recovery copy written by autosave; removed on explicit save
 *   thumbnail.jpg    project card image
 *   history/<ts>.json rolling snapshots of previous saves (editing history, max 15)
 */
import type { IpcMain } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { dirs, ensure, readJson, safeId, writeJsonAtomic } from '../paths'
import { newId, projectDuration, type Project, type ProjectSummary } from '../../src/types/project'

const HISTORY_MAX = 15
const pdir = (id: string) => path.join(dirs.projects, safeId(id))

function summarize(p: Project, id: string): ProjectSummary {
  const thumb = path.join(pdir(id), 'thumbnail.jpg')
  return {
    id: p.id, name: p.name, createdAt: p.createdAt, updatedAt: p.updatedAt, duration: projectDuration(p), clipCount: p.clips.length,
    thumbnail: fs.existsSync(thumb) ? thumb : p.media.find((m) => m.thumbnail)?.thumbnail,
  }
}

function validate(p: unknown): Project {
  const x = p as Project
  if (!x || typeof x !== 'object' || typeof x.id !== 'string' || !Array.isArray(x.clips) || !Array.isArray(x.tracks) || !Array.isArray(x.media) || !x.settings) {
    throw new Error('Project file is invalid or corrupted.')
  }
  x.folders ??= []
  x.markers ??= []
  return x
}

export function saveProject(p: Project, opts: { autosave?: boolean } = {}): void {
  validate(p)
  const dir = ensure(pdir(p.id))
  if (opts.autosave) {
    writeJsonAtomic(path.join(dir, 'autosave.json'), p)
    return
  }
  const main = path.join(dir, 'project.json')
  if (fs.existsSync(main)) {
    const hist = ensure(path.join(dir, 'history'))
    fs.copyFileSync(main, path.join(hist, `${Date.now()}.json`))
    const files = fs.readdirSync(hist).sort()
    for (const f of files.slice(0, Math.max(0, files.length - HISTORY_MAX))) fs.rmSync(path.join(hist, f), { force: true })
  }
  writeJsonAtomic(main, p)
  fs.rmSync(path.join(dir, 'autosave.json'), { force: true })
}

export function registerProjectsIpc(ipc: IpcMain): void {
  ipc.handle('projects:list', (): ProjectSummary[] => {
    const out: ProjectSummary[] = []
    for (const id of fs.readdirSync(dirs.projects)) {
      try {
        const dir = path.join(dirs.projects, id)
        const file = fs.existsSync(path.join(dir, 'project.json')) ? 'project.json' : 'autosave.json'
        const p = readJson<Project | null>(path.join(dir, file), null)
        if (p) out.push(summarize(validate(p), id))
      } catch { /* skip corrupted project folders instead of breaking the list */ }
    }
    return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  })

  /** Returns the project plus whether a newer autosave (crash recovery) exists. */
  ipc.handle('projects:load', (_e, id: string) => {
    const dir = pdir(id)
    const mainF = path.join(dir, 'project.json')
    const autoF = path.join(dir, 'autosave.json')
    const main = fs.existsSync(mainF) ? readJson<Project | null>(mainF, null) : null
    const auto = fs.existsSync(autoF) ? readJson<Project | null>(autoF, null) : null
    if (!main && !auto) throw new Error('Project not found.')
    const recoverable = !!auto && (!main || auto.updatedAt > main.updatedAt)
    return { project: validate(main ?? auto), recovered: recoverable ? validate(auto) : null }
  })

  ipc.handle('projects:save', (_e, p: Project, autosave?: boolean) => { saveProject(p, { autosave: !!autosave }) })

  ipc.handle('projects:saveThumbnail', (_e, id: string, dataUrl: string) => {
    const m = /^data:image\/jpeg;base64,(.+)$/.exec(dataUrl)
    if (!m) throw new Error('Invalid thumbnail')
    fs.writeFileSync(path.join(ensure(pdir(id)), 'thumbnail.jpg'), Buffer.from(m[1], 'base64'))
  })

  ipc.handle('projects:rename', (_e, id: string, name: string) => {
    const file = path.join(pdir(id), 'project.json')
    const p = validate(readJson<Project | null>(file, null))
    p.name = String(name).trim().slice(0, 120) || p.name
    p.updatedAt = new Date().toISOString()
    writeJsonAtomic(file, p)
  })

  ipc.handle('projects:delete', (_e, id: string) => { fs.rmSync(pdir(id), { recursive: true, force: true }) })

  ipc.handle('projects:duplicate', (_e, id: string): string => {
    const src = validate(readJson<Project | null>(path.join(pdir(id), 'project.json'), null))
    const copy: Project = { ...structuredClone(src), id: newId('prj'), name: `${src.name} (copy)`, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
    saveProject(copy)
    const thumb = path.join(pdir(id), 'thumbnail.jpg')
    if (fs.existsSync(thumb)) fs.copyFileSync(thumb, path.join(pdir(copy.id), 'thumbnail.jpg'))
    return copy.id
  })

  ipc.handle('projects:history', (_e, id: string): { file: string; savedAt: number }[] => {
    const hist = path.join(pdir(id), 'history')
    if (!fs.existsSync(hist)) return []
    return fs.readdirSync(hist).filter((f) => f.endsWith('.json')).map((f) => ({ file: f, savedAt: Number(f.replace('.json', '')) })).sort((a, b) => b.savedAt - a.savedAt)
  })

  ipc.handle('projects:restoreHistory', (_e, id: string, file: string): Project => {
    if (!/^\d+\.json$/.test(file)) throw new Error('Invalid history entry')
    return validate(readJson<Project | null>(path.join(pdir(id), 'history', file), null))
  })
}
