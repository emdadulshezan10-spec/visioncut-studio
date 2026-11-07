import { execFile, execFileSync } from 'node:child_process'
import fs from 'node:fs'

export interface FfBinaries {
  ffmpeg: string
  ffprobe: string
  source: 'env' | 'system' | 'bundled'
}

let cached: FfBinaries | null = null

function works(bin: string): boolean {
  try {
    execFileSync(bin, ['-version'], { timeout: 8000, windowsHide: true, stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

/** Packaged apps keep native binaries outside app.asar. */
const unpack = (p: string): string => p.replace('app.asar', 'app.asar.unpacked')

function bundled(): { ffmpeg?: string; ffprobe?: string } {
  const out: { ffmpeg?: string; ffprobe?: string } = {}
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const f = require('ffmpeg-static') as string | null
    if (f && fs.existsSync(unpack(f))) out.ffmpeg = unpack(f)
  } catch { /* optional */ }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const p = (require('ffprobe-static') as { path: string }).path
    if (p && fs.existsSync(unpack(p))) out.ffprobe = unpack(p)
  } catch { /* optional */ }
  return out
}

/**
 * Resolution order: VISIONCUT_FFMPEG / VISIONCUT_FFPROBE env vars -> system PATH (full builds
 * usually have every filter) -> binaries bundled via ffmpeg-static / ffprobe-static.
 */
export function getBinaries(): FfBinaries {
  if (cached) return cached
  const envF = process.env.VISIONCUT_FFMPEG
  const envP = process.env.VISIONCUT_FFPROBE
  if (envF && envP && works(envF)) return (cached = { ffmpeg: envF, ffprobe: envP, source: 'env' })
  if (works('ffmpeg') && works('ffprobe')) return (cached = { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe', source: 'system' })
  const b = bundled()
  if (b.ffmpeg && b.ffprobe) return (cached = { ffmpeg: b.ffmpeg, ffprobe: b.ffprobe, source: 'bundled' })
  throw new Error('FFmpeg was not found. Install it (winget install Gyan.FFmpeg) or set VISIONCUT_FFMPEG / VISIONCUT_FFPROBE.')
}

export interface FfCapabilities {
  version: string
  filters: Record<string, boolean>
  encoders: Record<string, boolean>
}

const WANTED_FILTERS = ['chromakey', 'rgbashift', 'deshake', 'lut3d', 'afftdn', 'geq', 'gblur', 'unsharp', 'vignette', 'noise', 'curves', 'colorchannelmixer', 'eq', 'amix']
const WANTED_ENCODERS = ['libx264', 'libx265', 'libvpx-vp9', 'aac', 'libopus', 'libmp3lame']

let caps: Promise<FfCapabilities> | null = null

/** Detects which filters/encoders this FFmpeg build supports so the UI can warn instead of failing late. */
export function getCapabilities(): Promise<FfCapabilities> {
  if (caps) return caps
  const { ffmpeg } = getBinaries()
  const run = (args: string[]) => new Promise<string>((resolve) =>
    execFile(ffmpeg, args, { windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (_e, so, se) => resolve(`${so}\n${se}`)))
  caps = (async () => {
    const [ver, filt, enc] = await Promise.all([run(['-version']), run(['-hide_banner', '-filters']), run(['-hide_banner', '-encoders'])])
    const has = (text: string, name: string) => new RegExp(`\\s${name.replace(/[-]/g, '\\-')}\\s`).test(text)
    return {
      version: /version\s+(\S+)/.exec(ver)?.[1] ?? 'unknown',
      filters: Object.fromEntries(WANTED_FILTERS.map((f) => [f, has(filt, f)])),
      encoders: Object.fromEntries(WANTED_ENCODERS.map((e) => [e, has(enc, e)])),
    }
  })()
  return caps
}
