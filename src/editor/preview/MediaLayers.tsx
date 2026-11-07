import { memo, useEffect, useMemo, useRef } from 'react'
import { mediaUrl } from '@/services/api'
import { renderTextImage } from './renderText'
import { computeLayout, hasColorGrade } from './layout'
import type { Clip, MediaItem } from '@/types/project'

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))

export interface LayerProps {
  clip: Clip
  media?: MediaItem
  SW: number
  SH: number
  playhead: number
  playing: boolean
  rate: number
  /** Upcoming clip kept mounted (paused, invisible) so the decoder is warm when it starts. */
  warm?: boolean
  trackMuted: boolean
  useProxy: boolean
}

/** Source-media time for a given timeline time, honouring in-point, speed and reverse. */
export function sourceTime(clip: Clip, playhead: number): number {
  const local = clamp(playhead - clip.start, 0, clip.duration)
  return clip.reverse ? clip.inPoint + (clip.duration - local) * clip.speed : clip.inPoint + local * clip.speed
}

function audioGain(clip: Clip, local: number): number {
  let g = clip.volume
  if (clip.audioFadeIn > 0 && local < clip.audioFadeIn) g *= local / clip.audioFadeIn
  const left = clip.duration - local
  if (clip.audioFadeOut > 0 && left < clip.audioFadeOut) g *= left / clip.audioFadeOut
  return clamp(g, 0, 1)
}

/** Keeps a <video>/<audio> element in sync with the timeline clock. */
function useMediaSync(ref: React.RefObject<HTMLMediaElement | null>, p: LayerProps): void {
  const { clip, playhead, playing, rate, warm, trackMuted } = p
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const local = clamp(playhead - clip.start, 0, clip.duration)
    const target = sourceTime(clip, playhead)
    el.muted = trackMuted || !!warm
    el.volume = audioGain(clip, local)
    if (warm || !playing || clip.reverse) {
      if (!el.paused) el.pause()
      if (Math.abs(el.currentTime - target) > (playing ? 0.04 : 0.015)) el.currentTime = target
      return
    }
    el.playbackRate = clamp(clip.speed * rate, 0.0625, 16)
    if (Math.abs(el.currentTime - target) > 0.3) el.currentTime = target // correct drift
    if (el.paused) void el.play().catch(() => undefined)
  }, [ref, clip, playhead, playing, rate, warm, trackMuted])

  useEffect(() => () => { ref.current?.pause() }, [ref])
}

const VideoLayerInner = (p: LayerProps) => {
  const ref = useRef<HTMLVideoElement>(null)
  const { clip, media, SW, SH, playhead, warm, useProxy } = p
  useMediaSync(ref, p)
  if (!media) return null
  const local = clamp(playhead - clip.start, 0, clip.duration)
  const L = computeLayout(clip, media, SW, SH, local)
  const src = mediaUrl(useProxy && media.proxyPath ? media.proxyPath : media.path)
  return (
    <div style={{ ...L.wrapperStyle, visibility: warm ? 'hidden' : 'visible' }}>
      <video ref={ref} src={src} preload="auto" playsInline style={{ position: 'absolute', left: L.offX, top: L.offY, width: L.fullW, height: L.fullH }} />
      {L.vignette > 0 && <div style={{ position: 'absolute', inset: 0, background: `radial-gradient(ellipse at center, transparent ${60 - L.vignette * 30}%, rgba(0,0,0,${0.9 * L.vignette}) 100%)` }} />}
    </div>
  )
}
export const VideoLayer = memo(VideoLayerInner)

const ImageLayerInner = ({ clip, media, SW, SH, playhead, warm }: LayerProps) => {
  const local = clamp(playhead - clip.start, 0, clip.duration)
  const textUrl = useMemo(() => (clip.kind === 'text' ? renderTextImage(clip, SW, SH) : ''), [clip, SW, SH])
  if (clip.kind !== 'text' && !media) return null
  const L = computeLayout(clip, media, SW, SH, local)
  const src = clip.kind === 'text' ? textUrl : mediaUrl(media!.path)
  return (
    <div style={{ ...L.wrapperStyle, visibility: warm ? 'hidden' : 'visible' }}>
      <img src={src} draggable={false} style={{ position: 'absolute', left: L.offX, top: L.offY, width: L.fullW, height: L.fullH }} />
      {L.vignette > 0 && <div style={{ position: 'absolute', inset: 0, background: `radial-gradient(ellipse at center, transparent ${60 - L.vignette * 30}%, rgba(0,0,0,${0.9 * L.vignette}) 100%)` }} />}
    </div>
  )
}
export const ImageLayer = memo(ImageLayerInner)

/** Audio-only clips. Rendered even though invisible. */
export const AudioLayer = memo(function AudioLayer(p: LayerProps) {
  const ref = useRef<HTMLAudioElement>(null)
  useMediaSync(ref, p)
  if (!p.media) return null
  return <audio ref={ref} src={mediaUrl(p.media.path)} preload="auto" />
})

/** SVG <filter> definitions (one per graded clip) referenced from CSS `filter: url(#cg_<id>)`. */
export function ColorDefs({ clips }: { clips: Clip[] }) {
  const graded = clips.filter((c) => hasColorGrade(c.color))
  if (!graded.length) return null
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }}>
      <defs>
        {graded.map((c) => {
          const g = 2 ** c.color.exposure
          const r = Math.max(0, g * (1 + c.color.red) * (1 + 0.25 * c.color.temperature))
          const gr = Math.max(0, g * (1 + c.color.green) * (1 - 0.25 * c.color.tint))
          const b = Math.max(0, g * (1 + c.color.blue) * (1 - 0.25 * c.color.temperature))
          const t = `0 ${1 / 3 + c.color.shadows * 0.12} ${2 / 3 + c.color.highlights * 0.12} 1`
          return (
            <filter key={c.id} id={`cg_${c.id}`} colorInterpolationFilters="sRGB">
              <feColorMatrix type="matrix" values={`${r} 0 0 0 0  0 ${gr} 0 0 0  0 0 ${b} 0 0  0 0 0 1 0`} />
              <feComponentTransfer>
                <feFuncR type="table" tableValues={t} /><feFuncG type="table" tableValues={t} /><feFuncB type="table" tableValues={t} />
              </feComponentTransfer>
            </filter>
          )
        })}
      </defs>
    </svg>
  )
}
