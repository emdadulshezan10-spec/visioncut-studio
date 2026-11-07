/**
 * Automatic subtitles with whisper.cpp running fully OFFLINE on this PC.
 * Nothing is uploaded: audio is extracted locally and transcribed locally. The engine (4 MB) and the
 * English model (148 MB) are downloaded once, on the user's request, from the official whisper.cpp
 * GitHub release / Hugging Face repo and verified against pinned SHA-256 checksums.
 */
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { BrowserWindow, IpcMain } from 'electron'
import { getBinaries } from '../ffmpeg/binaries'
import { dirs, ensure } from '../paths'
import { parseSrt } from './media'

export const WHISPER_ENGINE = {
  url: 'https://github.com/ggml-org/whisper.cpp/releases/download/v1.8.7/whisper-bin-x64.zip',
  sha256: 'd9627486e1c34a03745880485593473e047294260ce9a3cb0aa8deaf15b99af6',
}
export const WHISPER_MODEL = {
  url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin',
  sha256: 'a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002',
  bytes: 147964211,
}

export interface SubtitleStatus { installed: boolean; language: string; downloadMB: number }
export interface SubtitleProgress { stage: 'download-engine' | 'download-model' | 'extract' | 'audio' | 'transcribe' | 'done'; percent: number }

const whisperDir = () => ensure(path.join(dirs.root, 'whisper'))
const cliPath = () => path.join(whisperDir(), 'bin', 'Release', 'whisper-cli.exe')
const modelPath = () => path.join(whisperDir(), 'ggml-base.en.bin')
export const isInstalled = (): boolean => fs.existsSync(cliPath()) && fs.existsSync(modelPath()) && fs.statSync(modelPath()).size === WHISPER_MODEL.bytes

/** Streams a URL to disk, reporting progress, and returns the SHA-256 of what was written. */
async function download(url: string, dest: string, onPct: (p: number) => void, signal: AbortSignal): Promise<string> {
  const res = await fetch(url, { signal, redirect: 'follow' })
  if (!res.ok || !res.body) throw new Error(`Download failed (HTTP ${res.status}) from ${new URL(url).host}.`)
  const total = Number(res.headers.get('content-length')) || 0
  const hash = crypto.createHash('sha256')
  const out = fs.createWriteStream(dest)
  let got = 0
  try {
    const reader = res.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      hash.update(value)
      got += value.length
      if (!out.write(value)) await new Promise((r) => out.once('drain', r))
      if (total) onPct(Math.min(99, (got / total) * 100))
    }
  } finally {
    await new Promise<void>((r) => out.end(() => r()))
  }
  return hash.digest('hex')
}

function tarExtract(zip: string, into: string): Promise<void> {
  // Windows 10+ ships bsdtar as tar.exe, which reads .zip archives.
  return new Promise((resolve, reject) => {
    execFile('tar', ['-xf', zip, '-C', into], { windowsHide: true }, (err, _o, stderr) => (err ? reject(new Error(`Could not unpack the engine: ${stderr || err.message}`)) : resolve()))
  })
}

let installing: AbortController | null = null
let transcribing: { proc: ChildProcess | null; cancelled: boolean } | null = null

