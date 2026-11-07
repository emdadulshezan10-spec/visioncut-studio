import { describe, expect, it, beforeAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildExportArgs } from '../electron/export/buildArgs'
import { addMediaClip, addTextClip, splitClip, updateClip } from '../src/editor/timeline/ops'
import { createProject, type MediaItem, type Project } from '../src/types/project'
import type { ExportOptions } from '../src/types/export'

// REAL FFmpeg integration test: renders actual files and inspects them with ffprobe.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-test-'))
const vid = path.join(tmp, 'src.mp4')
const aud = path.join(tmp, 'tone.wav')
const img = path.join(tmp, 'pic.png')
let have = true
try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }) } catch { have = false }

const probe = (f: string) => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', f]).toString())
const opts = (over: Partial<ExportOptions> = {}): ExportOptions => ({ format: 'mp4', codec: 'h264', resolution: '720p', fps: 30, audioBitrateKbps: 128, outputDir: tmp, fileName: 'out', ...over })
const run = (p: Project, o: ExportOptions, textImages: Record<string, string> = {}) => {
  const out = path.join(tmp, `${o.fileName}.${o.format}`)
  const r = buildExportArgs({ project: p, options: o, textImages, outputPath: out })
  execFileSync('ffmpeg', r.args, { stdio: 'pipe' })
  return { out, r }
}
const m = (id: string, kind: MediaItem['kind'], file: string, duration: number, hasAudio: boolean, w = 640, h = 360): MediaItem =>
  ({ id, name: id, path: file, kind, duration, width: w, height: h, hasAudio, size: 1, folderId: null })

