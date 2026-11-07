import { describe, expect, it } from 'vitest'
import { samplesToKeyframes, simplify, trackPoint } from '../src/utils/tracker'

// Deterministic pseudo-random texture so block matching has something to lock on to.
const rng = (seed: number) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 0xffffffff }
const W = 160, H = 90

function makeFrames(count: number, startX: number, startY: number, dx: number, dy: number, breakAt = Infinity): Uint8Array[] {
  const bg = (() => { const r = rng(7); return Uint8Array.from({ length: W * H }, () => 40 + Math.floor(r() * 30)) })()
  const patch = (() => { const r = rng(99); return Uint8Array.from({ length: 15 * 15 }, () => 120 + Math.floor(r() * 120)) })()
  const frames: Uint8Array[] = []
  for (let k = 0; k < count; k++) {
    const f = new Uint8Array(bg)
    if (k >= breakAt) { const r = rng(1000 + k); for (let i = 0; i < f.length; i++) f[i] = Math.floor(r() * 255) } // target destroyed
    else {
      const ox = Math.round(startX + dx * k), oy = Math.round(startY + dy * k)
      for (let j = 0; j < 15; j++) for (let i = 0; i < 15; i++) f[(oy + j) * W + ox + i] = patch[j * 15 + i]
    }
    frames.push(f)
  }
  return frames
}

describe('motion tracker', () => {
  it('follows a textured patch moving diagonally to within ~1 px', () => {
    const frames = makeFrames(20, 40, 30, 2, 1) // patch top-left (40,30) -> centre (47,37), moving +2,+1 per frame
    const res = trackPoint(frames, W, H, { x: 47 / (W - 1), y: 37 / (H - 1) }, { fps: 15, radius: 7, search: 6 })
    expect(res.lostAt).toBeNull()
    expect(res.samples).toHaveLength(20)
    const last = res.samples[19]
    expect(Math.abs(last.x * (W - 1) - (47 + 38))).toBeLessThan(1)
    expect(Math.abs(last.y * (H - 1) - (37 + 19))).toBeLessThan(1)
    expect(last.t).toBeCloseTo(19 / 15, 5)
  })

  it('reports where the target was lost instead of inventing motion', () => {
    const frames = makeFrames(20, 40, 30, 1, 0, 8)
    const res = trackPoint(frames, W, H, { x: 47 / (W - 1), y: 37 / (H - 1) }, { fps: 15, radius: 7, search: 6 })
    expect(res.lostAt).toBe(8)
    expect(res.samples).toHaveLength(8)
  })

  it('simplifies straight-line motion to its end points and keeps real turns', () => {
    const line = Array.from({ length: 30 }, (_, i) => ({ time: i / 10, value: i * 0.5 }))
    expect(simplify(line, 0.05)).toHaveLength(2)
    const bent = [...line.slice(0, 15), ...Array.from({ length: 15 }, (_, i) => ({ time: (15 + i) / 10, value: 7 - i * 0.5 }))]
    expect(simplify(bent, 0.05).length).toBeGreaterThanOrEqual(3)
  })

  it('maps source-frame motion to overlay keyframes in canvas percent, offset by clip timing', () => {
    // Tracked point moves from the centre to 10% of the frame width to the right over 1 s; 16:9 video fills a 16:9 canvas.
    const samples = Array.from({ length: 16 }, (_, i) => ({ t: i / 15, x: 0.5 + (0.1 * i) / 15, y: 0.5 }))
    const kf = samplesToKeyframes(samples, { canvasW: 1920, canvasH: 1080, srcW: 1280, srcH: 720, video: { start: 2, duration: 5, speed: 1, transform: { x: 0, y: 0, scale: 1 } }, overlay: { start: 1, duration: 10 } })
    expect(kf.x[0]).toEqual({ time: 1, value: 0 }) // sample 0 happens at timeline 2 s = overlay-local 1 s
    expect(kf.x[kf.x.length - 1].time).toBeCloseTo(2, 5)
    expect(kf.x[kf.x.length - 1].value).toBeCloseTo(10, 4) // 10 % of canvas width (video fills the canvas)
    expect(kf.y.every((k) => Math.abs(k.value) < 1e-9)).toBe(true)
    // video scaled to 50 % and shifted: displacement halves, base offset applies
    const kf2 = samplesToKeyframes(samples, { canvasW: 1920, canvasH: 1080, srcW: 1280, srcH: 720, video: { start: 0, duration: 5, speed: 1, transform: { x: 20, y: -10, scale: 0.5 } }, overlay: { start: 0, duration: 10 } })
    expect(kf2.x[0].value).toBeCloseTo(20, 5)
    expect(kf2.x[kf2.x.length - 1].value).toBeCloseTo(25, 4)
    expect(kf2.y[0].value).toBeCloseTo(-10, 5)
  })
})