export function registerSubtitlesIpc(ipc: IpcMain, getWindow: () => BrowserWindow | null): void {
  const send = (p: SubtitleProgress) => getWindow()?.webContents.send('subtitles:progress', p)

  ipc.handle('subtitles:status', (): SubtitleStatus => ({ installed: isInstalled(), language: 'English', downloadMB: Math.round((WHISPER_MODEL.bytes + 4_400_000) / 1_000_000) }))

  ipc.handle('subtitles:install', async (): Promise<void> => {
    if (installing) throw new Error('Already downloading.')
    if (isInstalled()) return
    installing = new AbortController()
    const { signal } = installing
    const tmp = ensure(path.join(dirs.temp, 'whisper-dl'))
    try {
      const zip = path.join(tmp, 'engine.zip')
      const h1 = await download(WHISPER_ENGINE.url, zip, (p) => send({ stage: 'download-engine', percent: p }), signal)
      if (h1 !== WHISPER_ENGINE.sha256) throw new Error('The downloaded speech engine failed its integrity check and was discarded.')
      send({ stage: 'extract', percent: 0 })
      const binDir = ensure(path.join(whisperDir(), 'bin'))
      await tarExtract(zip, binDir)
      if (!fs.existsSync(cliPath())) throw new Error('The speech engine archive did not contain whisper-cli.exe.')

      const part = `${modelPath()}.part`
      const h2 = await download(WHISPER_MODEL.url, part, (p) => send({ stage: 'download-model', percent: p }), signal)
      if (h2 !== WHISPER_MODEL.sha256) { fs.rmSync(part, { force: true }); throw new Error('The downloaded speech model failed its integrity check and was discarded.') }
      fs.renameSync(part, modelPath())
      send({ stage: 'done', percent: 100 })
    } catch (e) {
      fs.rmSync(`${modelPath()}.part`, { force: true })
      if (signal.aborted) throw new Error('Download cancelled.')
      throw e
    } finally {
      installing = null
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })

  ipc.handle('subtitles:cancel', () => {
    installing?.abort()
    if (transcribing) { transcribing.cancelled = true; transcribing.proc?.kill() }
  })

  /** Transcribes [inPoint, inPoint+seconds) of a media file. Cue times are relative to inPoint. */
  ipc.handle('subtitles:transcribe', async (_e, file: string, inPoint: number, seconds: number): Promise<{ start: number; end: number; text: string }[]> => {
    if (!isInstalled()) throw new Error('The speech engine is not installed yet.')
    if (transcribing) throw new Error('A transcription is already running.')
    if (!fs.existsSync(file)) throw new Error('Source media file not found.')
    const job = { proc: null as ChildProcess | null, cancelled: false }
    transcribing = job
    const tmp = ensure(path.join(dirs.temp, `whisper-${Date.now()}`))
    try {
      send({ stage: 'audio', percent: 0 })
      const wav = path.join(tmp, 'audio.wav')
      await new Promise<void>((resolve, reject) => {
        const p = spawn(getBinaries().ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-nostdin', '-ss', String(Math.max(0, inPoint)), '-t', String(Math.max(0.1, seconds)), '-i', file, '-vn', '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wav], { windowsHide: true })
        job.proc = p
        let err = ''
        p.stderr.on('data', (d: Buffer) => { err += d.toString() })
        p.on('error', reject)
        p.on('close', (c) => (c === 0 ? resolve() : reject(new Error(job.cancelled ? 'Cancelled.' : /does not contain any stream|Stream map/i.test(err) ? 'This clip has no audio to transcribe.' : `Audio extraction failed: ${err.trim().split('\n').slice(-2).join(' ')}`))))
      })
      if (job.cancelled) throw new Error('Cancelled.')
      send({ stage: 'transcribe', percent: 0 })
      const outBase = path.join(tmp, 'out')
      await new Promise<void>((resolve, reject) => {
        const p = spawn(cliPath(), ['-m', modelPath(), '-f', wav, '-osrt', '-of', outBase, '-np', '-l', 'en', '-pp'], { windowsHide: true, cwd: path.dirname(cliPath()) })
        job.proc = p
        let err = ''
        p.stderr.on('data', (d: Buffer) => {
          const s = d.toString()
          err = (err + s).slice(-2000)
          const m = [...s.matchAll(/progress\s*=\s*(\d+)%/g)].pop()
          if (m) send({ stage: 'transcribe', percent: Number(m[1]) })
        })
        p.on('error', reject)
        p.on('close', (c) => (c === 0 ? resolve() : reject(new Error(job.cancelled ? 'Cancelled.' : `Transcription failed: ${err.trim().split('\n').slice(-2).join(' ')}`))))
      })
      const srt = `${outBase}.srt`
      if (!fs.existsSync(srt)) return []
      const cues = parseSrt(fs.readFileSync(srt, 'utf8'))
        // whisper marks non-speech as [BLANK_AUDIO], [MUSIC], (silence)… — those are not subtitles.
        .filter((c) => c.text && !/^[\[(*♪\s].*[\])*♪]$/.test(c.text.trim()))
      send({ stage: 'done', percent: 100 })
      return cues
    } finally {
      transcribing = null
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })
}
