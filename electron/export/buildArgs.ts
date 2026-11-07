/**
 * Translates a Project timeline into a single FFmpeg command line (filter_complex graph).
 * This is a PURE function (no IO) so it can be unit-tested and inspected.
 *
 * Graph layout:
 *   [0] solid background colour (canvas size, fps, project duration)
 *   [1] silent audio bed (guarantees an audio stream and a stable amix length)
 *   [2..] one input per clip (media file, or a PNG for text clips)
 * Visual clips are processed individually (trim -> speed -> crop -> grade -> effects -> scale ->
 * rotate -> opacity/transition), shifted to their timeline position and overlaid bottom-to-top.
 */
import { effectiveTransitions } from '../../src/utils/anim'
import { outputSize, type ExportOptions } from '../../src/types/export'
import type { AnimatableProp, Clip, MediaItem, Project } from '../../src/types/project'
import { projectDuration } from '../../src/types/project'

export interface BuildInput {
  project: Project
  options: ExportOptions
  /** clipId -> absolute path of the pre-rendered transparent PNG for text clips. */
  textImages: Record<string, string>
  outputPath: string
}

export interface BuildResult {
  args: string[]
  duration: number
  width: number
  height: number
  warnings: string[]
}

const n = (v: number, d = 4): string => String(Math.round(v * 10 ** d) / 10 ** d)
const even = (v: number): number => Math.max(2, Math.round(v / 2) * 2)

/** Escape a file path for use inside a filtergraph option value. */
export function escapeFilterPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'")
}

/** Piecewise-linear FFmpeg expression for keyframes using variable `v` as clip-local time. */
export function keyframeExpr(frames: { time: number; value: number }[], v: string): string {
  const f = [...frames].sort((a, b) => a.time - b.time)
  if (f.length === 1) return n(f[0].value)
  let expr = n(f[f.length - 1].value)
  for (let i = f.length - 1; i >= 1; i--) {
    const a = f[i - 1]
    const b = f[i]
    const seg = `${n(a.value)}+(${n(b.value - a.value)})*(${v}-${n(a.time)})/${n(Math.max(1e-6, b.time - a.time))}`
    expr = `if(lt(${v},${n(b.time)}),${seg},${expr})`
  }
  return `if(lt(${v},${n(f[0].time)}),${n(f[0].value)},${expr})`
}

/** atempo only accepts 0.5..2 per instance, so chain several. */
export function atempoChain(speed: number): string[] {
  const out: string[] = []
  let s = speed
  while (s > 2) { out.push('atempo=2'); s /= 2 }
  while (s < 0.5) { out.push('atempo=0.5'); s /= 0.5 }
  if (Math.abs(s - 1) > 1e-4) out.push(`atempo=${n(s, 5)}`)
  return out
}

function colorFilters(c: Clip['color']): string[] {
  const f: string[] = []
  const gain = 2 ** c.exposure
  const rr = Math.max(0, gain * (1 + c.red) * (1 + 0.25 * c.temperature))
  const gg = Math.max(0, gain * (1 + c.green) * (1 - 0.25 * c.tint))
  const bb = Math.max(0, gain * (1 + c.blue) * (1 - 0.25 * c.temperature))
  if ([rr, gg, bb].some((v) => Math.abs(v - 1) > 1e-3)) f.push(`colorchannelmixer=rr=${n(rr)}:gg=${n(gg)}:bb=${n(bb)}`)
  if (c.brightness || c.contrast || c.saturation) {
    f.push(`eq=brightness=${n(c.brightness * 0.5)}:contrast=${n(1 + c.contrast)}:saturation=${n(Math.max(0, 1 + c.saturation))}`)
  }
  if (c.highlights || c.shadows) {
    f.push(`curves=all='0/0 0.25/${n(Math.min(1, Math.max(0, 0.25 + c.shadows * 0.12)))} 0.75/${n(Math.min(1, Math.max(0, 0.75 + c.highlights * 0.12)))} 1/1'`)
  }
  if (c.lutPath) f.push(`lut3d=file='${escapeFilterPath(c.lutPath)}'`)
  return f
}

