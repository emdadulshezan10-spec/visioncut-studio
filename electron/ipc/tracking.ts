import { spawn } from 'node:child_process'
import fs from 'node:fs'
import type { IpcMain } from 'electron'
import { getBinaries } from '../ffmpeg/binaries'
import { trackPoint, type TrackResult } from '../../src/utils/tracker'

const FPS = 15
const MAX_SECONDS = 60 // bounds memory: 60 s * 15 fps * 320x180 gray ~= 52 MB

/** Decodes [inPoint, inPoint+seconds) to small grayscale frames and returns them as raw byte arrays. */
function grabFrames(file: string, inPoint: number, seconds: number, w: number, h: number): Promise<Uint8Array[]> {
  return new Promise((resolve, reject) => {
    const proc = spawn(getBinaries().ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-ss', String(Math.max(0, inPoint)), '-t', String(seconds), '-i', file, '-an', '-vf', `fps=${FPS},scale=${w}:${h}:flags=bilinear,format=gray`, '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { windowsHide: true })
    const size = w * h
    const frames: Uint8Array[] = []
    let pending: Buffer = Buffer.alloc(0)
    let err = ''
    const timer = setTimeout(() => { proc.kill(); reject(new Error('Tracking timed out while decoding the video.')) }, 180000)
    proc.stdout.on('data', (d: Buffer) => {
      pending = pending.length ? Buffer.concat([pending, d]) : d
      while (pending.length >= size) { frames.push(Uint8Array.from(pending.subarray(0, size))); pending = pending.subarray(size) }
    })
    proc.stderr.on('data', (d: Buffer) => { err += d.toString() })
    proc.on('error', (e) => { clearTimeout(timer); reject(e) })
    proc.on('close', (code) => { clearTimeout(timer); code === 0 || frames.length ? resolve(frames) : reject(new Error(`Could not decode the video: ${err.trim().split('\n').slice(-2).join(' ')}`)) })
  })
}

export function registerTrackingIpc(ipc: IpcMain): void {
  /** Tracks a point (normalised 0..1 in the source frame) through a clip's source range. Times in the result are source seconds from inPoint. */
  ipc.handle('tracking:track', async (_e, file: string, inPoint: number, seconds: number, srcW: number, srcH: number, start: { x: number; y: number }): Promise<TrackResult> => {
    if (!fs.existsSync(file)) throw new Error('Source media file not found.')
    if (!(srcW > 0 && srcH > 0) || ![start.x, start.y].every((v) => v >= 0 && v <= 1)) throw new Error('Invalid tracking point.')
    const secs = Math.min(MAX_SECONDS, Math.max(0.2, seconds))
    const w = 320
    const h = Math.max(32, Math.round(((w * srcH) / srcW) / 2) * 2)
    const frames = await grabFrames(file, inPoint, secs, w, h)
    if (frames.length < 2) throw new Error('Not enough frames to track (is the clip a still image or too short?).')
    return trackPoint(frames, w, h, start, { fps: FPS })
  })
}
