import { BrowserWindow, dialog, Notification, shell, type IpcMain } from 'electron'
import { spawn, execFile, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { buildExportArgs } from '../export/buildArgs'
import { getBinaries, getCapabilities } from '../ffmpeg/binaries'
import { dirs, ensure, readJson, writeJsonAtomic } from '../paths'
import { validateExportOptions, type ExportOptions, type ExportProgress } from '../../src/types/export'
import { newId, type Project } from '../../src/types/project'

interface Job { proc: ChildProcess | null; tempDir: string; outputPath: string; cancelled: boolean }
const jobs = new Map<string, Job>()

export interface ExportHistoryEntry {
  id: string; projectId: string; projectName: string; outputPath: string; format: string; codec: string
  resolution: string; fps: number; sizeBytes: number; durationSec: number; createdAt: string
}

/** Stops FFmpeg and its children (taskkill /T on Windows so no orphan encoders keep running). */
function killTree(proc: ChildProcess): void {
  if (!proc.pid) return
  if (process.platform === 'win32') execFile('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { windowsHide: true }, () => undefined)
  else proc.kill('SIGKILL')
}

/** Translate raw FFmpeg stderr into something a user can act on. */
export function friendlyFfmpegError(stderr: string): string {
  const tail = stderr.trim().split('\n').slice(-6).join('\n')
  if (/No such file or directory|Error opening input/i.test(stderr)) return `A source media file is missing or was moved. Re-import it and try again.\n\n${tail}`
  if (/Unknown encoder|Encoder .* not found/i.test(stderr)) return `This FFmpeg build does not include the selected encoder. Install a full FFmpeg build (winget install Gyan.FFmpeg).\n\n${tail}`
  if (/No such filter|Filter not found/i.test(stderr)) return `This FFmpeg build is missing a filter needed by your edits. Install a full FFmpeg build.\n\n${tail}`
  if (/Permission denied|Access is denied/i.test(stderr)) return `Cannot write to the output folder. Choose a different folder.\n\n${tail}`
  if (/No space left/i.test(stderr)) return `The disk is full. Free some space or choose another drive.\n\n${tail}`
  return `FFmpeg failed:\n${tail}`
}

function uniquePath(dir: string, name: string, ext: string): string {
  let p = path.join(dir, `${name}.${ext}`)
  for (let i = 1; fs.existsSync(p); i++) p = path.join(dir, `${name} (${i}).${ext}`)
  return p
}

export function registerExportIpc(ipc: IpcMain, getWindow: () => BrowserWindow | null): void {
  const send = (p: ExportProgress) => getWindow()?.webContents.send('export:progress', p)

  ipc.handle('export:capabilities', () => getCapabilities())

  ipc.handle('export:pickFolder', async (): Promise<string | null> => {
    const win = getWindow()
    const opts: Electron.OpenDialogOptions = { title: 'Choose output folder', properties: ['openDirectory', 'createDirectory'] }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return r.canceled ? null : r.filePaths[0]
  })

  ipc.handle('export:start', async (_e, project: Project, options: ExportOptions, textImages: Record<string, string>): Promise<string> => {
    const invalid = validateExportOptions(options)
    if (invalid) throw new Error(invalid)
    ensure(options.outputDir)
    const jobId = newId('exp')
    const tempDir = ensure(path.join(dirs.temp, `export-${jobId}`))

    // Text clips are rasterised by the renderer (same code as preview) and passed in as PNG data URLs.
    const textPaths: Record<string, string> = {}
    for (const [clipId, dataUrl] of Object.entries(textImages)) {
      const m = /^data:image\/png;base64,(.+)$/.exec(dataUrl)
      if (!m || !/^[\w-]+$/.test(clipId)) continue
      const f = path.join(tempDir, `text_${clipId}.png`)
      fs.writeFileSync(f, Buffer.from(m[1], 'base64'))
      textPaths[clipId] = f
    }

    const outputPath = uniquePath(options.outputDir, options.fileName.trim(), options.format)
    try {
      buildExportArgs({ project, options, textImages: textPaths, outputPath }) // validate early so errors reach the caller
    } catch (e) {
      fs.rmSync(tempDir, { recursive: true, force: true })
      throw e
    }

    const job: Job = { proc: null, tempDir, outputPath, cancelled: false }
    jobs.set(jobId, job)
    send({ jobId, state: 'preparing', percent: 0 })
    void renderJob(jobId, job, project, options, textPaths, send)
    return jobId
  })

  ipc.handle('export:cancel', (_e, jobId: string) => {
    const job = jobs.get(jobId)
    if (!job) return false
    job.cancelled = true
    if (job.proc) killTree(job.proc)
    return true
  })

  ipc.handle('export:history', () => readJson<ExportHistoryEntry[]>(dirs.exportHistory, []))
  ipc.handle('export:reveal', (_e, file: string) => { if (fs.existsSync(file)) shell.showItemInFolder(file) })
}

async function renderJob(jobId: string, job: Job, project: Project, options: ExportOptions, textPaths: Record<string, string>, send: (p: ExportProgress) => void): Promise<void> {
  const { tempDir, outputPath } = job
  const fail = (error: string) => {
    jobs.delete(jobId)
    fs.rmSync(tempDir, { recursive: true, force: true })
    fs.rmSync(outputPath, { force: true })
    send({ jobId, state: 'error', percent: 0, error })
  }
  const finishCancelled = () => {
    jobs.delete(jobId)
    fs.rmSync(tempDir, { recursive: true, force: true })
    fs.rmSync(outputPath, { force: true })
    send({ jobId, state: 'cancelled', percent: 0 })
  }
  try {
    if (job.cancelled) return finishCancelled()
    const built = buildExportArgs({ project, options, textImages: textPaths, outputPath })
    const proc = spawn(getBinaries().ffmpeg, built.args, { windowsHide: true })
    job.proc = proc
    runEncode(jobId, job, proc, built.duration, project, options, send)
  } catch (e) {
    fail(e instanceof Error ? e.message : String(e))
  }
}

function runEncode(jobId: string, job: Job, proc: ChildProcess, duration: number, project: Project, options: ExportOptions, send: (p: ExportProgress) => void): void {
  const { tempDir, outputPath } = job
  const built = { duration }
  {
    const started = Date.now()
    let stderr = ''
    let buf = ''
    proc.stdout!.on('data', (d: Buffer) => {
      buf += d.toString()
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      for (const line of lines) {
        const [k, v] = line.trim().split('=')
        if (k === 'out_time_us' || k === 'out_time_ms') {
          const sec = Number(v) / 1_000_000
          if (!Number.isFinite(sec) || sec < 0) continue
          const percent = Math.min(99, (sec / built.duration) * 100)
          const elapsed = (Date.now() - started) / 1000
          send({ jobId, state: 'rendering', percent, etaSec: sec > 0.2 ? Math.max(0, (elapsed / sec) * (built.duration - sec)) : undefined })
        }
      }
    })
    proc.stderr!.on('data', (d: Buffer) => { stderr = (stderr + d.toString()).slice(-8000) })
    proc.on('error', (err) => {
      jobs.delete(jobId)
      fs.rmSync(tempDir, { recursive: true, force: true })
      send({ jobId, state: 'error', percent: 0, error: `Could not start FFmpeg: ${err.message}` })
    })
    proc.on('close', (code) => {
      jobs.delete(jobId)
      fs.rmSync(tempDir, { recursive: true, force: true }) // always clean temp files
      if (job.cancelled) {
        fs.rmSync(outputPath, { force: true })
        return send({ jobId, state: 'cancelled', percent: 0 })
      }
      if (code !== 0) {
        fs.rmSync(outputPath, { force: true })
        return send({ jobId, state: 'error', percent: 0, error: friendlyFfmpegError(stderr) })
      }
      const sizeBytes = fs.statSync(outputPath).size
      const history = readJson<ExportHistoryEntry[]>(dirs.exportHistory, [])
      history.unshift({ id: jobId, projectId: project.id, projectName: project.name, outputPath, format: options.format, codec: options.codec, resolution: options.resolution, fps: options.fps, sizeBytes, durationSec: built.duration, createdAt: new Date().toISOString() })
      writeJsonAtomic(dirs.exportHistory, history.slice(0, 200))
      send({ jobId, state: 'done', percent: 100, outputPath, sizeBytes })
      if (Notification.isSupported()) {
        const n = new Notification({ title: 'Export complete', body: `${project.name} → ${path.basename(outputPath)}` })
        n.on('click', () => shell.showItemInFolder(outputPath))
        n.show()
      }
    })
  }
}

/** Kill running encodes and delete temp folders on quit. */
export function shutdownExports(): void {
  for (const job of jobs.values()) { job.cancelled = true; if (job.proc) killTree(job.proc) }
  try { fs.rmSync(dirs.temp, { recursive: true, force: true }) } catch { /* ignore */ }
}