export function buildExportArgs(input: BuildInput): BuildResult {
  const { project, options, textImages, outputPath } = input
  const warnings: string[] = []
  const duration = projectDuration(project)
  if (duration <= 0) throw new Error('The timeline is empty — add clips before exporting.')

  const { width: W, height: H } = outputSize(project.settings.width, project.settings.height, options.resolution)
  const FPS = options.fps
  const bg = project.settings.backgroundColor.replace('#', '0x')
  const mediaById = new Map<string, MediaItem>(project.media.map((m) => [m.id, m]))
  const trackIndex = new Map(project.tracks.map((t, i) => [t.id, i]))

  const inputs: string[] = [
    '-f', 'lavfi', '-i', `color=c=${bg}:s=${W}x${H}:r=${FPS}:d=${n(duration)}`,
    '-f', 'lavfi', '-i', `anullsrc=r=48000:cl=stereo:d=${n(duration)}`,
  ]
  const graph: string[] = []
  const audioLabels: string[] = ['[1:a]']
  let idx = 2

  // Bottom-most track (last in array) is drawn first; within a track by start time.
  const ordered = [...project.clips].sort((a, b) => (trackIndex.get(b.trackId)! - trackIndex.get(a.trackId)!) || a.start - b.start)

  let current = '[0:v]'
  let layer = 0

  for (const clip of ordered) {
    const track = project.tracks.find((t) => t.id === clip.trackId)
    if (!track) continue
    const media = clip.mediaId ? mediaById.get(clip.mediaId) : undefined
    if (clip.kind !== 'text' && (!media || media.error)) { warnings.push(`Clip "${media?.name ?? clip.id}" skipped: media missing or unreadable.`); continue }

    const span = clip.duration * clip.speed // seconds consumed from the source
    const k = idx
    const visual = clip.kind !== 'audio' && track.visible
    const wantsAudio = (clip.kind === 'audio' || (clip.kind === 'video' && media!.hasAudio)) && !track.muted && clip.volume > 0

    // ---- inputs -------------------------------------------------------
    if (clip.kind === 'text') {
      const png = textImages[clip.id]
      if (!png || !visual) continue
      inputs.push('-loop', '1', '-framerate', String(FPS), '-t', n(clip.duration), '-i', png)
    } else if (clip.kind === 'image') {
      if (!visual) continue
      inputs.push('-loop', '1', '-framerate', String(FPS), '-t', n(clip.duration), '-i', media!.path)
    } else {
      if (!visual && !wantsAudio) continue
      inputs.push('-ss', n(clip.inPoint), '-t', n(span), '-i', media!.path)
    }
    idx++

    // ---- video ---------------------------------------------------------
    if (visual) {
      const L = `(t-${n(clip.start)})` // clip-local time inside overlay expressions
      const tr = effectiveTransitions(clip)
      const f: string[] = []
      const isVideo = clip.kind === 'video'
      const sw = clip.kind === 'text' ? W : (media!.width ?? W)
      const sh = clip.kind === 'text' ? H : (media!.height ?? H)
      const tf = clip.transform

      if (isVideo) {
        f.push('setpts=PTS-STARTPTS')
        if (clip.reverse) f.push('reverse')
        if (clip.speed !== 1) f.push(`setpts=PTS/${n(clip.speed, 5)}`)
        f.push(`fps=${FPS}`)
        // Single-pass deshake. Two-pass vidstab was tried and dropped: the Windows FFmpeg build cannot read back its .trf file ("Cannot parse localmotion!").
        if (clip.effects.stabilize) f.push('deshake')
      } else {
        f.push('setpts=PTS-STARTPTS')
      }
      if (clip.kind === 'text') f.push(`scale=${W}:${H}`)

      // crop (percent of source)
      const cl = tf.cropLeft / 100, cr = tf.cropRight / 100, ct = tf.cropTop / 100, cb = tf.cropBottom / 100
      if (cl || cr || ct || cb) f.push(`crop=iw*${n(1 - cl - cr)}:ih*${n(1 - ct - cb)}:iw*${n(cl)}:ih*${n(ct)}`)
      if (tf.flipH !== clip.effects.mirror) f.push('hflip')
      if (tf.flipV) f.push('vflip')

      f.push('format=gbrap') // planar RGB + alpha: supported by eq, curves, colorchannelmixer, chromakey (via conversion below)
      if (clip.effects.chromaKey.enabled) {
        const ck = clip.effects.chromaKey
        f.push('format=yuva444p', `chromakey=color=${ck.color.replace('#', '0x')}:similarity=${n(ck.similarity)}:blend=${n(ck.blend)}`, 'format=gbrap')
      }
      f.push(...colorFilters(clip.color))

      const e = clip.effects
      if (e.grayscale) f.push('hue=s=0')
      if (e.invert) f.push('negate')
      if (e.blur > 0) f.push(`boxblur=${Math.round(e.blur)}:1`)
      if (e.gaussianBlur > 0) f.push(`gblur=sigma=${n(e.gaussianBlur)}`)
      if (e.sharpen > 0) f.push(`unsharp=5:5:${n(e.sharpen)}:5:5:0`)
      if (e.vignette > 0) f.push(`vignette=a=${n(1.2 - e.vignette * 0.8)}`)
      if (e.grain > 0) f.push(`noise=alls=${Math.round(e.grain)}:allf=t`)
      if (e.noise > 0) f.push(`noise=alls=${Math.round(e.noise)}:allf=u`)
      if (e.chromaticAberration > 0) { const s = Math.round(e.chromaticAberration); f.push('format=rgba', `rgbashift=rh=${-s}:bh=${s}`, 'format=gbrap') }
      if (e.glow > 0) {
        // Screen-blend a blurred copy over the original.
        const gl = `gl${layer}`
        graph.push(`[${k}:v]${f.join(',')},split[${gl}a][${gl}b]`)
        graph.push(`[${gl}b]gblur=sigma=24[${gl}c]`)
        graph.push(`[${gl}a][${gl}c]blend=all_mode=screen:all_opacity=${n(e.glow)}[${gl}d]`)
        f.length = 0
        f.push('null')
      }
      const srcLabel = e.glow > 0 ? `[gl${layer}d]` : `[${k}:v]`

      // ---- geometry: scale (fit * user scale * zoom transition) ----------
      const cw = sw * (1 - cl - cr), ch = sh * (1 - ct - cb)
      const fit = Math.min(W / cw, H / ch)
      const baseW = cw * fit, baseH = ch * fit
      const scaleKf = clip.keyframes.scale
      const zoom = (tr.in.type === 'zoom' && tr.in.duration > 0) || (tr.out.type === 'zoom' && tr.out.duration > 0)
      const animatedScale = (scaleKf && scaleKf.length > 0) || zoom
      f.push('format=rgba')
      if (animatedScale) {
        let sExpr = scaleKf?.length ? keyframeExpr(scaleKf, 't') : n(tf.scale)
        if (tr.in.type === 'zoom' && tr.in.duration > 0) sExpr += `*(1+0.6*(1-min(t/${n(tr.in.duration)},1)))`
        if (tr.out.type === 'zoom' && tr.out.duration > 0) sExpr += `*(1+0.6*(1-min((${n(clip.duration)}-t)/${n(tr.out.duration)},1)))`
        f.push(`scale=w='max(2,trunc(${n(baseW)}*(${sExpr})/2)*2)':h='max(2,trunc(${n(baseH)}*(${sExpr})/2)*2)':eval=frame`)
      } else {
        f.push(`scale=${even(baseW * tf.scale)}:${even(baseH * tf.scale)}`)
      }
      if (e.ellipseMask) f.push("geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(lte(pow((X-W/2)/(W/2),2)+pow((Y-H/2)/(H/2),2),1),alpha(X,Y),0)'")

      // rotation
      const rotKf = clip.keyframes.rotation
      if (rotKf?.length) {
        f.push(`rotate=a='(${keyframeExpr(rotKf, 't')})*PI/180':c=none:ow='hypot(iw,ih)':oh='hypot(iw,ih)'`)
      } else if (Math.abs(tf.rotation) > 1e-3) {
        f.push(`rotate=a=${n((tf.rotation * Math.PI) / 180, 6)}:c=none:ow=rotw(${n((tf.rotation * Math.PI) / 180, 6)}):oh=roth(${n((tf.rotation * Math.PI) / 180, 6)})`)
      }

      // opacity: keyframed -> geq; static -> colorchannelmixer
      const opKf = clip.keyframes.opacity
      if (opKf?.length) f.push(`geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*clip(${keyframeExpr(opKf, 'T')},0,1)'`)
      else if (tf.opacity < 0.999) f.push(`colorchannelmixer=aa=${n(tf.opacity)}`)

      // transitions on alpha
      const alphaFade = (t: typeof tr.in, entering: boolean) => {
        if (t.duration <= 0) return
        if (t.type === 'fade' || t.type === 'dissolve' || t.type === 'zoom' || t.type === 'blur') {
          f.push(entering ? `fade=t=in:st=0:d=${n(t.duration)}:alpha=1` : `fade=t=out:st=${n(Math.max(0, clip.duration - t.duration))}:d=${n(t.duration)}:alpha=1`)
        }
        if (t.type === 'blur') {
          f.push(`gblur=sigma=14:enable='${entering ? `lt(t,${n(t.duration)})` : `gt(t,${n(clip.duration - t.duration)})`}'`)
        }
        if (t.type === 'wipe') {
          const prog = entering ? `clip(T/${n(t.duration)},0,1)` : `clip((${n(clip.duration)}-T)/${n(t.duration)},0,1)`
          f.push(`geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(lt(X,W*${prog}),alpha(X,Y),0)'`)
        }
      }
      alphaFade(tr.in, true)
      alphaFade(tr.out, false)

      f.push(`setpts=PTS+${n(clip.start)}/TB`)
      const vl = `cv${layer}`
      graph.push(`${srcLabel}${f.join(',')}[${vl}]`)

      // ---- overlay position (offset + keyframes + slide transitions) ----
      const xKf = clip.keyframes.x, yKf = clip.keyframes.y
      let xe = xKf?.length ? keyframeExpr(xKf, L) : n(tf.x)
      let ye = yKf?.length ? keyframeExpr(yKf, L) : n(tf.y)
      const slide = (t: typeof tr.in, entering: boolean) => {
        if (t.duration <= 0) return
        if (t.type === 'slide') xe += entering ? `+100*max(0,1-${L}/${n(t.duration)})` : `-100*max(0,1-(${n(clip.duration)}-${L})/${n(t.duration)})`
        if (t.type === 'rise') ye += `+8*max(0,1-${L}/${n(t.duration)})`
      }
      slide(tr.in, true)
      slide(tr.out, false)
      const out = `ov${layer}`
      const enable = `between(t,${n(clip.start)},${n(clip.start + clip.duration)})`
      graph.push(`${current}[${vl}]overlay=x='(W-w)/2+W*(${xe})/100':y='(H-h)/2+H*(${ye})/100':enable='${enable}':eof_action=pass:format=auto[${out}]`)
      current = `[${out}]`
      layer++
    }

    // ---- audio ---------------------------------------------------------
    if (wantsAudio) {
      const a: string[] = ['asetpts=PTS-STARTPTS']
      if (clip.reverse) a.push('areverse')
      a.push(...atempoChain(clip.speed))
      if (clip.denoise) a.push('afftdn=nr=14')
      if (Math.abs(clip.volume - 1) > 1e-3) a.push(`volume=${n(clip.volume)}`)
      if (clip.audioFadeIn > 0) a.push(`afade=t=in:st=0:d=${n(clip.audioFadeIn)}`)
      if (clip.audioFadeOut > 0) a.push(`afade=t=out:st=${n(Math.max(0, clip.duration - clip.audioFadeOut))}:d=${n(clip.audioFadeOut)}`)
      a.push('aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo')
      const delay = Math.round(Math.max(0, clip.start + clip.audioOffset) * 1000)
      if (delay > 0) a.push(`adelay=${delay}|${delay}`)
      const al = `a${k}`
      graph.push(`[${k}:a]${a.join(',')}[${al}]`)
      audioLabels.push(`[${al}]`)
    }
  }

  graph.push(`${current}format=yuv420p[vout]`)
  graph.push(`${audioLabels.join('')}amix=inputs=${audioLabels.length}:duration=longest:normalize=0:dropout_transition=0,atrim=0:${n(duration)}[aout]`)

  const args = ['-y', '-hide_banner', '-nostdin', '-progress', 'pipe:1', '-nostats', ...inputs, '-filter_complex', graph.join(';'), '-map', '[vout]', '-map', '[aout]', '-t', n(duration)]
  args.push(...encoderArgs(options), outputPath)
  return { args, duration, width: W, height: H, warnings }
}

