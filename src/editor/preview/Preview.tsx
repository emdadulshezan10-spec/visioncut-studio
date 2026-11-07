import { useEffect, useMemo, useRef, useState } from 'react'
import { Maximize2, Pause, Play, Repeat, SkipBack, SkipForward, StepBack, StepForward } from 'lucide-react'
import { useEditor } from '@/store/editorStore'
import { projectDuration } from '@/types/project'
import { formatTimecode } from '@/utils/anim'
import { cn } from '@/utils/cn'
import { AudioLayer, ColorDefs, ImageLayer, VideoLayer } from './MediaLayers'

const RATES = [0.25, 0.5, 1, 1.5, 2]
const SCALES = [{ v: 1, l: 'Full' }, { v: 0.5, l: '1/2' }, { v: 0.25, l: '1/4' }]

export function Preview() {
  const { project, playhead, playing, playbackRate, previewScale, loop, setPlaying, setPlayhead, setPlaybackRate, setPreviewScale, setLoop } = useEditor()
  const wrap = useRef<HTMLDivElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ w: 640, h: 360 })
  const [useProxy, setUseProxy] = useState(true)
  const { width: W, height: H, fps, backgroundColor } = project.settings
  const duration = projectDuration(project)

  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Logical stage size (preview resolution) and on-screen scale.
  const SW = Math.round(W * previewScale)
  const SH = Math.round(H * previewScale)
  const display = Math.min((box.w - 16) / SW, (box.h - 16) / SH)

  const mediaById = useMemo(() => new Map(project.media.map((m) => [m.id, m])), [project.media])
  const trackIdx = useMemo(() => new Map(project.tracks.map((t, i) => [t.id, i])), [project.tracks])
  const trackById = useMemo(() => new Map(project.tracks.map((t) => [t.id, t])), [project.tracks])

  const WARM = 1.2
  // Keep a STABLE DOM order (project order) and use z-index for stacking: re-ordering <video> nodes would pause/reload them.
  const isLive = (c: (typeof project.clips)[number]) => playhead >= c.start && playhead < c.start + c.duration
  const isWarm = (c: (typeof project.clips)[number]) => c.start > playhead && c.start <= playhead + WARM && (c.kind === 'video' || c.kind === 'audio')
  const layers = project.clips.filter((c) => isLive(c) || isWarm(c))
  const live = layers.filter(isLive)

  const step = (frames: number) => { setPlaying(false); setPlayhead(Math.min(duration, Math.max(0, Math.round(playhead * fps) / fps + frames / fps))) }
  const toggle = () => { if (!playing && playhead >= duration - 0.01) setPlayhead(0); setPlaying(!playing) }
  const fullscreen = () => { void stage.current?.requestFullscreen?.() }

  const common = { SW, SH, playhead, playing, rate: playbackRate, useProxy }
  const render = (c: (typeof project.clips)[number], isWarm: boolean) => {
    const track = trackById.get(c.trackId)
    if (!track) return null
    const media = c.mediaId ? mediaById.get(c.mediaId) : undefined
    const p = { ...common, clip: c, media, warm: isWarm, trackMuted: track.muted }
    const z = 1000 - (trackIdx.get(c.trackId) ?? 0)
    const wrapZ = (n: React.ReactNode) => <div key={c.id} style={{ position: 'absolute', inset: 0, zIndex: z, pointerEvents: 'none' }}>{n}</div>
    if (c.kind === 'audio') return wrapZ(<AudioLayer {...p} />)
    if (!track.visible) return c.kind === 'video' ? wrapZ(<AudioLayer {...p} />) : null
    if (c.kind === 'video') return wrapZ(<VideoLayer {...p} />)
    return wrapZ(<ImageLayer {...p} />)
  }

  return (
    <div className="flex h-full flex-col rounded-lg border border-border bg-panel">
      <div ref={wrap} className="relative min-h-0 flex-1 grid place-items-center overflow-hidden bg-[#050507]">
        <div ref={stage} className="relative overflow-hidden shadow-2xl" style={{ width: SW * display, height: SH * display, background: backgroundColor }}>
          <div style={{ width: SW, height: SH, transform: `scale(${display})`, transformOrigin: '0 0', position: 'relative' }}>
            <ColorDefs clips={live} />
            {layers.map((c) => render(c, !isLive(c)))}
          </div>
        </div>
        {project.clips.length === 0 && <p className="absolute text-sm text-muted-foreground">Import media and drag it onto the timeline to start editing</p>}
      </div>
      <div className="flex items-center gap-1 border-t border-border px-3 py-2">
        <span className="w-28 font-mono text-sm text-accent">{formatTimecode(playhead, fps)}</span>
        <span className="font-mono text-xs text-muted-foreground">/ {formatTimecode(duration, fps)}</span>
        <div className="mx-auto flex items-center gap-1">
          <IconBtn label="Go to start (Home)" onClick={() => { setPlaying(false); setPlayhead(0) }}><SkipBack size={16} /></IconBtn>
          <IconBtn label="Previous frame (←)" onClick={() => step(-1)}><StepBack size={16} /></IconBtn>
          <button onClick={toggle} title="Play / pause (Space)" className="grid h-9 w-9 place-items-center rounded-full bg-primary text-primary-foreground hover:bg-primary/90">
            {playing ? <Pause size={16} /> : <Play size={16} className="ml-0.5" />}
          </button>
          <IconBtn label="Next frame (→)" onClick={() => step(1)}><StepForward size={16} /></IconBtn>
          <IconBtn label="Go to end (End)" onClick={() => { setPlaying(false); setPlayhead(duration) }}><SkipForward size={16} /></IconBtn>
          <IconBtn label="Loop" active={loop} onClick={() => setLoop(!loop)}><Repeat size={16} /></IconBtn>
        </div>
        <select value={playbackRate} onChange={(e) => setPlaybackRate(Number(e.target.value))} title="Playback speed" className="h-8 rounded-md border border-border bg-muted px-1 text-xs">
          {RATES.map((r) => <option key={r} value={r}>{r}x</option>)}
        </select>
        <select value={previewScale} onChange={(e) => setPreviewScale(Number(e.target.value))} title="Preview resolution" className="h-8 rounded-md border border-border bg-muted px-1 text-xs">
          {SCALES.map((s) => <option key={s.v} value={s.v}>{s.l}</option>)}
        </select>
        <IconBtn label="Use proxy media for preview when available" active={useProxy} onClick={() => setUseProxy(!useProxy)}><span className="text-[10px] font-bold">PX</span></IconBtn>
        <IconBtn label="Fullscreen" onClick={fullscreen}><Maximize2 size={16} /></IconBtn>
      </div>
    </div>
  )
}

function IconBtn({ children, label, onClick, active }: { children: React.ReactNode; label: string; onClick: () => void; active?: boolean }) {
  return (
    <button title={label} aria-label={label} onClick={onClick} className={cn('grid h-8 w-8 place-items-center rounded-md hover:bg-muted', active ? 'text-accent' : 'text-muted-foreground hover:text-foreground')}>
      {children}
    </button>
  )
}

