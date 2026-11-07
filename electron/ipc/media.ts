import { dialog, type BrowserWindow, type IpcMain } from 'electron'
import { execFile, spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { getBinaries } from '../ffmpeg/binaries'
import { dirs, ensure } from '../paths'
import { newId, type MediaItem, type MediaKind } from '../../src/types/project'

export const VIDEO_EXT = ['.mp4', '.mov', '.mkv', '.avi', '.webm', '.m4v', '.wmv', '.flv', '.mts', '.m2ts', '.mpg', '.mpeg', '.3gp']
export const AUDIO_EXT = ['.mp3', '.wav', '.aac', '.m4a', '.flac', '.ogg', '.opus', '.wma']
export const IMAGE_EXT = ['.png', '.jpg', '.jpeg', '.bmp', '.webp', '.gif', '.tif', '.tiff']
export const ALL_MEDIA_EXT = [...VIDEO_EXT, ...AUDIO_EXT, ...IMAGE_EXT]

export interface ImportResult {
  items: MediaItem[]
  errors: { path: string; error: string }[]
}

const kindOf = (file: string): MediaKind | null => {
  const e = path.extname(file).toLowerCase()
  if (VIDEO_EXT.includes(e)) return 'video'
  if (AUDIO_EXT.includes(e)) return 'audio'
  if (IMAGE_EXT.includes(e)) return 'image'
  return null
}

function run(bin: string, args: string[], timeout = 60000): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout, windowsHide: true, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr?.toString().trim().split('\n').slice(-3).join(' ') || err.message))
      else resolve({ stdout: stdout.toString(), stderr: stderr.toString() })
    })
  })
}

interface ProbeStream { codec_type: string; width?: number; height?: number; r_frame_rate?: string; avg_frame_rate?: string; duration?: string; tags?: { rotate?: string }; side_data_list?: { rotation?: number }[]; disposition?: { attached_pic?: number } }

export async function probeFile(file: string): Promise<{ duration: number; width?: number; height?: number; fps?: number; hasAudio: boolean; hasVideo: boolean }> {
  const { ffprobe } = getBinaries()
  const { stdout } = await run(ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file])
  const info = JSON.parse(stdout) as { streams?: ProbeStream[]; format?: { duration?: string } }
  const streams = info.streams ?? []
  const v = streams.find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic) ?? streams.find((s) => s.codec_type === 'video')
  const hasAudio = streams.some((s) => s.codec_type === 'audio')
  if (!v && !hasAudio) throw new Error('No audio or video stream found — the file may be corrupted or unsupported.')
  let width = v?.width
  let height = v?.height
  const rot = Math.abs(Number(v?.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? v?.tags?.rotate ?? 0))
  if (rot === 90 || rot === 270) [width, height] = [height, width]
  const [num, den] = (v?.avg_frame_rate && v.avg_frame_rate !== '0/0' ? v.avg_frame_rate : v?.r_frame_rate ?? '0/1').split('/').map(Number)
  const duration = Number(info.format?.duration ?? v?.duration ?? 0)
  return { duration: Number.isFinite(duration) ? duration : 0, width, height, fps: den ? num / den : undefined, hasAudio, hasVideo: !!v }
}

const cacheKey = (file: string, mtimeMs: number): string => crypto.createHash('sha1').update(`${file}|${mtimeMs}`).digest('hex').slice(0, 16)

async function makeThumbnail(file: string, kind: MediaKind, duration: number, outDir: string): Promise<string | undefined> {
  if (kind === 'audio') return undefined
  const out = path.join(outDir, 'thumb.jpg')
  if (fs.existsSync(out)) return out
  const { ffmpeg } = getBinaries()
  const seek = kind === 'video' ? Math.min(1, duration / 2) : 0
  try {
    await run(ffmpeg, ['-y', '-ss', String(seek), '-i', file, '-frames:v', '1', '-vf', 'scale=320:-2', '-q:v', '4', out], 30000)
    return fs.existsSync(out) ? out : undefined
  } catch {
    return undefined
  }
}

/** Decodes mono 8 kHz PCM from FFmpeg's stdout and reduces it to normalised peak bins (streamed, constant memory). */
function makeWaveform(file: string, duration: number): Promise<number[] | undefined> {
  const { ffmpeg } = getBinaries()
  const bins = Math.max(200, Math.min(4000, Math.round(duration * 20)))
  const samplesPerBin = Math.max(1, Math.floor((duration * 8000) / bins))
  return new Promise((resolve) => {
    const peaks = new Array<number>(bins).fill(0)
    let sampleIndex = 0
    let leftover: Buffer = Buffer.alloc(0)
    const p = spawn(ffmpeg, ['-v', 'error', '-i', file, '-vn', '-ac', '1', '-ar', '8000', '-f', 's16le', '-'], { windowsHide: true })
    p.stdout.on('data', (chunk: Buffer) => {
      const buf = leftover.length ? Buffer.concat([leftover, chunk]) : chunk
      const usable = buf.length - (buf.length % 2)
      for (let i = 0; i < usable; i += 2) {
        const bin = Math.min(bins - 1, Math.floor(sampleIndex / samplesPerBin))
        const v = Math.abs(buf.readInt16LE(i)) / 32768
        if (v > peaks[bin]) peaks[bin] = v
        sampleIndex++
      }
      leftover = buf.subarray(usable)
    })
    p.on('error', () => resolve(undefined))
    p.on('close', () => {
      const max = Math.max(0.001, ...peaks)
      resolve(peaks.map((v) => Math.round((v / max) * 1000) / 1000))
    })
  })
}