function encoderArgs(o: ExportOptions): string[] {
  const a: string[] = []
  const br = o.videoBitrateKbps
  if (o.codec === 'h264') {
    a.push('-c:v', 'libx264', '-preset', 'medium', '-pix_fmt', 'yuv420p')
    a.push(...(br ? ['-b:v', `${br}k`, '-maxrate', `${Math.round(br * 1.5)}k`, '-bufsize', `${br * 2}k`] : ['-crf', '20']))
  } else if (o.codec === 'h265') {
    a.push('-c:v', 'libx265', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-tag:v', 'hvc1')
    a.push(...(br ? ['-b:v', `${br}k`] : ['-crf', '24']))
  } else {
    a.push('-c:v', 'libvpx-vp9', '-row-mt', '1', '-pix_fmt', 'yuv420p', '-deadline', 'good', '-cpu-used', '2')
    a.push(...(br ? ['-b:v', `${br}k`] : ['-b:v', '0', '-crf', '32']))
  }
  if (o.format === 'webm') a.push('-c:a', 'libopus', '-b:a', `${o.audioBitrateKbps}k`)
  else a.push('-c:a', 'aac', '-b:a', `${o.audioBitrateKbps}k`)
  a.push('-r', String(o.fps))
  if (o.format === 'mp4' || o.format === 'mov') a.push('-movflags', '+faststart')
  return a
}

export type { AnimatableProp }
