import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

/** All app-owned folders live under Electron's userData. User media is NEVER copied or moved here. */
export const dirs = {
  get root() { return app.getPath('userData') },
  get projects() { return ensure(path.join(this.root, 'projects')) },
  get cache() { return ensure(path.join(this.root, 'cache')) },
  get recordings() { return ensure(path.join(this.root, 'recordings')) },
  get prefs() { return path.join(this.root, 'preferences.json') },
  get exportHistory() { return path.join(this.root, 'export-history.json') },
  get temp() { return ensure(path.join(app.getPath('temp'), 'visioncut')) },
}

export function ensure(dir: string): string {
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

/** Atomic JSON write: write to a temp file then rename, so a crash never leaves a half-written file. */
export function writeJsonAtomic(file: string, data: unknown): void {
  ensure(path.dirname(file))
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(data), 'utf8')
  fs.renameSync(tmp, file)
}

export function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T
  } catch {
    return fallback
  }
}

/** Only allow simple safe IDs as folder names (prevents path traversal through IPC). */
export function safeId(id: string): string {
  if (!/^[A-Za-z0-9_-]{3,64}$/.test(id)) throw new Error('Invalid id')
  return id
}
