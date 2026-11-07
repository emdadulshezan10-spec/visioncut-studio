import type { Clip } from '@/types/project'

/**
 * Rasterises a text clip to a transparent PNG at the given canvas size.
 * The SAME function feeds the live preview and the FFmpeg export (no drawtext/font dependency),
 * so what you see is exactly what gets rendered.
 */
const cache = new Map<string, string>()

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = []
  for (const para of text.split('\n')) {
    const words = para.split(/\s+/).filter(Boolean)
    if (!words.length) { lines.push(''); continue }
    let line = words[0]
    for (const w of words.slice(1)) {
      if (ctx.measureText(`${line} ${w}`).width <= maxWidth) line += ` ${w}`
      else { lines.push(line); line = w }
    }
    lines.push(line)
  }
  return lines
}

export function renderTextImage(clip: Clip, W: number, H: number): string {
  const t = clip.text
  if (!t) return ''
  const key = `${W}x${H}|${JSON.stringify(t)}`
  const hit = cache.get(key)
  if (hit) return hit

  const canvas = document.createElement('canvas')
  canvas.width = Math.round(W)
  canvas.height = Math.round(H)
  const ctx = canvas.getContext('2d')!
  const k = H / 1080
  const px = Math.max(8, t.fontSize * k)
  ctx.font = `${t.italic ? 'italic ' : ''}${t.bold ? 'bold ' : ''}${px}px "${t.fontFamily}", sans-serif`
  ctx.textBaseline = 'top'
  const maxW = W * (t.preset === 'lower-third' ? 0.6 : 0.86)
  const lines = wrap(ctx, t.content, maxW)
  const lh = px * 1.25
  const blockW = Math.max(...lines.map((l) => ctx.measureText(l).width), 1)
  const blockH = lines.length * lh
  const pad = t.background ? px * 0.3 : 0

  // Anchor the block by preset.
  let left: number
  let top: number
  if (t.preset === 'lower-third') { left = W * 0.06 + pad; top = H * 0.84 - blockH }
  else if (t.preset === 'subtitle') { left = (W - blockW) / 2; top = H * 0.93 - blockH }
  else { left = (W - blockW) / 2; top = (H - blockH) / 2 }

  if (t.background) {
    ctx.fillStyle = t.background
    ctx.beginPath()
    ctx.roundRect(left - pad, top - pad, blockW + pad * 2, blockH + pad * 2, px * 0.2)
    ctx.fill()
  }
  lines.forEach((line, i) => {
    const w = ctx.measureText(line).width
    const x = t.align === 'center' ? left + (blockW - w) / 2 : t.align === 'right' ? left + blockW - w : left
    const y = top + i * lh
    if (t.shadow) { ctx.shadowColor = 'rgba(0,0,0,0.7)'; ctx.shadowBlur = px * 0.15; ctx.shadowOffsetY = px * 0.05 }
    if (t.outlineWidth > 0) {
      ctx.lineJoin = 'round'
      ctx.lineWidth = t.outlineWidth * 2 * k
      ctx.strokeStyle = t.outlineColor
      ctx.strokeText(line, x, y)
    }
    ctx.fillStyle = t.color
    ctx.fillText(line, x, y)
    ctx.shadowColor = 'transparent'
  })

  const url = canvas.toDataURL('image/png')
  if (cache.size > 60) cache.delete(cache.keys().next().value as string)
  cache.set(key, url)
  return url
}
