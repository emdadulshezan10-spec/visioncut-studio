import { app, type IpcMain } from 'electron'
import { execFile } from 'node:child_process'
import os from 'node:os'
import { getBinaries } from '../ffmpeg/binaries'

export interface SystemInfo {
  appVersion: string
  electron: string
  chrome: string
  node: string
  platform: string
  arch: string
  cpus: number
  totalMemGb: number
}

export interface ToolStatus {
  found: boolean
  version?: string
  error?: string
}

export interface FfmpegStatus {
  ffmpeg: ToolStatus
  ffprobe: ToolStatus
  source?: string
}

function probe(bin: string): Promise<ToolStatus> {
  return new Promise((resolve) => {
    execFile(bin, ['-version'], { timeout: 8000, windowsHide: true }, (err, stdout) => {
      if (err) return resolve({ found: false, error: err.message })
      resolve({ found: true, version: /version\s+(\S+)/.exec(stdout)?.[1] })
    })
  })
}
export function registerSystemIpc(ipc: IpcMain): void {
  ipc.handle('system:info', (): SystemInfo => ({
    appVersion: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    cpus: os.cpus().length,
    totalMemGb: Math.round(os.totalmem() / 1024 ** 3),
  }))

  ipc.handle('system:ffmpeg', async (): Promise<FfmpegStatus> => {
    try {
      const b = getBinaries()
      return { ffmpeg: await probe(b.ffmpeg), ffprobe: await probe(b.ffprobe), source: b.source }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return { ffmpeg: { found: false, error: msg }, ffprobe: { found: false, error: msg } }
    }
  })}

