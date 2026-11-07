import type { AnimatableProp, Clip, Keyframe, Transition } from '../types/project'

/** Linear interpolation across sorted keyframes; clamps outside the range. */
export function interpolate(frames: Keyframe[], t: number): number {
  if (frames.length === 1) return frames[0].value
  if (t <= frames[0].time) return frames[0].value
  const last = frames[frames.length - 1]
  if (t >= last.time) return last.value
  for (let i = 1; i < frames.length; i++) {
    const b = frames[i]
    if (t <= b.time) {
      const a = frames[i - 1]
      const k = (t - a.time) / Math.max(1e-9, b.time - a.time)
      return a.value + (b.value - a.value) * k
    }
  }
  return last.value
}

/** Value of an animatable property at clip-local time `t` (seconds from clip start). */
export function valueAt(clip: Clip, prop: AnimatableProp, t: number): number {
  const frames = clip.keyframes[prop]
  if (frames && frames.length) return interpolate([...frames].sort((a, b) => a.time - b.time), t)
  return clip.transform[prop]
}

export interface TransitionState {
  opacity: number // multiplier 0..1
  dx: number // % of canvas width
  dy: number // % of canvas height
  scale: number // multiplier
  blur: number // px
  wipe: number // 0..1 revealed fraction (1 = fully visible)
}

const NEUTRAL: TransitionState = { opacity: 1, dx: 0, dy: 0, scale: 1, blur: 0, wipe: 1 }

function one(tr: Transition, p: number, entering: boolean): TransitionState {
  // p: 0 at the outer edge of the clip, 1 when the transition is complete.
  const s = { ...NEUTRAL }
  const inv = 1 - p
  switch (tr.type) {
    case 'fade':
    case 'dissolve': s.opacity = p; break
    case 'slide': s.dx = (entering ? 1 : -1) * inv * 100; break
    case 'rise': s.dy = inv * 8; break
    case 'wipe': s.wipe = p; break // revealed fraction, left-to-right
    case 'zoom': s.scale = 1 + inv * 0.6; s.opacity = p; break
    case 'blur': s.blur = inv * 24; s.opacity = 0.35 + 0.65 * p; break
    default: break
  }
  return s
}

/** Text animations are expressed as implicit transitions so preview and export share one definition. */
export function effectiveTransitions(clip: Clip): { in: Transition; out: Transition } {
  const none = clip.transitionIn.type === 'none' && clip.transitionOut.type === 'none'
  if (clip.kind !== 'text' || !clip.text || !none) return { in: clip.transitionIn, out: clip.transitionOut }
  const d = Math.min(0.5, clip.duration / 3)
  switch (clip.text.animation) {
    case 'fade': return { in: { type: 'fade', duration: d }, out: { type: 'fade', duration: d } }
    case 'slide-up': return { in: { type: 'rise', duration: d }, out: { type: 'fade', duration: d } }
    case 'typewriter': return { in: { type: 'wipe', duration: Math.min(1.2, clip.duration / 2) }, out: { type: 'none', duration: 0 } }
    case 'pop': return { in: { type: 'zoom', duration: Math.min(0.35, clip.duration / 3) }, out: { type: 'none', duration: 0 } }
    default: return { in: clip.transitionIn, out: clip.transitionOut }
  }
}

/** Combined in/out transition state at clip-local time. */
export function transitionAt(clip: Clip, t: number): TransitionState {
  let s = { ...NEUTRAL }
  const { in: inT, out: outT } = effectiveTransitions(clip)
  if (inT.type !== 'none' && inT.duration > 0 && t < inT.duration) s = one(inT, Math.max(0, t / inT.duration), true)
  const left = clip.duration - t
  if (outT.type !== 'none' && outT.duration > 0 && left < outT.duration) {
    const o = one(outT, Math.max(0, left / outT.duration), false)
    s = { opacity: s.opacity * o.opacity, dx: s.dx + o.dx, dy: s.dy + o.dy, scale: s.scale * o.scale, blur: Math.max(s.blur, o.blur), wipe: Math.min(s.wipe, o.wipe) }
  }
  return s
}

export function formatTimecode(seconds: number, fps = 30): string {
  const s = Math.max(0, seconds)
  const totalFrames = Math.round(s * fps)
  const f = totalFrames % Math.round(fps)
  const secs = Math.floor(totalFrames / Math.round(fps))
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const sec = secs % 60
  const p = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${p(h)}:${p(m)}:${p(sec)}:${p(f)}`
}

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  const u = ['KB', 'MB', 'GB', 'TB']
  let i = -1
  let v = n
  do { v /= 1024; i++ } while (v >= 1024 && i < u.length - 1)
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${u[i]}`
}