export async function importPaths(paths: string[]): Promise<ImportResult> {
  const items: MediaItem[] = []
  const errors: ImportResult['errors'] = []
  for (const file of paths) {
    try {
      const kind = kindOf(file)
      if (!kind) throw new Error('Unsupported file type.')
      const st = await fs.promises.stat(file)
      if (!st.isFile()) throw new Error('Not a file.')
      const pr = await probeFile(file)
      if (kind === 'video' && !pr.hasVideo) throw new Error('No video stream found.')
      const dir = ensure(path.join(dirs.cache, cacheKey(file, st.mtimeMs)))
      const duration = kind === 'image' ? 0 : pr.duration
      if (kind !== 'image' && duration <= 0) throw new Error('Could not determine duration — the file may be corrupted.')
      const [thumbnail, waveform] = await Promise.all([
        makeThumbnail(file, kind, duration, dir),
        pr.hasAudio && kind !== 'image' ? makeWaveform(file, duration) : Promise.resolve(undefined),
      ])
      items.push({ id: newId('med'), name: path.basename(file), path: file, kind, duration, width: pr.width, height: pr.height, fps: pr.fps, hasAudio: pr.hasAudio && kind !== 'image', size: st.size, thumbnail, waveform, folderId: null })
    } catch (e) {
      errors.push({ path: file, error: e instanceof Error ? e.message : String(e) })
    }
  }
  return { items, errors }
}

export function registerMediaIpc(ipc: IpcMain, getWindow: () => BrowserWindow | null): void {
  ipc.handle('media:pick', async (): Promise<string[]> => {
    const win = getWindow()
    const opts: Electron.OpenDialogOptions = {
      title: 'Import media', properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'All media', extensions: ALL_MEDIA_EXT.map((e) => e.slice(1)) },
        { name: 'Video', extensions: VIDEO_EXT.map((e) => e.slice(1)) },
        { name: 'Audio', extensions: AUDIO_EXT.map((e) => e.slice(1)) },
        { name: 'Images', extensions: IMAGE_EXT.map((e) => e.slice(1)) },
      ],
    }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return r.canceled ? [] : r.filePaths
  })

  /** Returns the subset of paths that no longer exist (moved/deleted media). */
  ipc.handle('media:missing', async (_e, paths: string[]): Promise<string[]> => {
    const out: string[] = []
    for (const p of paths) { try { await fs.promises.access(p) } catch { out.push(p) } }
    return out
  })

  ipc.handle('media:import', (_e, paths: string[]) => {
    if (!Array.isArray(paths) || paths.some((p) => typeof p !== 'string')) throw new Error('Invalid paths')
    return importPaths(paths)
  })

  /** Extracts one frame from a video as a PNG and imports it as an image (freeze frame). */
  ipc.handle('media:freezeFrame', async (_e, file: string, sourceTime: number): Promise<ImportResult> => {
    const { ffmpeg } = getBinaries()
    const out = path.join(ensure(path.join(dirs.cache, 'freeze')), `freeze_${Date.now()}.png`)
    await run(ffmpeg, ['-y', '-ss', String(Math.max(0, sourceTime)), '-i', file, '-frames:v', '1', out], 60000)
    if (!fs.existsSync(out)) throw new Error('Could not extract a frame at that position.')
    return importPaths([out])
  })

  /** Low-resolution H.264 proxy for smooth preview of large/4K files. Originals remain untouched. */
  ipc.handle('media:makeProxy', async (_e, file: string): Promise<string> => {
    const { ffmpeg } = getBinaries()
    const st = await fs.promises.stat(file)
    const out = path.join(ensure(path.join(dirs.cache, cacheKey(file, st.mtimeMs))), 'proxy.mp4')
    if (fs.existsSync(out)) return out
    await run(ffmpeg, ['-y', '-i', file, '-vf', 'scale=-2:540', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', out], 60 * 60 * 1000)
    return out
  })

  ipc.handle('media:saveRecording', async (_e, data: ArrayBuffer): Promise<ImportResult> => {
    const out = path.join(dirs.recordings, `voiceover_${new Date().toISOString().replace(/[:.]/g, '-')}.webm`)
    await fs.promises.writeFile(out, Buffer.from(data))
    return importPaths([out])
  })

  ipc.handle('media:pickLut', async (): Promise<string | null> => {
    const win = getWindow()
    const opts: Electron.OpenDialogOptions = { title: 'Choose a .cube LUT', properties: ['openFile'], filters: [{ name: '3D LUT', extensions: ['cube', '3dl'] }] }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return r.canceled ? null : r.filePaths[0]
  })

  ipc.handle('media:pickSubtitles', async (): Promise<{ start: number; end: number; text: string }[] | null> => {
    const win = getWindow()
    const opts: Electron.OpenDialogOptions = { title: 'Import subtitles (.srt)', properties: ['openFile'], filters: [{ name: 'SubRip', extensions: ['srt'] }] }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (r.canceled) return null
    return parseSrt(await fs.promises.readFile(r.filePaths[0], 'utf8'))
  })
}

export function parseSrt(text: string): { start: number; end: number; text: string }[] {
  const toSec = (s: string) => { const m = /(\d+):(\d+):(\d+)[,.](\d+)/.exec(s); return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4].padEnd(3, '0').slice(0, 3) / 1000 : NaN }
  return text.replace(/\r/g, '').split(/\n{2,}/).flatMap((block) => {
    const lines = block.split('\n').filter(Boolean)
    const ti = lines.findIndex((l) => l.includes('-->'))
    if (ti < 0) return []
    const [a, b] = lines[ti].split('-->')
    const start = toSec(a), end = toSec(b)
    const body = lines.slice(ti + 1).join('\n').replace(/<[^>]+>/g, '')
    return Number.isFinite(start) && Number.isFinite(end) && end > start && body ? [{ start, end, text: body }] : []
  })
}

