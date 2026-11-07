import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Copy, Eye, EyeOff, Flag, Lock, Magnet, Merge, Plus, Redo2, Scissors, Snowflake, Trash2, Undo2, Unlock, Volume2, VolumeX, X, ZoomIn, ZoomOut,
} from 'lucide-react'
import { useEditor } from '@/store/editorStore'
import { askConfirm } from '@/components/PromptDialog'
import { api } from '@/services/api'
import { projectDuration, type Track, type TrackKind } from '@/types/project'
import { cn } from '@/utils/cn'
import { formatDuration } from '@/utils/anim'
import { addTrack, addMediaClip, moveClip, removeTrack, snap, snapPoints, trackAcceptsClip, trimLeft, trimRight } from './ops'
import { TimelineClip, TRACK_H } from './TimelineClip'
import {
  addMarker, deleteSelected, duplicateSelected, freezeFrame, importPaths, mergeSelected, rippleDeleteSelected, splitAtPlayhead,
} from '../actions'

const HEADER_W = 176
const RULER_H = 28
const SNAP_PX = 8

type DragMode = 'move' | 'left' | 'right'

const TICKS = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600]

export function Timeline() {
  const { project, selection, playhead, playing, zoom, snapping, past, future } = useEditor()
  const scroller = useRef<HTMLDivElement>(null)
  const lanesRef = useRef<HTMLDivElement>(null)
  const originRef = useRef<HTMLDivElement>(null)
  const [view, setView] = useState({ left: 0, width: 1200 })
  const [menu, setMenu] = useState(false)
  const [guide, setGuide] = useState<number | null>(null) // snap guide line (seconds)
  const [dropTrack, setDropTrack] = useState<string | null>(null)

  const duration = projectDuration(project)
  const contentSeconds = Math.max(30, duration + 20)
  const contentW = contentSeconds * zoom
  const mediaById = useMemo(() => new Map(project.media.map((m) => [m.id, m])), [project.media])

  // ---- viewport tracking (virtualised clip rendering) --------------------
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    let raf = 0
    const update = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => setView({ left: el.scrollLeft, width: el.clientWidth })) }
    update()
    el.addEventListener('scroll', update)
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => { el.removeEventListener('scroll', update); ro.disconnect(); cancelAnimationFrame(raf) }
  }, [])

  // keep the playhead visible while playing
  useEffect(() => {
    const el = scroller.current
    if (!el || !playing) return
    const x = playhead * zoom
    if (x > el.scrollLeft + el.clientWidth - HEADER_W - 60 || x < el.scrollLeft) el.scrollLeft = Math.max(0, x - 80)
  }, [playhead, playing, zoom])

  const visStart = (view.left - HEADER_W) / zoom - 1
  const visEnd = (view.left + view.width) / zoom + 1

  // ---- zoom ---------------------------------------------------------------
  const setZoomAt = useCallback((next: number, anchorClientX?: number) => {
    const el = scroller.current
    const st = useEditor.getState()
    if (!el) return st.setZoom(next)
    const rect = el.getBoundingClientRect()
    const ax = (anchorClientX ?? rect.left + rect.width / 2) - rect.left - HEADER_W
    const timeAtAnchor = (el.scrollLeft + ax) / st.zoom
    st.setZoom(next)
    requestAnimationFrame(() => { el.scrollLeft = timeAtAnchor * useEditor.getState().zoom - ax })
  }, [])

  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      setZoomAt(useEditor.getState().zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15), e.clientX)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [setZoomAt])

  // ---- time <-> x --------------------------------------------------------
  const timeFromClientX = (clientX: number): number => {
    const r = originRef.current!.getBoundingClientRect()
    return Math.max(0, (clientX - r.left) / useEditor.getState().zoom)
  }

  // ---- scrubbing ---------------------------------------------------------
  const startScrub = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    const s = useEditor.getState()
    s.setPlaying(false)
    const move = (clientX: number) => {
      let t = timeFromClientX(clientX)
      const st = useEditor.getState()
      if (st.snapping) t = snap(t, snapPoints(st.project), SNAP_PX / st.zoom).value
      st.setPlayhead(t)
    }
    move(e.clientX)
    const onMove = (ev: PointerEvent) => move(ev.clientX)
    const onUp = () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp) }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  // ---- clip dragging / trimming ------------------------------------------
  const onClipDown = (clipId: string) => (e: React.PointerEvent, mode: DragMode) => {
    if (e.button !== 0) return
    const st = useEditor.getState()
    const clip = st.project.clips.find((c) => c.id === clipId)
    if (!clip) return
    if (e.shiftKey) st.select(st.selection.includes(clipId) ? st.selection.filter((i) => i !== clipId) : [...st.selection, clipId])
    else if (!st.selection.includes(clipId)) st.select([clipId])
    const track = st.project.tracks.find((t) => t.id === clip.trackId)!
    if (track.locked) return
    const startX = e.clientX
    const orig = { start: clip.start, end: clip.start + clip.duration, dur: clip.duration, trackId: clip.trackId }
    let moved = false

    const onMove = (ev: PointerEvent) => {
      const s = useEditor.getState()
      if (!moved) {
        if (Math.abs(ev.clientX - startX) < 3 && mode === 'move' && Math.abs(ev.clientY - e.clientY) < 3) return
        moved = true
        s.checkpoint()
      }
      const dt = (ev.clientX - startX) / s.zoom
      const pts = [...snapPoints(s.project, clipId), s.playhead]
      const thr = SNAP_PX / s.zoom
      let g: number | null = null
      if (mode === 'move') {
        const raw = Math.max(0, orig.start + dt)
        let start = raw
        if (s.snapping) {
          const a = snap(raw, pts, thr)
          const b = snap(raw + orig.dur, pts, thr)
          if (a.snapped && (!b.snapped || Math.abs(a.value - raw) <= Math.abs(b.value - raw - orig.dur))) { start = a.value; g = a.value }
          else if (b.snapped) { start = b.value - orig.dur; g = b.value }
        }
        // which track is the pointer over?
        const top = lanesRef.current!.getBoundingClientRect().top
        const row = Math.min(s.project.tracks.length - 1, Math.max(0, Math.floor((ev.clientY - top) / TRACK_H)))
        const target = s.project.tracks[row]
        const trackId = target && !target.locked && trackAcceptsClip(target, clip) ? target.id : orig.trackId
        s.live((p) => moveClip(p, clipId, start, trackId))
      } else if (mode === 'left') {
        let v = orig.start + dt
        if (s.snapping) { const r = snap(v, pts, thr); v = r.value; if (r.snapped) g = r.value }
        s.live((p) => trimLeft(p, clipId, v))
      } else {
        let v = orig.end + dt
        if (s.snapping) { const r = snap(v, pts, thr); v = r.value; if (r.snapped) g = r.value }
        s.live((p) => trimRight(p, clipId, v))
      }
      setGuide(g)
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      setGuide(null)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  // ---- dropping media from the library / OS onto a lane ------------------
  const onLaneDrop = async (e: React.DragEvent, track: Track) => {
    e.preventDefault()
    setDropTrack(null)
    const t = timeFromClientX(e.clientX)
    const s = useEditor.getState()
    const mediaId = e.dataTransfer.getData('application/x-vc-media')
    if (mediaId) {
      const media = s.project.media.find((m) => m.id === mediaId)
      if (!media) return
      let newId = ''
      s.commit((p) => { const r = addMediaClip(p, media, { trackId: track.id, start: t }); newId = r.clipId; return r.project })
      s.select([newId])
      return
    }
    if (e.dataTransfer.files.length) {
      const paths = [...e.dataTransfer.files].map((f) => api().media.pathForFile(f)).filter(Boolean)
      const items = await importPaths(paths)
      let at = t
      for (const m of items) {
        let id = ''
        useEditor.getState().commit((p) => { const r = addMediaClip(p, m, { trackId: track.id, start: at }); id = r.clipId; return r.project })
        const c = useEditor.getState().project.clips.find((x) => x.id === id)
        at = (c?.start ?? at) + (c?.duration ?? 0)
      }
    }
  }

  // ---- ruler ticks -------------------------------------------------------
  const tickStep = TICKS.find((s) => s * zoom >= 70) ?? 600
  const ticks: number[] = []
  for (let t = Math.max(0, Math.floor(visStart / tickStep) * tickStep); t <= visEnd; t += tickStep) ticks.push(t)

  const sel = new Set(selection)
  const toggleTrack = (id: string, patch: Partial<Track>) => useEditor.getState().commit((p) => ({ ...p, tracks: p.tracks.map((t) => (t.id === id ? { ...t, ...patch } : t)) }))

  return (
    <div className="flex h-full flex-col rounded-lg border border-border bg-panel">
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-1 border-b border-border px-2 py-1.5">
        <Tb label="Undo (Ctrl+Z)" onClick={() => useEditor.getState().undo()} disabled={!past.length}><Undo2 size={15} /></Tb>
        <Tb label="Redo (Ctrl+Y)" onClick={() => useEditor.getState().redo()} disabled={!future.length}><Redo2 size={15} /></Tb>
        <Sep />
        <Tb label="Split at playhead (S)" onClick={splitAtPlayhead} text="Split"><Scissors size={15} /></Tb>
        <Tb label="Delete (Del)" onClick={deleteSelected} disabled={!selection.length} text="Delete"><Trash2 size={15} /></Tb>
        <Tb label="Ripple delete: remove and close the gap (Shift+Del)" onClick={rippleDeleteSelected} disabled={!selection.length} text="Ripple"><Trash2 size={15} className="text-accent" /></Tb>
        <Tb label="Duplicate (Ctrl+D)" onClick={duplicateSelected} disabled={!selection.length} text="Duplicate"><Copy size={15} /></Tb>
        <Tb label="Merge two adjacent split clips" onClick={mergeSelected} disabled={selection.length !== 2} text="Merge"><Merge size={15} /></Tb>
        <Tb label="Freeze frame at playhead" onClick={() => void freezeFrame()} text="Freeze"><Snowflake size={15} /></Tb>
        <Sep />
        <Tb label="Add marker (M)" onClick={addMarker} text="Marker"><Flag size={15} /></Tb>
        <Tb label="Magnetic snapping" active={snapping} onClick={() => useEditor.getState().setSnapping(!snapping)} text="Snap"><Magnet size={15} /></Tb>
        <div className="relative">
          <Tb label="Add track" onClick={() => setMenu(!menu)} text="Track"><Plus size={15} /></Tb>
          {menu && (
            <div className="absolute left-0 top-9 z-50 w-32 rounded-md border border-border bg-panel p-1 shadow-xl" onMouseLeave={() => setMenu(false)}>
              {(['video', 'audio', 'text', 'image'] as TrackKind[]).map((k) => (
                <button key={k} className="block w-full rounded px-2 py-1.5 text-left text-sm capitalize hover:bg-muted" onClick={() => { useEditor.getState().commit((p) => addTrack(p, k)); setMenu(false) }}>{k} track</button>
              ))}
            </div>
          )}
        </div>
        <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          <span>{formatDuration(duration)}</span>
          <button onClick={() => setZoomAt(zoom / 1.4)} title="Zoom out" className="hover:text-foreground"><ZoomOut size={15} /></button>
          <input type="range" min={Math.log(8)} max={Math.log(600)} step={0.01} value={Math.log(zoom)} onChange={(e) => setZoomAt(Math.exp(Number(e.target.value)))} className="w-28 accent-[hsl(var(--primary))]" />
          <button onClick={() => setZoomAt(zoom * 1.4)} title="Zoom in" className="hover:text-foreground"><ZoomIn size={15} /></button>
        </div>
      </div>

      {/* scrolling area: ruler + track rows share one scroll container so headers/lanes stay aligned */}
      <div ref={scroller} className="relative min-h-0 flex-1 overflow-auto" onPointerDown={(e) => { if ((e.target as HTMLElement).dataset.lane) useEditor.getState().select([]) }}>
        <div className="relative" style={{ width: HEADER_W + contentW, minHeight: '100%' }}>
          <div className="sticky top-0 z-30 flex bg-panel" style={{ height: RULER_H }}>
            <div className="sticky left-0 z-40 shrink-0 border-b border-r border-border bg-panel" style={{ width: HEADER_W }} />
            <div ref={originRef} className="relative cursor-pointer border-b border-border" style={{ width: contentW }} onPointerDown={startScrub}>
              {ticks.map((t) => (
                <div key={t} className="absolute top-0 h-full border-l border-border/80 pl-1 text-[10px] text-muted-foreground" style={{ left: t * zoom }}>{formatTick(t)}</div>
              ))}
              {project.markers.map((m) => (
                <button key={m.id} title={`${m.label} — click to jump, Shift+click to delete`} onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => { if (e.shiftKey) useEditor.getState().commit((p) => ({ ...p, markers: p.markers.filter((x) => x.id !== m.id) })); else useEditor.getState().setPlayhead(m.time) }}
                  className="absolute bottom-0 z-10 -translate-x-1/2 text-amber-400" style={{ left: m.time * zoom }}><Flag size={13} fill="currentColor" /></button>
              ))}
            </div>
          </div>

          <div ref={lanesRef}>
            {project.tracks.map((track) => (
              <div key={track.id} className="flex" style={{ height: TRACK_H }}>
                <TrackHeader track={track} onToggle={(patch) => toggleTrack(track.id, patch)}
                  onRemove={async () => { if (project.clips.some((c) => c.trackId === track.id) && !(await askConfirm(`Delete "${track.name}" and its clips?`, 'Delete'))) return; useEditor.getState().commit((p) => removeTrack(p, track.id)) }} />
                <div data-lane="1" className={cn('relative border-b border-border/70', dropTrack === track.id && 'bg-primary/10', !track.visible && 'opacity-50')}
                  style={{ width: contentW, backgroundImage: 'linear-gradient(to right, hsl(var(--border) / 0.35) 1px, transparent 1px)', backgroundSize: `${tickStep * zoom}px 100%` }}
                  onDragOver={(e) => { e.preventDefault(); setDropTrack(track.id) }} onDragLeave={() => setDropTrack(null)}
                  onDrop={(e) => void onLaneDrop(e, track)}>
                  {project.clips.filter((c) => c.trackId === track.id && c.start + c.duration >= visStart && c.start <= visEnd).map((c) => (
                    <TimelineClip key={c.id} clip={c} media={c.mediaId ? mediaById.get(c.mediaId) : undefined} zoom={zoom} selected={sel.has(c.id)} locked={track.locked} onDown={onClipDown(c.id)} />
                  ))}
                </div>
              </div>
            ))}
          </div>

          {guide !== null && <div className="pointer-events-none absolute top-0 z-20 w-px bg-yellow-300" style={{ left: HEADER_W + guide * zoom, height: '100%' }} />}
          {/* playhead */}
          <div className="pointer-events-none absolute top-0 z-[25] w-px bg-red-500" style={{ left: HEADER_W + playhead * zoom, height: '100%' }}>
            <div className="absolute -left-[5px] top-0 h-3 w-[11px] bg-red-500" style={{ clipPath: 'polygon(0 0,100% 0,50% 100%)' }} />
          </div>
        </div>
      </div>
    </div>
  )
}

