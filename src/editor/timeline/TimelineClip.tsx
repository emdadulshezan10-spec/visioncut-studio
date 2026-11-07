import { memo, useEffect, useRef } from 'react'
import { FastForward, Rewind, Type } from 'lucide-react'
import { mediaUrl } from '@/services/api'
import { cn } from '@/utils/cn'
import type { Clip, MediaItem } from '@/types/project'

export const TRACK_H = 52

/** Draws the portion of the waveform used by this clip. Cheap: one canvas, one pass over the visible bins. */
function Waveform({ media, clip, width, height }: { media: MediaItem; clip: Clip; width: number; height: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const cv = ref.current
    const peaks = media.waveform
    if (!cv || !peaks?.length || !media.duration) return
    const dpr = window.devicePixelRatio || 1
    const w = Math.max(1, Math.min(4096, Math.floor(width)))
    cv.width = w * dpr
    cv.height = height * dpr
    const ctx = cv.getContext('2d')!
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, w, height)
    ctx.fillStyle = 'rgba(255,255,255,0.65)'
    const span = clip.duration * clip.speed
    for (let x = 0; x < w; x++) {
      const frac = x / w
      const srcT = clip.reverse ? clip.inPoint + (1 - frac) * span : clip.inPoint + frac * span
      const i = Math.min(peaks.length - 1, Math.max(0, Math.floor((srcT / media.duration) * peaks.length)))
      const amp = Math.min(1, peaks[i] * clip.volume) * (height / 2 - 2)
      ctx.fillRect(x, height / 2 - amp, 1, Math.max(1, amp * 2))
    }
  }, [media, clip.inPoint, clip.duration, clip.speed, clip.reverse, clip.volume, width, height])
  return <canvas ref={ref} className="absolute inset-0 h-full w-full" style={{ width, height }} />
}

interface Props {
  clip: Clip
  media?: MediaItem
  zoom: number
  selected: boolean
  locked: boolean
  onDown: (e: React.PointerEvent, mode: 'move' | 'left' | 'right') => void
}

const COLORS: Record<Clip['kind'], string> = {
  video: 'bg-[#3b3f8f] border-[#6a70e0]',
  image: 'bg-[#2f6f6a] border-[#4fd1c5]',
  audio: 'bg-[#2e6a3e] border-[#4ade80]',
  text: 'bg-[#7a4a1d] border-[#fb923c]',
}

export const TimelineClip = memo(function TimelineClip({ clip, media, zoom, selected, locked, onDown }: Props) {
  const width = Math.max(4, clip.duration * zoom)
  const h = TRACK_H - 8
  const showThumb = (clip.kind === 'video' || clip.kind === 'image') && media?.thumbnail
  return (
    <div
      data-clip={clip.id}
      onPointerDown={(e) => onDown(e, 'move')}
      className={cn('group absolute top-1 overflow-hidden rounded-md border text-[11px] shadow-sm', COLORS[clip.kind],
        selected ? 'ring-2 ring-white z-10' : 'hover:brightness-110', locked ? 'opacity-60 cursor-not-allowed' : 'cursor-grab active:cursor-grabbing')}
      style={{ left: clip.start * zoom, width, height: h }}
      title={`${media?.name ?? clip.text?.content ?? clip.kind} · ${clip.duration.toFixed(2)}s`}
    >
      {showThumb && (
        <div className="absolute inset-0 opacity-70" style={{ backgroundImage: `url("${mediaUrl(media!.thumbnail!)}")`, backgroundSize: `auto ${h}px`, backgroundRepeat: 'repeat-x' }} />
      )}
      {(clip.kind === 'audio' || (clip.kind === 'video' && media?.waveform)) && media && width > 8 && (
        <div className={cn('absolute inset-x-0 bottom-0', clip.kind === 'video' ? 'h-4 opacity-70' : 'inset-y-0')}>
          <Waveform media={media} clip={clip} width={width} height={clip.kind === 'video' ? 16 : h} />
        </div>
      )}
      <div className="relative z-[1] flex items-center gap-1 px-1.5 py-0.5 text-white drop-shadow">
        {clip.kind === 'text' && <Type size={11} />}
        <span className="truncate">{clip.kind === 'text' ? clip.text?.content.split('\n')[0] : media?.name}</span>
        {clip.speed !== 1 && <span className="rounded bg-black/50 px-1">{clip.speed.toFixed(2)}x</span>}
        {clip.reverse && <Rewind size={11} />}
        {clip.transitionIn.type !== 'none' && <FastForward size={10} className="opacity-80" />}
      </div>
      {clip.transitionIn.type !== 'none' && <div className="absolute inset-y-0 left-0 bg-white/25" style={{ width: Math.min(width / 2, clip.transitionIn.duration * zoom), clipPath: 'polygon(0 0,100% 100%,0 100%)' }} />}
      {clip.transitionOut.type !== 'none' && <div className="absolute inset-y-0 right-0 bg-white/25" style={{ width: Math.min(width / 2, clip.transitionOut.duration * zoom), clipPath: 'polygon(100% 0,100% 100%,0 100%)' }} />}
      {!locked && (<>
        <div onPointerDown={(e) => { e.stopPropagation(); onDown(e, 'left') }} className="absolute inset-y-0 left-0 z-[2] w-2 cursor-ew-resize bg-white/0 hover:bg-white/60" />
        <div onPointerDown={(e) => { e.stopPropagation(); onDown(e, 'right') }} className="absolute inset-y-0 right-0 z-[2] w-2 cursor-ew-resize bg-white/0 hover:bg-white/60" />
      </>)}
    </div>
  )
})