describe.skipIf(!have)('ffmpeg export (real renders)', () => {
  let media: MediaItem[]
  beforeAll(() => {
    execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'testsrc=duration=4:size=640x360:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', vid], { stdio: 'ignore' })
    execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'sine=frequency=880:duration=3', aud], { stdio: 'ignore' })
    execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'color=c=red:s=320x320', '-frames:v', '1', img], { stdio: 'ignore' })
    media = [m('v', 'video', vid, 4, true), m('a', 'audio', aud, 3, true, 0, 0), m('i', 'image', img, 0, false, 320, 320)]
  })

  const base = (): Project => ({ ...createProject('t'), media })

  it('exports a trimmed + sped-up video clip with audio at the right duration and size', () => {
    let p = base()
    p = addMediaClip(p, media[0]).project
    const id = p.clips[0].id
    p = updateClip(p, id, { inPoint: 1, duration: 1, speed: 2 }) // 2s of source at 2x = 1s
    const { out } = run(p, opts())
    const info = probe(out)
    const v = info.streams.find((s: any) => s.codec_type === 'video')
    expect(v.width).toBe(1280); expect(v.height).toBe(720); expect(v.codec_name).toBe('h264')
    expect(info.streams.some((s: any) => s.codec_type === 'audio')).toBe(true)
    expect(Number(info.format.duration)).toBeGreaterThan(0.9); expect(Number(info.format.duration)).toBeLessThan(1.2)
  })

  it('renders an overlay with ~60 tracked x/y keyframes (deeply nested expressions)', () => {
    let p = base()
    p = addMediaClip(p, media[0]).project
    p = addMediaClip(p, media[2], { start: 0 }).project
    const ov = p.clips.find((c) => c.kind === 'image')!
    p = updateClip(p, ov.id, { duration: 3, keyframes: {
      x: Array.from({ length: 60 }, (_, i) => ({ time: (i / 59) * 3, value: -20 + i * 0.6 + (i % 2) * 0.3 })),
      y: Array.from({ length: 60 }, (_, i) => ({ time: (i / 59) * 3, value: 10 - i * 0.2 + (i % 3) * 0.2 })),
    } })
    const { out } = run(p, opts({ fileName: 'tracked' }))
    expect(Number(probe(out).format.duration)).toBeGreaterThan(3.5)
  })

  it('stabilize effect renders with single-pass deshake', () => {
    let p = base()
    p = addMediaClip(p, media[0]).project
    p = updateClip(p, p.clips[0].id, { duration: 2, effects: { ...p.clips[0].effects, stabilize: true } })
    const { out, r } = run(p, opts({ fileName: 'stab' }))
    expect(r.args.join(' ')).toContain('deshake')
    expect(Number(probe(out).format.duration)).toBeGreaterThan(1.8)
  })

  it('handles split clips, multiple tracks, image overlay, effects, color, transitions, keyframes, reverse', () => {
    let p = base()
    p = addMediaClip(p, media[0]).project
    const first = p.clips[0].id
    const s = splitClip(p, first, 2)
    p = s.project
    p = updateClip(p, first, { reverse: true, transitionOut: { type: 'dissolve', duration: 0.5 }, color: { ...p.clips[0].color, brightness: 0.1, contrast: 0.2, saturation: -0.3, temperature: 0.3, tint: 0.1, exposure: 0.3, highlights: 0.2, shadows: 0.2, red: 0.1 } })
    p = updateClip(p, s.rightId!, { effects: { ...p.clips[1].effects, blur: 3, gaussianBlur: 2, sharpen: 1, vignette: 0.5, grain: 10, noise: 5, chromaticAberration: 3, glow: 0.3, grayscale: false }, transitionIn: { type: 'slide', duration: 0.5 } })
    const img1 = addMediaClip(p, media[2], { start: 0.5 })
    p = img1.project
    p = updateClip(p, img1.clipId, { duration: 2, transform: { ...p.clips[2].transform, scale: 0.4, rotation: 15, opacity: 0.8 }, keyframes: { x: [{ time: 0, value: -30 }, { time: 2, value: 30 }], scale: [{ time: 0, value: 0.2 }, { time: 2, value: 0.5 }] }, transitionIn: { type: 'zoom', duration: 0.5 }, transitionOut: { type: 'wipe', duration: 0.5 } })
    p = addMediaClip(p, media[1], { start: 0 }).project
    const { out } = run(p, opts({ resolution: '720p', fps: 24 }))
    const info = probe(out)
    expect(Number(info.format.duration)).toBeGreaterThan(3.8)
    expect(info.streams.find((s: any) => s.codec_type === 'video').r_frame_rate).toBe('24/1')
  })

  it('renders text clips from a pre-rendered PNG and chroma key / mask / stabilize', () => {
    let p = base()
    p = addMediaClip(p, media[0]).project
    const vc = p.clips[0].id
    p = updateClip(p, vc, { effects: { ...p.clips[0].effects, chromaKey: { enabled: true, color: '#00ff00', similarity: 0.2, blend: 0.1 }, ellipseMask: true, stabilize: true } })
    const t = addTextClip(p, 0.5)
    p = t.project
    const png = path.join(tmp, 'text.png')
    execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'color=c=0x00000000:s=1920x1080,format=rgba', '-frames:v', '1', png], { stdio: 'ignore' })
    const { out } = run(p, opts({ fileName: 'text' }), { [t.clipId]: png })
    expect(fs.existsSync(out)).toBe(true)
  })

  it('exports every container/codec combination', () => {
    let p = base()
    p = addMediaClip(p, media[0]).project
    p = updateClip(p, p.clips[0].id, { duration: 1 })
    for (const [format, codec] of [['mov', 'h264'], ['mov', 'h265'], ['webm', 'vp9'], ['avi', 'h264'], ['mp4', 'h265'], ['mp4', 'vp9']] as const) {
      const { out } = run(p, opts({ format, codec, fileName: `c_${format}_${codec}`, videoBitrateKbps: 2000 }))
      expect(probe(out).format.duration).toBeDefined()
    }
  }, 120000)

  it('errors on empty timeline', () => {
    expect(() => buildExportArgs({ project: base(), options: opts(), textImages: {}, outputPath: 'x.mp4' })).toThrow(/empty/)
  })
})