function formatTick(t: number): string {
  if (t < 60) return Number.isInteger(t) ? `${t}s` : `${t.toFixed(2).replace(/0+$/, '')}s`
  return `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, '0')}`
}

function Sep() { return <div className="mx-1 h-5 w-px bg-border" /> }

function Tb({ children, label, onClick, disabled, text, active }: { children: React.ReactNode; label: string; onClick: () => void; disabled?: boolean; text?: string; active?: boolean }) {
  return (
    <button title={label} aria-label={label} disabled={disabled} onClick={onClick}
      className={cn('flex h-8 items-center gap-1.5 rounded-md px-2 text-xs transition-colors hover:bg-muted disabled:opacity-35 disabled:hover:bg-transparent', active ? 'bg-primary/20 text-primary' : 'text-foreground/90')}>
      {children}{text && <span>{text}</span>}
    </button>
  )
}

function TrackHeader({ track, onToggle, onRemove }: { track: Track; onToggle: (p: Partial<Track>) => void; onRemove: () => void }) {
  const canMute = track.kind === 'audio' || track.kind === 'video'
  const b = 'grid h-6 w-6 place-items-center rounded hover:bg-muted'
  return (
    <div className="sticky left-0 z-20 flex shrink-0 items-center gap-1 border-b border-r border-border bg-panel px-2" style={{ width: HEADER_W }}>
      <span className="min-w-0 flex-1 truncate text-xs font-medium">{track.name}</span>
      <button className={b} title={track.visible ? 'Hide track' : 'Show track'} onClick={() => onToggle({ visible: !track.visible })}>{track.visible ? <Eye size={13} /> : <EyeOff size={13} className="text-danger" />}</button>
      {canMute && <button className={b} title={track.muted ? 'Unmute' : 'Mute'} onClick={() => onToggle({ muted: !track.muted })}>{track.muted ? <VolumeX size={13} className="text-danger" /> : <Volume2 size={13} />}</button>}
      <button className={b} title={track.locked ? 'Unlock track' : 'Lock track'} onClick={() => onToggle({ locked: !track.locked })}>{track.locked ? <Lock size={13} className="text-amber-400" /> : <Unlock size={13} />}</button>
      <button className={cn(b, 'text-muted-foreground')} title="Delete track" onClick={onRemove}><X size={13} /></button>
    </div>
  )
}
