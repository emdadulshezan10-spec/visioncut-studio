/**
 * Point/region motion tracking by block matching (sum of absolute differences) on grayscale frames.
 * Pure functions, no IO: frames come from FFmpeg in the main process (electron/ipc/tracking.ts).
 *
 * Limits (honest): tracks translation of a textured patch. It does not model rotation, scale or occlusion;
 * when the match quality collapses it stops and reports where it lost the target.
 */
import type { Clip, Keyframe, Transform } from '@/types/project'

export interface TrackSample { /** seconds from the start of the analysed range */ t: number; /** 0..1 across the frame */ x: number; /** 0..1 down the frame */ y: number }
export interface TrackResult { samples: TrackSample[]; /** index of the first frame where the target was lost, or null */ lostAt: number | null }
export interface TrackOptions { fps: number; /** patch half-size in pixels */ radius?: number; /** search half-range in pixels per frame */ search?: number; /** mean abs. gray-level difference above which the target is considered lost */ maxMeanDiff?: number }

function sad(frame: Uint8Array, w: number, tpl: Float32Array, r: number, cx: number, cy: number, best: number): number {
  const n = 2 * r + 1
  let s = 0
  for (let j = 0; j < n; j++) {
    const row = (cy - r + j) * w + (cx - r)
    const trow = j * n
    for (let i = 0; i < n; i++) s += Math.abs(frame[row + i] - tpl[trow + i])
    if (s >= best) return s // early exit: cannot beat the current best
  }
  return s
}

/** Tracks the patch centred on `start` (normalised 0..1) in frame 0 through all `frames` (w*h gray bytes each). */
export function trackPoint(frames: Uint8Array[], w: number, h: number, start: { x: number; y: number }, opts: TrackOptions): TrackResult {
  const r = opts.radius ?? Math.max(6, Math.round(Math.min(w, h) * 0.06))
  const search = opts.search ?? Math.max(6, Math.round(Math.min(w, h) * 0.05))
  const maxMean = opts.maxMeanDiff ?? 28
  const n = 2 * r + 1
  const clampX = (v: number) => Math.min(w - r - 1, Math.max(r, v))
  const clampY = (v: number) => Math.min(h - r - 1, Math.max(r, v))
  if (!frames.length) return { samples: [], lostAt: null }
  let cx = clampX(Math.round(start.x * (w - 1)))
  let cy = clampY(Math.round(start.y * (h - 1)))
  const tpl = new Float32Array(n * n)
  const grab = (f: Uint8Array, x: number, y: number) => {
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) tpl[j * n + i] = f[(y - r + j) * w + (x - r + i)]
  }
  grab(frames[0], cx, cy)
  let fx = cx, fy = cy // sub-pixel position
  const samples: TrackSample[] = [{ t: 0, x: fx / (w - 1), y: fy / (h - 1) }]
  let lostAt: number | null = null

  for (let k = 1; k < frames.length; k++) {
    const f = frames[k]
    let best = Infinity, bx = cx, by = cy
    const x0 = clampX(cx - search), x1 = clampX(cx + search), y0 = clampY(cy - search), y1 = clampY(cy + search)
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const s = sad(f, w, tpl, r, x, y, best)
      if (s < best) { best = s; bx = x; by = y }
    }
    if (best / (n * n) > maxMean) { lostAt = k; break }
    // Sub-pixel refinement: fit a parabola through the SAD at the minimum and its horizontal/vertical neighbours.
    const at = (x: number, y: number) => (x < r || x > w - r - 1 || y < r || y > h - r - 1 ? best : sad(f, w, tpl, r, x, y, Infinity))
    const parab = (a: number, b: number, c: number) => { const d = a - 2 * b + c; return Math.abs(d) < 1e-9 ? 0 : Math.max(-0.5, Math.min(0.5, (a - c) / (2 * d))) }
    fx = bx + parab(at(bx - 1, by), best, at(bx + 1, by))
    fy = by + parab(at(bx, by - 1), best, at(bx, by + 1))
    cx = bx; cy = by
    // Slowly adapt the template so gradual appearance changes (lighting, perspective) don't break the lock.
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) tpl[j * n + i] = tpl[j * n + i] * 0.85 + f[(cy - r + j) * w + (cx - r + i)] * 0.15
    samples.push({ t: k / opts.fps, x: fx / (w - 1), y: fy / (h - 1) })
  }
  return { samples, lostAt }
}

/** Ramer–Douglas–Peucker on (time, value): keeps the points needed to stay within `tol` of the original path. */
export function simplify(points: Keyframe[], tol: number): Keyframe[] {
  if (points.length <= 2) return points
  const a = points[0], b = points[points.length - 1]
  let idx = -1, dmax = -1
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i]
    const interp = a.value + ((b.value - a.value) * (p.time - a.time)) / Math.max(1e-9, b.time - a.time)
    const d = Math.abs(p.value - interp)
    if (d > dmax) { dmax = d; idx = i }
  }
  if (dmax <= tol) return [a, b]
  return [...simplify(points.slice(0, idx + 1), tol).slice(0, -1), ...simplify(points.slice(idx), tol)]
}

/** Geometry needed to convert source-frame fractions into canvas percentages (matches the exporter's fit-to-canvas maths). */
export interface TrackGeometry { canvasW: number; canvasH: number; srcW: number; srcH: number; video: Pick<Clip, 'start' | 'duration' | 'speed'> & { transform: Pick<Transform, 'x' | 'y' | 'scale'> }; overlay: Pick<Clip, 'start' | 'duration'> }

/**
 * Converts tracked samples into x/y keyframes (percent of canvas from centre, times relative to the overlay's start)
 * so the overlay sits on the tracked point and follows it. Ignores crop, rotation and flips of the tracked clip.
 */
export function samplesToKeyframes(samples: TrackSample[], g: TrackGeometry, tolPercent = 0.15): { x: Keyframe[]; y: Keyframe[] } {
  const fit = Math.min(g.canvasW / g.srcW, g.canvasH / g.srcH)
  const dispWpct = ((g.srcW * fit * g.video.transform.scale) / g.canvasW) * 100
  const dispHpct = ((g.srcH * fit * g.video.transform.scale) / g.canvasH) * 100
  const xs: Keyframe[] = [], ys: Keyframe[] = []
  for (const s of samples) {
    const tl = g.video.start + s.t / (g.video.speed || 1) // timeline time of this sample
    const local = tl - g.overlay.start
    if (local < -1e-6 || local > g.overlay.duration + 1e-6) continue
    xs.push({ time: Math.max(0, local), value: (s.x - 0.5) * dispWpct + g.video.transform.x })
    ys.push({ time: Math.max(0, local), value: (s.y - 0.5) * dispHpct + g.video.transform.y })
  }
  const cap = (k: Keyframe[]) => { let tol = tolPercent, out = simplify(k, tol); while (out.length > 60 && tol < 20) { tol *= 1.5; out = simplify(k, tol) } return out }
  return { x: cap(xs), y: cap(ys) }
}
