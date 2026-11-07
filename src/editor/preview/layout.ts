import { transitionAt, valueAt } from '@/utils/anim'
import { defaultColor, type Clip, type MediaItem } from '@/types/project'

export interface Layout {
  boxW: number; boxH: number; fullW: number; fullH: number; offX: number; offY: number
  wrapperStyle: React.CSSProperties
  filter: string
  vignette: number
}

const isNeutralColor = (c: Clip['color']): boolean => {
  const d = defaultColor()
  return (Object.keys(d) as (keyof typeof d)[]).every((k) => k === 'lutPath' || c[k] === d[k])
}
export const hasColorGrade = (c: Clip['color']): boolean => !isNeutralColor(c) && (c.exposure !== 0 || c.temperature !== 0 || c.tint !== 0 || c.red !== 0 || c.green !== 0 || c.blue !== 0 || c.highlights !== 0 || c.shadows !== 0)

/**
 * Computes CSS for a clip inside a stage of SW x SH logical pixels at clip-local time `t`.
 * Mirrors the maths in electron/export/buildArgs.ts so preview ~= export.
 */
export function computeLayout(clip: Clip, media: MediaItem | undefined, SW: number, SH: number, t: number): Layout {
  const tf = clip.transform
  const tx = transitionAt(clip, t)
  const mw = clip.kind === 'text' ? SW : (media?.width ?? SW)
  const mh = clip.kind === 'text' ? SH : (media?.height ?? SH)
  const cl = tf.cropLeft / 100, cr = tf.cropRight / 100, ct = tf.cropTop / 100, cb = tf.cropBottom / 100
  const cw = mw * (1 - cl - cr), ch = mh * (1 - ct - cb)
  const fit = Math.min(SW / cw, SH / ch)
  const boxW = cw * fit, boxH = ch * fit
  const fullW = mw * fit, fullH = mh * fit

  const x = valueAt(clip, 'x', t) + tx.dx
  const y = valueAt(clip, 'y', t) + tx.dy
  const scale = valueAt(clip, 'scale', t) * tx.scale
  const rot = valueAt(clip, 'rotation', t)
  const opacity = Math.min(1, Math.max(0, valueAt(clip, 'opacity', t) * tx.opacity))
  const flip = (tf.flipH !== clip.effects.mirror ? -1 : 1)

  const px = SW / 1920 // blur radii are authored against a 1080p-ish canvas
  const f: string[] = []
  if (hasColorGrade(clip.color)) f.push(`url(#cg_${clip.id})`)
  const c = clip.color
  if (c.brightness) f.push(`brightness(${1 + c.brightness * 0.6})`)
  if (c.contrast) f.push(`contrast(${1 + c.contrast})`)
  if (c.saturation) f.push(`saturate(${Math.max(0, 1 + c.saturation)})`)
  const e = clip.effects
  if (e.grayscale) f.push('grayscale(1)')
  if (e.invert) f.push('invert(1)')
  if (e.blur > 0) f.push(`blur(${e.blur * px}px)`)
  if (e.gaussianBlur > 0) f.push(`blur(${e.gaussianBlur * px}px)`)
  if (tx.blur > 0) f.push(`blur(${tx.blur * px}px)`)

  const wrapperStyle: React.CSSProperties = {
    position: 'absolute', left: SW / 2 - boxW / 2, top: SH / 2 - boxH / 2, width: boxW, height: boxH, overflow: 'hidden',
    transform: `translate(${(x / 100) * SW}px, ${(y / 100) * SH}px) rotate(${rot}deg) scale(${scale * flip}, ${scale * (tf.flipV ? -1 : 1)})`,
    opacity,
    clipPath: tx.wipe < 1 ? `inset(0 ${(1 - tx.wipe) * 100}% 0 0)` : undefined,
    borderRadius: e.ellipseMask ? '50%' : undefined,
    filter: f.length ? f.join(' ') : undefined,
    willChange: 'transform, opacity',
  }
  return { boxW, boxH, fullW, fullH, offX: -cl * fullW, offY: -ct * fullH, wrapperStyle, filter: f.join(' '), vignette: e.vignette }
}
